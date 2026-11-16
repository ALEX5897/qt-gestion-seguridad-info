/**
 * Prueba de extremo a extremo contra un servidor en marcha.
 *
 * Requisitos: base de datos recién creada con `npm run db:seed` y el servidor con
 *   WHATSAPP_PROVIDER=console AUTOMATION_ENABLED=false
 * Uso: npm run test:e2e   (API_URL opcional, por defecto http://localhost:3001/api)
 */
import assert from 'node:assert/strict';

const API = process.env.API_URL ?? 'http://localhost:3001/api';
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
/** Un cliente escribe o pulsa un botón; devuelve las respuestas del bot. */
const chat = (from, msg, to = LOCAL) =>
  ok('POST', '/dev/whatsapp/simulate', { body: { to, from, ...(typeof msg === 'string' ? { replyId: msg } : msg) } });
const tick = (now) => ok('POST', '/dev/automation/tick', { body: { now: now.toISOString() } });
const lastTo = async (phone) => (await ok('GET', `/dev/whatsapp/outbox?phone=${phone}&last=1`))[0]?.message;
const ids = (messages) =>
  messages.flatMap((m) => (m.buttons ?? m.rows ?? []).map((o) => o.id));
const textOf = (messages) => messages.map((m) => m.text).join('\n');

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

// Fechas locales de Ecuador (UTC-5 fijo).
const ecToday = () => new Date(Date.now() - 5 * 3_600_000).toISOString().slice(0, 10);
const addDays = (date, n) => new Date(Date.parse(date + 'T12:00:00Z') + n * 86_400_000).toISOString().slice(0, 10);
const weekday = (date) => new Date(date + 'T12:00:00Z').getUTCDay() || 7; // 1 = lunes ... 7 = domingo
const at = (date, hhmm) => new Date(`${date}T${hhmm}:00-05:00`);
/** Primer día laborable (lunes a sábado) a partir de hoy + n. */
const workday = (n) => {
  let d = addDays(ecToday(), n);
  while (weekday(d) === 7) d = addDays(d, 1);
  return d;
};

const D1 = workday(4); // reservas normales
const D2 = workday(8); // confirmaciones
const D3 = workday(12); // fila de espera
const D4 = workday(16); // panel

console.log(`Probando ${API}  (días: ${D1}, ${D2}, ${D3}, ${D4})`);

const owner = await login('dueno@demo.local', 'demo12345');
const admin = await login('admin@plataforma.local', 'admin12345');
const services = await ok('GET', '/services', { token: owner });
const pros = await ok('GET', '/professionals', { token: owner });
const corte = services.find((s) => s.name === 'Corte de cabello');
const tinte = services.find((s) => s.name === 'Tinte');
const carlos = pros.find((p) => p.name === 'Carlos');
const maria = pros.find((p) => p.name === 'María');
const appointments = (date) => ok('GET', `/appointments?date=${date}`, { token: owner });
const notifications = async () => (await ok('GET', '/notifications', { token: owner })).items;

const A = '593980000001';
const B = '593980000002';
let apptA;

console.log('\nBot: reservar');
await step('saludo con menú y aviso de privacidad solo la primera vez', async () => {
  const first = await chat(A, { text: 'hola', name: 'Ana Pérez' });
  assert.deepEqual(ids(first), ['menu:book', 'menu:mine', 'menu:human']);
  assert.match(textOf(first), /Hola Ana/);
  assert.match(textOf(first), /eliminemos tus datos/);
  assert.doesNotMatch(textOf(await chat(A, { text: 'hola' })), /eliminemos tus datos/);
});

await step('texto libre no entendido vuelve al menú', async () => {
  assert.match(textOf(await chat(A, { text: 'quiero algo raro' })), /No te entendí/);
});

await step('flujo completo: servicio → profesional → día → hora → reserva', async () => {
  assert.ok(ids(await chat(A, 'menu:book')).includes(`svc:${corte.id}`));
  assert.deepEqual(ids(await chat(A, `svc:${corte.id}`)), ['pro:any', `pro:${carlos.id}`, `pro:${maria.id}`]);
  const days = await chat(A, `pro:${carlos.id}`);
  assert.ok(ids(days).at(-1) === 'wl:ask');
  assert.ok(!ids(days).some((i) => weekday(i.slice(4)) === 7 && i.startsWith('day:')), 'no debe ofrecer domingos');
  const slots = await chat(A, `day:${D1}`);
  const slot = `slot:${carlos.id}:${at(D1, '10:00').getTime()}`;
  assert.ok(ids(slots).includes(slot));
  assert.ok(ids(slots).some((i) => i.startsWith('more:')), 'debe paginar');
  const confirm = await chat(A, slot);
  assert.match(textOf(confirm), /Corte de cabello[\s\S]*Carlos[\s\S]*10:00/);
  const done = await chat(A, ids(confirm)[0]);
  assert.match(textOf(done), /quedó reservada[\s\S]*24 h antes/);
  const list = await appointments(D1);
  assert.equal(list.length, 1);
  apptA = list[0];
  assert.equal(apptA.status, 'PENDING');
  assert.equal(apptA.customer.name, 'Ana Pérez');
  assert.equal(new Date(apptA.endsAt) - new Date(apptA.startsAt), 30 * 60_000);
});

