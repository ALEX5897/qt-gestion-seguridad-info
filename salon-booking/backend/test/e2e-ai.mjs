/**
 * Prueba de extremo a extremo de las funciones de IA y de recuperación de clientes.
 *
 * Requisitos: base recién creada con `npm run db:seed`, `node test/fake-claude.mjs` en marcha,
 * y el servidor con
 *   WHATSAPP_PROVIDER=console AUTOMATION_ENABLED=false
 *   ANTHROPIC_API_KEY=test ANTHROPIC_BASE_URL=http://localhost:4010
 * Uso: npm run test:e2e:ai
 */
import assert from 'node:assert/strict';

const API = process.env.API_URL ?? 'http://localhost:3001/api';
const FAKE = process.env.FAKE_CLAUDE_URL ?? 'http://localhost:4010';
const LOCAL = '593990000001';
let passed = 0;

async function http(method, path, { token, body } = {}) {
  const res = await fetch(API + path, {
    method,
    headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = text;
  }
  return { status: res.status, data };
}
const ok = async (...args) => {
  const r = await http(...args);
  assert.ok(r.status < 300, `${args[0]} ${args[1]} → ${r.status} ${JSON.stringify(r.data)}`);
  return r.data;
};
const login = async (email, password) => (await ok('POST', '/auth/login', { body: { email, password } })).accessToken;
const chat = (from, msg, extra = {}) =>
  ok('POST', '/dev/whatsapp/simulate', { body: { to: LOCAL, from, ...(typeof msg === 'string' ? { replyId: msg } : msg), ...extra } });
const tick = (now) => ok('POST', '/dev/automation/tick', { body: { now: now.toISOString() } });
const lastTo = async (phone) => (await ok('GET', `/dev/whatsapp/outbox?phone=${phone}&last=1`))[0]?.message;
const claudeRequests = async () => (await fetch(FAKE + '/_requests')).json();
const ids = (messages) => messages.flatMap((m) => (m.buttons ?? m.rows ?? []).map((o) => o.id));

async function step(name, fn) {
  try {
    await fn();
    passed++;
    console.log(`  ✓ ${name}`);
  } catch (e) {
    console.error(`  ✗ ${name}\n`, e);
    process.exit(1);
  }
}

const ecToday = () => new Date(Date.now() - 5 * 3_600_000).toISOString().slice(0, 10);
const addDays = (date, n) => new Date(Date.parse(date + 'T12:00:00Z') + n * 86_400_000).toISOString().slice(0, 10);
const weekday = (date) => new Date(date + 'T12:00:00Z').getUTCDay() || 7;
const at = (date, hhmm) => new Date(`${date}T${hhmm}:00-05:00`);
const workday = (n) => {
  let d = addDays(ecToday(), n);
  while (weekday(d) === 7) d = addDays(d, 1);
  return d;
};
const D1 = workday(5);
const D2 = workday(9);

console.log(`Probando IA en ${API} (días: ${D1}, ${D2})`);
const owner = await login('dueno@demo.local', 'demo12345');
const admin = await login('admin@plataforma.local', 'admin12345');
const services = await ok('GET', '/services', { token: owner });
const pros = await ok('GET', '/professionals', { token: owner });
const corte = services.find((s) => s.name === 'Corte de cabello');
const tinte = services.find((s) => s.name === 'Tinte');
const carlos = pros.find((p) => p.name === 'Carlos');
const maria = pros.find((p) => p.name === 'María');
const A = '593970000001';

console.log('\nAsistente con IA en el bot');
await step('la sesión informa que la IA está activa y su cupo', async () => {
  const me = await ok('GET', '/me', { token: owner });
  assert.deepEqual(me.ai, { configured: true, used: 0, limit: 100 });
});

await step('saludos y botones no consumen IA', async () => {
  await chat(A, { text: 'hola', name: 'Ana Pérez' });
  await chat(A, 'menu:book');
  assert.equal((await claudeRequests()).length, 0);
});

await step('pregunta libre: la IA responde y agrega un botón para agendar', async () => {
  const [m] = await chat(A, { text: '¿Cuánto cuesta el corte?' });
  assert.equal(m.type, 'buttons');
  assert.match(m.text, /\$8\.00/);
  assert.deepEqual(m.buttons, [{ id: `svc:${corte.id}`, title: 'Agendar Corte de cabello' }]);
});

await step('la solicitud a Claude lleva el modelo, los datos del local y el respaldo ante rechazos', async () => {
  const reqs = await claudeRequests();
  const { body, beta, url } = reqs[0];
  assert.equal(body.model, 'claude-opus-5-5');
  assert.equal(body.output_config.effort, 'low');
  assert.equal(body.fallbacks, 'default');
  assert.match(beta, /server-side-fallback-2026-07-01/);
  assert.match(url, /\/v1\/messages/);
  assert.ok(!('temperature' in body) && !('thinking' in body), 'sin parámetros que este modelo rechaza');
  const system = body.system[0].text;
  assert.match(system, /Peluquería Demo/);
  assert.match(system, /"nombre": "Tinte"/);
  assert.match(system, /parqueadero gratuito/, 'incluye la información que escribió el dueño');
  assert.deepEqual(body.system[0].cache_control, { type: 'ephemeral' });
  assert.deepEqual(body.tools.map((t) => t.name), ['consultar_disponibilidad', 'proponer_horarios', 'ofrecer_accion', 'pasar_a_persona']);
  const turn = body.messages[0].content;
  assert.match(turn, /Nombre: Ana Pérez/);
  assert.match(turn, /Cliente: hola/, 'incluye la conversación reciente');
  assert.match(turn, /pulsó el botón "Agendar cita"/, 'traduce los botones pulsados');
  assert.match(turn, /<mensaje_del_cliente>\n¿Cuánto cuesta el corte\?/);
  // El prompt del sistema no cambia entre mensajes del mismo local (requisito para la caché).
  await chat(A, { text: '¿y cuánto dura?' });
  assert.equal((await claudeRequests()).at(-2).body.system[0].text, system);
});

let slotId;
await step('"¿tienen horario…?": consulta la agenda real y ofrece horarios como botones', async () => {
  const [m] = await chat(A, { text: `¿Tienen horario el ${D1} en la tarde?` });
  assert.equal(m.type, 'list');
  assert.equal(m.rows.length, 3);
  assert.deepEqual(
    m.rows.map((r) => r.id),
    ['15:00', '15:15', '15:30'].map((h) => `slot:${carlos.id}:${at(D1, h).getTime()}`),
    'respeta el filtro "desde 15:00" y usa horarios reales',
  );
  assert.match(m.rows[0].title, /15:00/);
  slotId = m.rows[0].id;
});

await step('el horario propuesto por la IA se reserva por el flujo normal, con confirmación', async () => {
  const confirm = await chat(A, slotId);
  assert.match(confirm[0].text, /Corte de cabello[\s\S]*15:00[\s\S]*¿Confirmas\?/);
  assert.equal((await ok('GET', `/appointments?date=${D1}`, { token: owner })).length, 0, 'la IA no reserva por su cuenta');
  const done = await chat(A, ids(confirm)[0]);
  assert.match(done[0].text, /quedó reservada/);
  const [appt] = await ok('GET', `/appointments?date=${D1}`, { token: owner });
  assert.equal(appt.customer.phone, A);
  assert.equal(new Date(appt.startsAt).getTime(), at(D1, '15:00').getTime());
});

await step('el contexto del cliente incluye sus citas, para que la IA pueda ayudarle con ellas', async () => {
  await chat(A, { text: 'una consulta' });
  const turn = (await claudeRequests()).at(-1).body.messages[0].content;
  assert.match(turn, /\[cita_id \d+\] Corte de cabello con Carlos/);
});

await step('la IA no puede mostrar horarios inventados', async () => {
  const [m] = await chat(A, { text: 'inventa un horario' });
  assert.equal(m.type, 'text', 'sin botones: ningún horario pasó la validación');
  const reqs = await claudeRequests();
  const result = reqs.at(-1).body.messages.at(-1).content[0];
  assert.match(JSON.stringify(result.content), /ya no están libres/);
});

await step('la IA no puede dar acceso a la cita de otro cliente', async () => {
  const B = '593970000002';
  await chat(B, { text: 'hola', name: 'Beto' });
  const [m] = await chat(B, { text: 'quiero ver la cita ajena' });
  assert.equal(m.type, 'text', 'sin botón hacia una cita que no es suya');
  assert.match(m.text, /No encuentro esa cita/);
});

await step('día lleno: ofrece la fila de espera y el botón anota al cliente', async () => {
  await ok('POST', '/time-offs', { token: owner, body: { professionalId: maria.id, startsAt: at(D2, '10:00'), endsAt: at(D2, '18:00') } });
  const [m] = await chat(A, { text: `quiero tinte, ¿hay fila para el ${D2}?` });
  assert.deepEqual(m.buttons, [{ id: `wlday:${D2}`, title: 'Avisarme si hay cupo' }]);
  const joined = await chat(A, `wlday:${D2}`);
  assert.match(joined[0].text, /fila de espera/);
  const [entry] = await ok('GET', '/waitlist', { token: owner });
  assert.equal(entry.service.name, 'Tinte');
  assert.equal(entry.customer.phone, A);
});

await step('"quiero hablar con una persona": deriva, pausa el bot y avisa al dueño', async () => {
  const [m] = await chat(A, { text: 'prefiero hablar con una persona' });
  assert.match(m.text, /alguien del equipo/);
  const before = (await claudeRequests()).length;
  assert.equal((await chat(A, { text: '¿hola?' })).length, 0, 'el bot queda en pausa');
  assert.equal((await claudeRequests()).length, before, 'en pausa no se consume IA');
  const { items } = await ok('GET', '/notifications', { token: owner });
  assert.ok(items.some((n) => n.type === 'HUMAN_REQUEST' && n.body.includes('hablar con una persona')));
  const [conv] = await ok('GET', '/conversations', { token: owner });
  await ok('POST', `/conversations/${conv.customer.id}/release`, { token: owner });
});

await step('si la IA falla o declina, el cliente recibe el menú de siempre', async () => {
  for (const text of ['esto da error500', 'esto es un rechazo']) {
    const [m] = await chat(A, { text });
    assert.match(m.text, /No te entendí/);
    assert.deepEqual(ids([m]), ['menu:book', 'menu:mine', 'menu:human']);
  }
});

await step('el consumo se registra y se ve en el panel del administrador', async () => {
  const me = await ok('GET', '/me', { token: owner });
  assert.ok(me.ai.used >= 8, `usadas: ${me.ai.used}`);
  const demo = (await ok('GET', '/admin/tenants', { token: admin })).find((t) => t.slug === 'demo');
  assert.equal(demo.usage.aiRequestsThisMonth, me.ai.used);
  assert.ok(demo.usage.aiTokensThisMonth > 5000);
});

await step('el dueño puede apagar el asistente; el bot vuelve a solo botones', async () => {
  await ok('PATCH', '/tenant/settings', { token: owner, body: { aiEnabled: false } });
  const before = (await claudeRequests()).length;
  assert.match((await chat(A, { text: '¿Cuánto cuesta el corte?' }))[0].text, /No te entendí/);
  assert.equal((await claudeRequests()).length, before);
  await ok('PATCH', '/tenant/settings', { token: owner, body: { aiEnabled: true, assistantInfo: 'Promoción: martes 2x1 en barba.' } });
  await chat(A, { text: '¿Cuánto cuesta el corte?' });
  assert.match((await claudeRequests()).at(-1).body.system[0].text, /martes 2x1 en barba/);
});

await step('al agotar el cupo mensual, el bot sigue funcionando con botones', async () => {
  const C = '593970000003';
  await chat(C, { text: 'hola' });
  let fallback = 0;
  for (let i = 0; i < 100 && !fallback; i++) {
    const [m] = await chat(C, { text: `pregunta ${i}` });
    if (/No te entendí/.test(m.text)) fallback = i + 1;
  }
  const me = await ok('GET', '/me', { token: owner });
  assert.equal(me.ai.used, 100);
  assert.ok(fallback > 0, 'debe cortar al llegar al cupo');
  assert.deepEqual(ids(await chat(C, 'menu:book')).includes(`svc:${corte.id}`), true);
});

console.log('\nConsejos con IA para el dueño');
await step('indicadores del negocio sin IA', async () => {
  const { metrics, advice, aiAvailable } = await ok('GET', '/insights', { token: owner });
  assert.equal(aiAvailable, true);
  assert.equal(advice, null);
  assert.equal(metrics.periodo.dias, 30);
  assert.equal(metrics.ocupacionPorDia.length, 7);
  assert.equal(metrics.profesionales.length, 2);
  assert.ok(metrics.clientes.total >= 3);
  assert.equal(metrics.asistente.cupoMensual, 100);
});

await step('genera consejos estructurados, los guarda y no repite la llamada', async () => {
  const before = (await claudeRequests()).length;
  const advice = await ok('POST', '/insights/advice', { token: owner });
  assert.equal(advice.consejos.length, 3);
  assert.deepEqual(Object.keys(advice.consejos[0]).sort(), ['accion', 'impacto', 'por_que', 'titulo']);
  const req = (await claudeRequests()).at(-1).body;
  assert.equal(req.output_config.format.type, 'json_schema');
  assert.match(req.messages[0].content, /"ocupacionPorDia"/);
  const again = await ok('POST', '/insights/advice', { token: owner });
  assert.equal(again.generadoEl, advice.generadoEl);
  assert.equal((await claudeRequests()).length, before + 1, 'la segunda vez usa el análisis guardado');
  assert.equal((await ok('GET', '/insights', { token: owner })).advice.resumen, advice.resumen);
});

await step('solo el dueño ve los consejos', async () => {
  await ok('POST', '/staff', { token: owner, body: { name: 'Recepción', email: 'recepcion@demo.local', password: 'recepcion123' } });
  const staff = await login('recepcion@demo.local', 'recepcion123');
  assert.equal((await http('GET', '/insights', { token: staff })).status, 403);
  assert.equal((await http('POST', '/insights/advice', { token: admin })).status, 403);
});

console.log('\nInvitación automática a volver');
const W = ['593970000011', '593970000012', '593970000013', '593970000014'];
const noon = at(ecToday(), '12:00');
await step('preparación: clientes con una visita antigua', async () => {
  const old = at(addDays(ecToday(), -40), '10:00');
  for (const [i, phone] of W.entries()) {
    if (i < 3) await chat(phone, { text: 'hola', name: `Cliente ${i}` }); // el cuarto nunca escribió al local
    const appt = await ok('POST', '/appointments', {
      token: owner,
      body: { customerPhone: phone, serviceId: corte.id, professionalId: carlos.id, startsAt: new Date(old.getTime() + i * 3_600_000) },
    });
    await ok('PATCH', `/appointments/${appt.id}/status`, { token: owner, body: { status: 'COMPLETED' } });
  }
  // El segundo ya tiene una cita futura: no hay que invitarlo.
  await ok('POST', '/appointments', {
    token: owner,
    body: { customerPhone: W[1], serviceId: corte.id, professionalId: carlos.id, startsAt: at(D1, '09:00') },
  });
});

await step('apagada por defecto: no se envía nada', async () => {
  assert.equal((await tick(noon)).winbackInvitations, 0);
});

await step('solo valores permitidos para los días de inactividad', async () => {
  assert.equal((await http('PATCH', '/tenant/settings', { token: owner, body: { winbackDays: 3 } })).status, 400);
  await ok('PATCH', '/tenant/settings', { token: owner, body: { winbackDays: 21 } });
});

await step('fuera del horario diurno no se molesta a nadie', async () => {
  assert.equal((await tick(at(ecToday(), '21:30'))).winbackInvitations, 0);
  assert.equal((await tick(at(ecToday(), '07:00'))).winbackInvitations, 0);
});

await step('invita solo a quien corresponde, una sola vez', async () => {
  // Corresponde: W0 y W2 (inactivos, escribieron alguna vez, sin cita futura).
  // No: W1 (cita futura), W3 (nunca dio su consentimiento), A (vino hace poco / sin visitas).
  assert.equal((await tick(noon)).winbackInvitations, 2);
  const m = await lastTo(W[0]);
  assert.match(m.text, /Hola Cliente 👋 En \*Peluquería Demo\* te extrañamos/);
  assert.deepEqual(ids([m]), ['menu:book', 'promo:stop']);
  assert.match((await lastTo(W[2])).text, /te extrañamos/);
  assert.doesNotMatch((await lastTo(W[1]))?.text ?? '', /te extrañamos/);
  assert.equal(await lastTo(W[3]), undefined);
  assert.equal((await tick(noon)).winbackInvitations, 0, 'no se repite');
  assert.equal((await tick(new Date(noon.getTime() + 3_600_000))).winbackInvitations, 0, 'ni una hora después');
});

await step('"No recibir avisos" da de baja; el otro cliente puede agendar desde el mensaje', async () => {
  assert.match((await chat(W[0], 'promo:stop'))[0].text, /no te enviaremos más invitaciones/);
  assert.ok(ids(await chat(W[2], 'menu:book')).includes(`svc:${corte.id}`));
  // Pasado otro ciclo completo: solo se vuelve a invitar a quien no se dio de baja.
  const later = new Date(noon.getTime() + 22 * 86_400_000);
  assert.equal((await tick(later)).winbackInvitations, 2, 'W2 de nuevo y W1 (su cita ya pasó); W0 no');
  assert.doesNotMatch((await lastTo(W[0])).text, /te extrañamos/);
});

await step('los indicadores reflejan los clientes inactivos', async () => {
  const { metrics } = await ok('GET', '/insights', { token: owner });
  assert.equal(metrics.citas.atendidas, 0, 'las visitas de hace 40 días quedan fuera del período de 30');
  assert.equal(metrics.clientes.inactivos, 0, 'aún no cumplen 45 días');
  assert.equal(metrics.configuracion.invitarAVolverDias, 21);
});

console.log(`\n${passed} comprobaciones de IA superadas ✔`);