await step('el dueño recibe el aviso de la nueva cita', async () => {
  assert.ok((await notifications()).some((n) => n.type === 'BOOKED' && n.body.includes('Ana Pérez')));
});

await step('otro cliente no puede tomar el mismo horario', async () => {
  await chat(B, { text: 'hola', name: 'Beto' });
  await chat(B, `svc:${corte.id}`);
  const r = await chat(B, `book:${carlos.id}:${at(D1, '10:00').getTime()}`);
  assert.match(textOf(r), /acaba de ocuparse/);
  assert.ok(!ids(r).includes(`slot:${carlos.id}:${at(D1, '10:00').getTime()}`));
  assert.equal((await appointments(D1)).length, 1);
});

await step('no se puede reservar fuera del horario laboral ni en el pasado', async () => {
  for (const when of [at(D1, '13:15'), at(D1, '22:00'), new Date(Date.now() - 86_400_000)]) {
    assert.match(textOf(await chat(B, `book:${carlos.id}:${when.getTime()}`)), /acaba de ocuparse|No encontramos|Qué día/);
  }
  assert.equal((await appointments(D1)).length, 1);
});

await step('ids manipulados no rompen el bot', async () => {
  for (const bad of ['svc:abc', 'day:no-fecha', 'slot:x:y', 'book:1', 'appt:999999', 'cancelok:-1', 'wl:yes:zzz', 'conf:yes:']) {
    const r = await http('POST', '/dev/whatsapp/simulate', { body: { to: LOCAL, from: B, replyId: bad } });
    assert.equal(r.status, 201, `${bad} → ${r.status}`);
    assert.ok(r.data.length > 0, `${bad} sin respuesta`);
  }
});

await step('un cliente no puede cancelar la cita de otro', async () => {
  assert.match(textOf(await chat(B, `cancelok:${apptA.id}`)), /ya no está activa/);
  assert.equal((await appointments(D1))[0].status, 'PENDING');
});

await step('el cliente puede escribir el número o el texto de una opción en vez de pulsarla', async () => {
  const N = '593980000050';
  await chat(N, { text: 'hola', name: 'Nico' });
  assert.ok(ids(await chat(N, { text: '1' })).includes(`svc:${corte.id}`), '"1" = Agendar cita');
  await chat(N, { text: 'hola' });
  assert.match(textOf(await chat(N, { text: 'mis citas' })), /No tienes citas/);
  await chat(N, { text: 'hola' });
  assert.match(textOf(await chat(N, { text: '9' })), /No te entendí/, 'un número que no es opción no elige nada');
  const { items } = { items: await ok('GET', `/conversations`, { token: owner }) };
  const conv = items.find((c) => c.customer.phone === N);
  const msgs = await ok('GET', `/conversations/${conv.customer.id}/messages`, { token: owner });
  assert.ok(msgs.some((m) => m.pressed && m.text === 'Agendar cita'), 'el panel muestra la opción elegida');
});

console.log('\nBot: mis citas, reprogramar, cancelar');
await step('mis citas muestra la cita y permite gestionarla', async () => {
  const mine = await chat(A, 'menu:mine');
  assert.ok(ids(mine).includes(`appt:${apptA.id}`));
  assert.deepEqual(ids(await chat(A, `appt:${apptA.id}`)), [`resch:${apptA.id}`, `cancel:${apptA.id}`, 'menu:mine']);
});

await step('reprogramar mueve la cita y libera el horario anterior', async () => {
  await chat(A, `resch:${apptA.id}`);
  await chat(A, `pro:${carlos.id}`);
  const slots = await chat(A, `day:${D1}`);
  // Al reprogramar, el horario propio (10:00) y los vecinos que solo chocaban con él aparecen libres.
  assert.ok(ids(slots).includes(`slot:${carlos.id}:${at(D1, '10:15').getTime()}`));
  const confirm = await chat(A, `slot:${carlos.id}:${at(D1, '10:15').getTime()}`);
  assert.match(textOf(confirm), /Nuevo horario/);
  assert.match(textOf(await chat(A, ids(confirm)[0])), /reprogramada/);
  const list = await appointments(D1);
  assert.equal(list.find((a) => a.id === apptA.id).status, 'CANCELLED');
  const moved = list.find((a) => a.status === 'PENDING');
  assert.equal(new Date(moved.startsAt).getTime(), at(D1, '10:15').getTime());
  apptA = moved;
  assert.ok((await notifications()).some((n) => n.type === 'RESCHEDULED'));
});

await step('cancelar pide confirmación y luego cancela', async () => {
  const ask = await chat(A, `cancel:${apptA.id}`);
  assert.equal(ids(ask)[0], `cancelok:${apptA.id}`);
  assert.match(textOf(await chat(A, `cancelok:${apptA.id}`)), /fue cancelada/);
  const a = (await appointments(D1)).find((x) => x.id === apptA.id);
  assert.equal(a.status, 'CANCELLED');
  assert.equal(a.cancelReason, 'CUSTOMER');
  assert.match(textOf(await chat(A, 'menu:mine')), /No tienes citas/);
});

console.log('\nConfirmación de asistencia');
let c1, c2;
await step('las citas lejanas nacen pendientes; no se pide confirmar antes de tiempo', async () => {
  await chat(A, `svc:${corte.id}`);
  await chat(A, `book:${carlos.id}:${at(D2, '09:00').getTime()}`);
  await chat(B, `svc:${corte.id}`);
  await chat(B, `book:${carlos.id}:${at(D2, '11:00').getTime()}`);
  [c1, c2] = await appointments(D2);
  assert.equal(c1.status, 'PENDING');
  const r = await tick(new Date(at(D2, '09:00').getTime() - 30 * 3_600_000));
  assert.equal(r.confirmationsRequested, 0);
});

await step('24 h antes se pide confirmación, una sola vez', async () => {
  const t = new Date(at(D2, '09:00').getTime() - 23.5 * 3_600_000);
  const r = await tick(t);
  assert.equal(r.confirmationsRequested, 1);
  const msg = await lastTo(A);
  assert.deepEqual(ids([msg]), [`conf:yes:${c1.id}`, `conf:no:${c1.id}`]);
  assert.equal((await tick(t)).confirmationsRequested, 0);
});

await step('el cliente confirma y la cita queda confirmada', async () => {
  assert.match(textOf(await chat(A, `conf:yes:${c1.id}`)), /asistencia quedó confirmada/);
  assert.equal((await appointments(D2)).find((a) => a.id === c1.id).status, 'CONFIRMED');
  assert.ok((await notifications()).some((n) => n.type === 'CONFIRMED'));
});

await step('una cita confirmada no se cancela por tiempo', async () => {
  const r = await tick(new Date(at(D2, '09:00').getTime() - 3_600_000));
  assert.equal(r.cancelledWithoutConfirmation, 0);
  assert.equal((await appointments(D2)).find((a) => a.id === c1.id).status, 'CONFIRMED');
});

await step('sin respuesta dentro del plazo, la cita se cancela y se avisa', async () => {
  // El tick anterior ya pidió la confirmación de la segunda cita (11:00), 1 h antes de las 09:00.
  const requested = new Date(at(D2, '09:00').getTime() - 3_600_000);
  assert.deepEqual(ids([await lastTo(B)]), [`conf:yes:${c2.id}`, `conf:no:${c2.id}`]);
  // El plazo es el menor entre 4 h y la hora de la cita (11:00 = 3 h después).
  assert.equal((await tick(new Date(requested.getTime() + 2 * 3_600_000))).cancelledWithoutConfirmation, 0);
  assert.equal((await tick(new Date(requested.getTime() + 3 * 3_600_000 + 60_000))).cancelledWithoutConfirmation, 1);
  const a = (await appointments(D2)).find((x) => x.id === c2.id);
  assert.equal(a.status, 'CANCELLED');
  assert.equal(a.cancelReason, 'NO_CONFIRMATION');
  assert.match((await lastTo(B)).text, /No recibimos tu confirmación/);
  assert.ok((await notifications()).some((n) => n.type === 'NO_CONFIRMATION'));
  assert.match(textOf(await chat(B, `conf:yes:${c2.id}`)), /ya no está activa/);
});

await step('una cita para dentro de pocas horas nace confirmada', async () => {
  const soon = workday(0);
  const res = await ok('GET', `/availability?serviceId=${corte.id}&date=${soon}`, { token: owner });
  const next = res.flatMap((p) => p.slots.map((s) => ({ pro: p.professionalId, start: s.start })))[0];
  if (!next) return console.log('    (sin horarios hoy; se omite)');
  const C = '593980000009';
  await chat(C, { text: 'hola' });
  await chat(C, `svc:${corte.id}`);
  assert.match(textOf(await chat(C, `book:${next.pro}:${new Date(next.start).getTime()}`)), /Te esperamos/);
  const mine = (await appointments(soon)).find((a) => a.customer.phone === C);
  assert.equal(mine.status, 'CONFIRMED');
  await ok('PATCH', `/appointments/${mine.id}/status`, { token: owner, body: { status: 'CANCELLED' } });
});

console.log('\nFila de espera');
const W = ['593980000011', '593980000012', '593980000013', '593980000014'];
let tinteAppt;
const tinteSlot = `book:${maria.id}:${at(D3, '10:00').getTime()}`;
await step('preparación: el día queda completo para Tinte', async () => {
  // María trabaja 10:00–18:00; se bloquea desde 12:15, así solo cabe un tinte (10:00–12:15 con limpieza).
  await ok('POST', '/time-offs', {
    token: owner,
    body: { professionalId: maria.id, startsAt: at(D3, '12:15'), endsAt: at(D3, '18:00'), reason: 'Capacitación' },
  });
  await chat(W[0], { text: 'hola', name: 'Carla' });
  await chat(W[0], `svc:${tinte.id}`);
  assert.match(textOf(await chat(W[0], tinteSlot)), /quedó reservada/);
  tinteAppt = (await appointments(D3))[0];
  assert.equal(new Date(tinteAppt.endsAt) - new Date(tinteAppt.startsAt), 135 * 60_000, 'incluye 15 min de limpieza');
});

await step('con el día lleno, el cliente puede anotarse en la fila', async () => {
  for (const [i, phone] of [W[1], W[2]].entries()) {
    await chat(phone, { text: 'hola', name: ['Diana', 'Elena'][i] });
    const days = await chat(phone, `svc:${tinte.id}`); // un solo profesional: pasa directo a los días
    assert.ok(!ids(days).includes(`day:${D3}`), 'el día lleno no debe ofrecerse');
    assert.ok(ids(await chat(phone, 'wl:ask')).includes(`wlday:${D3}`));
    assert.match(textOf(await chat(phone, `wlday:${D3}`)), /fila de espera/);
  }
  assert.equal((await ok('GET', '/waitlist', { token: owner })).length, 2);
  assert.match(textOf(await chat(W[1], 'menu:mine')), /En fila de espera/);
});

await step('anotarse dos veces no duplica la entrada', async () => {
  await chat(W[1], `svc:${tinte.id}`);
  await chat(W[1], `wlday:${D3}`);
  assert.equal((await ok('GET', '/waitlist', { token: owner })).length, 2);
});

let offer1;
await step('al cancelarse la cita, el cupo se ofrece solo al primero de la fila', async () => {
  const before = (await ok('GET', `/dev/whatsapp/outbox?phone=${W[2]}`)).length;
  await chat(W[0], `cancelok:${tinteAppt.id}`);
  const msg = await lastTo(W[1]);
  assert.match(msg.text, /Se liberó un cupo[\s\S]*Tinte[\s\S]*10:00/);
  offer1 = Number(ids([msg])[0].split(':')[2]);
  assert.equal((await ok('GET', `/dev/whatsapp/outbox?phone=${W[2]}`)).length, before, 'el segundo aún no debe recibir nada');
});

await step('mientras la oferta está vigente nadie más puede tomar el cupo', async () => {
  const avail = await ok('GET', `/availability?serviceId=${tinte.id}&date=${D3}`, { token: owner });
  assert.equal(avail[0].slots.length, 0);
  await chat(W[3], { text: 'hola', name: 'Fabi' });
  await chat(W[3], `svc:${tinte.id}`);
  assert.doesNotMatch(textOf(await chat(W[3], tinteSlot)), /quedó reservada/);
  const r = await http('POST', '/appointments', {
    token: owner,
    body: { customerPhone: '0991234567', serviceId: tinte.id, professionalId: maria.id, startsAt: at(D3, '10:00') },
  });
  assert.equal(r.status, 409);
});

await step('un cliente no puede aceptar la oferta de otro', async () => {
  assert.match(textOf(await chat(W[2], `wl:yes:${offer1}`)), /ya no está disponible/);
});

let offer2;
await step('si el primero la rechaza, pasa al segundo', async () => {
  assert.match(textOf(await chat(W[1], `wl:no:${offer1}`)), /Sigues en la fila/);
  const msg = await lastTo(W[2]);
  assert.match(msg.text, /Se liberó un cupo/);
  offer2 = Number(ids([msg])[0].split(':')[2]);
  assert.notEqual(offer2, offer1);
});

await step('si el segundo no responde, la oferta vence y el cupo queda libre', async () => {
  assert.equal((await tick(new Date(Date.now() + 10 * 60_000))).offersExpired, 0);
  assert.equal((await tick(new Date(Date.now() + 16 * 60_000))).offersExpired, 1);
  assert.match((await lastTo(W[2])).text, /tiempo para aceptar el cupo terminó/);
  assert.match(textOf(await chat(W[2], `wl:yes:${offer2}`)), /ya no está disponible/);
  const avail = await ok('GET', `/availability?serviceId=${tinte.id}&date=${D3}`, { token: owner });
  assert.equal(avail[0].slots.length, 1, 'nadie más en la fila: vuelve a estar disponible');
});

await step('quien acepta a tiempo se queda con el cupo', async () => {
  assert.match(textOf(await chat(W[0], `svc:${tinte.id}`)), /día/);
  assert.match(textOf(await chat(W[0], tinteSlot)), /quedó reservada/);
  const again = (await appointments(D3)).find((a) => a.status === 'PENDING');
  await chat(W[3], `svc:${tinte.id}`);
  await chat(W[3], `wlday:${D3}`);
  await chat(W[0], `cancelok:${again.id}`);
  const msg = await lastTo(W[3]);
  const accept = ids([msg])[0];
  assert.match(accept, /^wl:yes:\d+$/);
  assert.match(textOf(await chat(W[3], accept)), /El cupo es tuyo/);
  const booked = (await appointments(D3)).find((a) => a.customer.phone === W[3] && a.status !== 'CANCELLED');
  assert.ok(booked);
  assert.ok((await notifications()).some((n) => n.type === 'WAITLIST_BOOKED'));
  assert.match(textOf(await chat(W[3], accept)), /ya no está disponible/, 'no se puede aceptar dos veces');
  assert.equal((await appointments(D3)).filter((a) => a.status !== 'CANCELLED').length, 1);
});

await step('salir de la fila desde el chat y desde el panel', async () => {
  const list = await ok('GET', '/waitlist', { token: owner });
  assert.deepEqual(list.map((e) => e.customer.phone).sort(), [W[1], W[2]]);
  const mine = await chat(W[1], 'menu:mine');
  const leave = ids(mine).find((i) => i.startsWith('wlcancel:'));
  assert.match(textOf(await chat(W[1], leave)), /Saliste de la fila/);
  const rest = await ok('GET', '/waitlist', { token: owner });
  assert.equal(rest.length, 1);
  await ok('POST', `/waitlist/${rest[0].id}/remove`, { token: owner });
  assert.equal((await ok('GET', '/waitlist', { token: owner })).length, 0);
});

console.log('\nPanel del dueño');
let newService, newPro, manual;
await step('sesión: datos del local y de la suscripción', async () => {
  const me = await ok('GET', '/me', { token: owner });
  assert.equal(me.tenant.name, 'Peluquería Demo');
  assert.equal(me.subscription.serviceable, true);
  assert.equal((await http('GET', '/me')).status, 401);
});

await step('crear y editar servicios, con validación', async () => {
  newService = await ok('POST', '/services', { token: owner, body: { name: 'Manicure', durationMinutes: 45, priceCents: 1200 } });
  const upd = await ok('PATCH', `/services/${newService.id}`, {
    token: owner,
    body: { name: 'Manicure', durationMinutes: 50, bufferMinutes: 10 },
  });
  assert.equal(upd.durationMinutes, 50);
  assert.equal((await http('POST', '/services', { token: owner, body: { name: 'X', durationMinutes: 0 } })).status, 400);
});

await step('crear profesional con horario y servicios; el bot lo ofrece', async () => {
  const hours = [1, 2, 3, 4, 5].map((weekday) => ({ weekday, startMinute: 600, endMinute: 900 }));
  newPro = await ok('POST', '/professionals', {
    token: owner,
    body: { name: 'Lucía', color: '#aa3377', workingHours: hours, services: [{ serviceId: newService.id }] },
  });
  assert.equal(newPro.workingHours.length, 5);
  assert.ok(ids(await chat(A, 'menu:book')).includes(`svc:${newService.id}`));
});

await step('horarios cruzados o servicios ajenos se rechazan', async () => {
  const bad = await http('PATCH', `/professionals/${newPro.id}`, {
    token: owner,
    body: { name: 'Lucía', workingHours: [{ weekday: 1, startMinute: 600, endMinute: 800 }, { weekday: 1, startMinute: 700, endMinute: 900 }] },
  });
  assert.equal(bad.status, 400);
  const bad2 = await http('PATCH', `/professionals/${newPro.id}`, { token: owner, body: { name: 'Lucía', services: [{ serviceId: 999999 }] } });
  assert.equal(bad2.status, 400);
});

await step('el plan limita la cantidad de profesionales activos', async () => {
  const r = await http('POST', '/professionals', { token: owner, body: { name: 'Cuarto' } });
  assert.equal(r.status, 403);
  assert.match(r.data.message, /hasta 3 profesionales/);
});

await step('cita manual con teléfono local; se normaliza a formato internacional', async () => {
  manual = await ok('POST', '/appointments', {
    token: owner,
    body: { customerPhone: '099 555 1234', customerName: 'Gloria', serviceId: corte.id, professionalId: carlos.id, startsAt: at(D4, '15:00') },
  });
  assert.equal(manual.customer.phone, '593995551234');
  assert.equal(manual.source, 'MANUAL');
  const dup = await http('POST', '/appointments', {
    token: owner,
    body: { customerPhone: '0995550000', serviceId: corte.id, professionalId: carlos.id, startsAt: at(D4, '15:15') },
  });
  assert.equal(dup.status, 409);
  const badPhone = await http('POST', '/appointments', {
    token: owner,
    body: { customerPhone: '12', serviceId: corte.id, professionalId: carlos.id, startsAt: at(D4, '16:00') },
  });
  assert.equal(badPhone.status, 400);
});

await step('un bloqueo impide reservar en ese rango', async () => {
  const off = await ok('POST', '/time-offs', { token: owner, body: { startsAt: at(D4, '09:00'), endsAt: at(D4, '11:00'), reason: 'Feriado local' } });
  const avail = await ok('GET', `/availability?serviceId=${corte.id}&date=${D4}&professionalId=${carlos.id}`, { token: owner });
  assert.ok(avail[0].slots.every((s) => new Date(s.start) >= at(D4, '11:00')));
  const r = await http('POST', '/appointments', {
    token: owner,
    body: { customerPhone: '0995550000', serviceId: corte.id, professionalId: carlos.id, startsAt: at(D4, '09:30') },
  });
  assert.equal(r.status, 409);
  await ok('DELETE', `/time-offs/${off.id}`, { token: owner });
  assert.equal((await http('POST', '/time-offs', { token: owner, body: { startsAt: at(D4, '11:00'), endsAt: at(D4, '09:00') } })).status, 400);
});

await step('reprogramar desde el panel avisa al cliente', async () => {
  const moved = await ok('POST', `/appointments/${manual.id}/reschedule`, {
    token: owner,
    body: { professionalId: maria.id, startsAt: at(D4, '16:00') },
  });
  assert.equal(moved.professional.name, 'María');
  assert.match((await lastTo('593995551234')).text, /movió tu cita[\s\S]*16:00/);
  manual = moved;
});

await step('cambios de estado: atendida, no asistió (cuenta la falta), cancelar avisa', async () => {
  assert.equal((await ok('PATCH', `/appointments/${manual.id}/status`, { token: owner, body: { status: 'COMPLETED' } })).status, 'COMPLETED');
  assert.equal((await http('PATCH', `/appointments/${manual.id}/status`, { token: owner, body: { status: 'CANCELLED' } })).status, 409);
  const second = await ok('POST', '/appointments', {
    token: owner,
    body: { customerPhone: '0995551234', serviceId: corte.id, professionalId: carlos.id, startsAt: at(D4, '17:00') },
  });
  await ok('PATCH', `/appointments/${second.id}/status`, { token: owner, body: { status: 'NO_SHOW' } });
  const customers = await ok('GET', '/customers?q=Gloria', { token: owner });
  assert.equal(customers.length, 1);
  assert.equal(customers[0].noShowCount, 1);
  const third = await ok('POST', '/appointments', {
    token: owner,
    body: { customerPhone: '0995551234', serviceId: corte.id, professionalId: carlos.id, startsAt: at(D4, '18:00') },
  });
  await ok('PATCH', `/appointments/${third.id}/status`, { token: owner, body: { status: 'CANCELLED' } });
  assert.match((await lastTo('593995551234')).text, /tuvo que cancelar tu cita/);
  const detail = await ok('GET', `/customers/${customers[0].id}`, { token: owner });
  assert.equal(detail.appointments.length, 4);
});

await step('bloquear a un cliente: el bot deja de responderle', async () => {
  const [c] = await ok('GET', `/customers?q=${B}`, { token: owner });
  await ok('PATCH', `/customers/${c.id}`, { token: owner, body: { blocked: true, notes: 'Falta seguido' } });
  assert.equal((await chat(B, { text: 'hola' })).length, 0);
  await ok('PATCH', `/customers/${c.id}`, { token: owner, body: { blocked: false } });
  assert.equal((await chat(B, { text: 'hola' })).length, 1);
});

await step('ajustes del local con validación', async () => {
  const t = await ok('PATCH', '/tenant/settings', { token: owner, body: { waitlistOfferMinutes: 20, slotStepMinutes: 30 } });
  assert.equal(t.waitlistOfferMinutes, 20);
  assert.equal((await http('PATCH', '/tenant/settings', { token: owner, body: { slotStepMinutes: 7 } })).status, 400);
  assert.equal((await http('PATCH', '/tenant/settings', { token: owner, body: { status: 'ACTIVE' } })).status, 400);
  await ok('PATCH', '/tenant/settings', { token: owner, body: { waitlistOfferMinutes: 15, slotStepMinutes: 15 } });
});

console.log('\nChat con una persona');
await step('el cliente pide hablar con alguien: el bot se pausa y el dueño es avisado', async () => {
  assert.match(textOf(await chat(A, 'menu:human')), /persona del equipo/);
  assert.equal((await chat(A, { text: '¿Atienden feriados?' })).length, 0);
  const n = await notifications();
  assert.ok(n.some((x) => x.type === 'HUMAN_REQUEST'));
  assert.ok(n.some((x) => x.type === 'MESSAGE' && x.body.includes('feriados')));
});

await step('el dueño ve el chat, responde y devuelve la conversación al bot', async () => {
  const convs = await ok('GET', '/conversations', { token: owner });
  assert.equal(convs[0].customer.phone, A);
  assert.equal(convs[0].humanTakeover, true);
  const cid = convs[0].customer.id;
  const msgs = await ok('GET', `/conversations/${cid}/messages`, { token: owner });
  assert.equal(msgs.at(-1).text, '¿Atienden feriados?');
  assert.ok(msgs.some((m) => m.direction === 'OUT' && m.options.includes('Agendar cita')));
  await ok('POST', `/conversations/${cid}/messages`, { token: owner, body: { text: 'Sí, de 9 a 13.' } });
  assert.equal((await lastTo(A)).text, 'Sí, de 9 a 13.');
  await ok('POST', `/conversations/${cid}/release`, { token: owner });
  assert.equal((await chat(A, { text: 'hola' })).length, 1);
});

await step('avisos: marcar todos como leídos', async () => {
  assert.ok((await ok('GET', '/notifications', { token: owner })).unread > 0);
  await ok('POST', '/notifications/read-all', { token: owner });
  assert.equal((await ok('GET', '/notifications', { token: owner })).unread, 0);
});

console.log('\nPermisos y aislamiento entre locales');
let staff, owner2;
await step('el personal ve la agenda pero no puede cambiar el catálogo', async () => {
  await ok('POST', '/staff', { token: owner, body: { name: 'Recepción', email: 'recepcion@demo.local', password: 'recepcion123' } });
  assert.equal((await http('POST', '/staff', { token: owner, body: { name: 'Otra', email: 'recepcion@demo.local', password: 'recepcion123' } })).status, 409);
  staff = await login('recepcion@demo.local', 'recepcion123');
  assert.equal((await http('GET', `/appointments?date=${D4}`, { token: staff })).status, 200);
  assert.equal((await http('POST', '/services', { token: staff, body: { name: 'Hack', durationMinutes: 30 } })).status, 403);
  assert.equal((await http('PATCH', '/tenant/settings', { token: staff, body: { name: 'Hack' } })).status, 403);
  assert.equal((await http('GET', '/admin/tenants', { token: staff })).status, 403);
  assert.equal((await http('GET', '/admin/tenants', { token: owner })).status, 403);
});

await step('el administrador crea otro local; cada dueño solo ve lo suyo', async () => {
  const body = { name: 'Barbería Dos', slug: 'dos', whatsappNumber: '593990000002', ownerName: 'Otro', ownerEmail: 'otro@dos.local', ownerPassword: 'otro12345' };
  await ok('POST', '/admin/tenants', { token: admin, body });
  assert.equal((await http('POST', '/admin/tenants', { token: admin, body })).status, 409);
  assert.equal((await http('POST', '/admin/tenants', { token: admin, body: { ...body, slug: 'tres', whatsappNumber: '593990000003' } })).status, 409, 'correo repetido');
  owner2 = await login('otro@dos.local', 'otro12345');
  assert.deepEqual(await ok('GET', '/services', { token: owner2 }), []);
  assert.deepEqual(await ok('GET', '/customers', { token: owner2 }), []);
  assert.deepEqual(await ok('GET', `/appointments?date=${D4}`, { token: owner2 }), []);
  assert.equal((await http('PATCH', `/services/${corte.id}`, { token: owner2, body: { name: 'Robado', durationMinutes: 10 } })).status, 404);
  assert.equal((await http('PATCH', `/appointments/${manual.id}/status`, { token: owner2, body: { status: 'CANCELLED' } })).status, 404);
  assert.equal((await http('GET', `/customers/1`, { token: owner2 })).status, 404);
  assert.equal((await http('GET', `/availability?serviceId=${corte.id}&date=${D4}`, { token: owner2 })).status, 404);
  const r = await http('POST', '/appointments', {
    token: owner2,
    body: { customerPhone: '0991112222', serviceId: corte.id, professionalId: carlos.id, startsAt: at(D4, '12:00') },
  });
  assert.equal(r.status, 404);
  assert.equal((await http('GET', '/me', { token: admin })).status, 200);
  assert.equal((await http('GET', '/services', { token: admin })).status, 403);
});

await step('cada número de WhatsApp responde como su propio local', async () => {
  assert.match(textOf(await chat(A, { text: 'hola' }, '593990000002')), /Barbería Dos/);
  assert.match(textOf(await chat(A, { text: 'hola' })), /Peluquería Demo/);
  assert.equal((await chat(A, { text: 'hola' }, '593999999999')).length, 0, 'número no registrado: sin respuesta');
  assert.match(textOf(await chat(A, 'menu:book', '593990000002')), /no hay servicios/);
});

console.log('\nAdministrador general y suscripciones');
await step('listado con estado real, dueño y consumo', async () => {
  const list = await ok('GET', '/admin/tenants', { token: admin });
  const demo = list.find((t) => t.slug === 'demo');
  assert.equal(demo.serviceable, true);
  assert.equal(demo.owner.email, 'dueno@demo.local');
  assert.equal(demo.usage.professionals, 3);
  assert.ok(demo.usage.messagesThisMonth > 20);
  assert.equal((await ok('GET', '/admin/plans', { token: admin })).length, 3);
});

await step('local suspendido: el bot da un solo aviso por cliente', async () => {
  const demoId = (await ok('GET', '/admin/tenants', { token: admin })).find((t) => t.slug === 'demo').id;
  await ok('PATCH', `/admin/tenants/${demoId}/status`, { token: admin, body: { status: 'SUSPENDED' } });
  const Z = '593980000099';
  assert.match(textOf(await chat(Z, { text: 'hola' })), /no estamos recibiendo reservas/);
  assert.equal((await chat(Z, { text: 'hola?' })).length, 0);
  assert.equal((await ok('GET', '/me', { token: owner })).subscription.reason, 'SUSPENDED');
  assert.equal((await http('PATCH', `/admin/tenants/${demoId}/status`, { token: admin, body: { status: 'BORRADO' } })).status, 400);

  await step('registrar un pago reactiva el local y fija el vencimiento', async () => {
    const sub = await ok('POST', `/admin/tenants/${demoId}/payments`, {
      token: admin,
      body: { planCode: 'PRO', months: 1, amountCents: 3000, method: 'TRANSFER', reference: 'Pichincha 0001' },
    });
    assert.ok(new Date(sub.currentPeriodEnd) > new Date(Date.now() + 27 * 86_400_000));
    const me = await ok('GET', '/me', { token: owner });
    assert.equal(me.subscription.serviceable, true);
    assert.equal(me.subscription.plan, 'Profesional');
    assert.equal((await chat(Z, { text: 'hola' })).length, 1);
    // Con plan Profesional (6) ya se puede crear el cuarto profesional.
    assert.equal((await http('POST', '/professionals', { token: owner, body: { name: 'Cuarto' } })).status, 201);
    assert.equal((await http('POST', `/admin/tenants/${demoId}/payments`, { token: admin, body: { planCode: 'NOEXISTE', months: 1, amountCents: 1, method: 'X' } })).status, 404);
  });

  await step('al pasar la fecha de vencimiento la suscripción se marca como vencida', async () => {
    const me = await ok('GET', '/me', { token: owner });
    const end = new Date(me.subscription.validUntil);
    assert.equal((await tick(new Date(end.getTime() + 86_400_000))).subscriptionsPastDue, 1);
    // El corte real depende del reloj del servidor; aquí solo se verifica que se marcó como vencida.
    assert.equal((await ok('GET', '/me', { token: owner })).subscription.serviceable, true, 'sigue activo: el reloj real no ha pasado');
  });
});

console.log(`\n${passed} comprobaciones superadas ✔`);
