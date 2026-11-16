const { chromium } = require('playwright');
const assert = require('assert');
// Prueba de interfaz en navegador (Playwright). Requiere: base recién sembrada, backend con
// WHATSAPP_PROVIDER=console AUTOMATION_ENABLED=false y el frontend generado servido (node test/serve.cjs).
const API = process.env.API_URL ?? 'http://localhost:3001/api';
const UI = process.env.UI_URL ?? 'http://localhost:3000';
const SHOTS = process.env.SHOTS_DIR ?? require('os').tmpdir();
const shot = (page, name) => page.screenshot({ path: `${SHOTS}/${name}.png`, fullPage: false });
const sim = (from, body) => fetch(API + '/dev/whatsapp/simulate', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ to: '593990000001', from, ...body }) }).then((r) => r.json());
const ecToday = () => new Date(Date.now() - 5 * 3600e3).toISOString().slice(0, 10);
const addDays = (d, n) => new Date(Date.parse(d + 'T12:00:00Z') + n * 864e5).toISOString().slice(0, 10);
let D = addDays(ecToday(), 5); while (new Date(D + 'T12:00:00Z').getUTCDay() === 0) D = addDays(D, 1);
let n = 0;
const ok = (name) => console.log(`  ✓ ${++n}. ${name}`);

(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, locale: 'es-EC' });
  const page = await ctx.newPage();
  const errors = [];
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('dialog', (d) => d.accept());

  async function login(email, password) {
    await page.goto(UI + '/login');
    await page.fill('#email', email);
    await page.fill('#password', password);
    await page.click('button:has-text("Ingresar")');
  }

  // ── Sesión ──
  await page.goto(UI + '/');
  await page.waitForURL('**/login');
  ok('sin sesión redirige al inicio de sesión');
  await shot(page, '01-login');
  await login('dueno@demo.local', 'incorrecta');
  await page.waitForSelector('.error:has-text("Credenciales inválidas")');
  ok('contraseña incorrecta muestra el error');
  await login('dueno@demo.local', 'demo12345');
  await page.waitForSelector('h1:has-text("Peluquería Demo")');
  await page.waitForSelector('text=No hay citas para este día');
  ok('el dueño entra a la agenda de hoy');

  // ── Catálogo ──
  await page.click('nav >> text=Catálogo');
  await page.waitForSelector('text=Corte de cabello');
  await page.click('.fab');
  await page.fill('#s-name', 'Manicure');
  await page.fill('#s-dur', '45');
  await page.fill('#s-price', '12.50');
  await page.click('button:has-text("Guardar")');
  await page.waitForSelector('.card:has-text("Manicure") >> text=$12.50');
  ok('crear servicio');
  await page.click('button[role=tab]:has-text("Equipo")');
  await page.waitForSelector('.card:has-text("Carlos")');
  await page.click('.fab');
  await page.fill('#p-name', 'Lucía');
  await page.check('label:has-text("Manicure") input');
  await page.uncheck('label.check:has-text("Sábado") input');
  await shot(page, '02-profesional');
  await page.click('button:has-text("Guardar")');
  await page.waitForSelector('.card:has-text("Lucía") >> text=Lu · Ma · Mi · Ju · Vi · 1 servicio(s)');
  ok('crear profesional con horario y servicios');
  await page.click('.fab');
  await page.fill('#p-name', 'Cuarto');
  await page.click('button:has-text("Guardar")');
  await page.waitForSelector('.error:has-text("hasta 3 profesionales")');
  await page.click('[aria-label=Cerrar]');
  ok('el límite del plan se explica en pantalla');

  // ── Agenda: nueva cita ──
  await page.click('nav >> text=Agenda');
  await page.click('.fab');
  await page.fill('#c-phone', '0991112233');
  await page.fill('#c-name', 'Rosa Vera');
  await page.selectOption('#c-service', { label: 'Corte de cabello (30 min)' });
  await page.fill('#slot-date', D);
  await page.waitForSelector('.slots button');
  assert.ok((await page.locator('.slots button').count()) > 20);
  await page.click('.slots button:has-text("10:00")');
  await page.waitForSelector('text=Con Carlos');
  await shot(page, '03-nueva-cita');
  await page.click('button:has-text("Guardar cita")');
  await page.waitForSelector('.card:has-text("Rosa Vera")');
  assert.equal(await page.inputValue('input[type=date]'), D);
  ok('crear cita manual y saltar a su día');

  // un cliente reserva por WhatsApp el mismo día
  const token = (await (await fetch(API + '/auth/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: 'dueno@demo.local', password: 'demo12345' }) })).json()).accessToken;
  const svcs = await (await fetch(API + '/services', { headers: { authorization: 'Bearer ' + token } })).json();
  const corte = svcs.find((s) => s.name === 'Corte de cabello').id;
  await sim('593987000001', { text: 'hola', name: 'Ana Pérez' });
  await sim('593987000001', { replyId: `svc:${corte}` });
  const start = new Date(`${D}T11:00:00-05:00`).getTime();
  const r = await sim('593987000001', { replyId: `book:1:${start}` });
  assert.match(r[0].text, /reservada/);
  await page.reload();
  await page.waitForSelector('.card:has-text("Ana Pérez")');
  assert.equal(await page.locator('main button.card').count(), 2);
  await shot(page, '04-agenda');
  ok('la reserva hecha por WhatsApp aparece en la agenda');

  // ── Acciones sobre la cita ──
  await page.click('.card:has-text("Rosa Vera")');
  await page.click('button:has-text("Marcar confirmada")');
  await page.waitForSelector('.card:has-text("Rosa Vera") .chip.CONFIRMED');
  ok('marcar confirmada');
  await page.click('.card:has-text("Rosa Vera")');
  await page.click('button:has-text("Reprogramar")');
  await page.waitForSelector('.slots button');
  assert.equal(await page.locator('.slots button:has-text("11:00")').count() , 1, 'María sigue libre a las 11:00');
  await page.click('.slots button:has-text("15:30")');
  await page.click('button:has-text("Mover cita")');
  await page.waitForSelector('.card:has-text("Rosa Vera") >> text=15:30');
  ok('reprogramar desde el panel');
  await page.click('.card:has-text("Ana Pérez")');
  await shot(page, '05-detalle');
  await page.click('button:has-text("Cancelar cita")');
  await page.waitForSelector('text=Ver canceladas (2)');
  ok('cancelar cita (con confirmación) y ocultarla de la lista');
  await page.click('.card:has-text("Rosa Vera")');
  await page.click('button:has-text("Atendida")');
  await page.waitForSelector('.card:has-text("Rosa Vera") .chip.COMPLETED');
  ok('marcar atendida');

  // ── Chats ──
  await sim('593987000001', { replyId: 'menu:human' });
  await sim('593987000001', { text: '¿Tienen parqueadero?' });
  await page.click('nav >> text=Chats');
  await page.waitForSelector('.card:has-text("Ana Pérez") >> text=Espera tu respuesta');
  await page.waitForSelector('nav .badge:has-text("1")');
  await page.click('.card:has-text("Ana Pérez")');
  await page.waitForSelector('.bubble:has-text("¿Tienen parqueadero?")');
  await page.waitForSelector('.bubble:has-text("Pulsó: Hablar con alguien")');
  assert.equal(await page.locator('.bubble:has-text("menu:human")').count(), 0);
  await page.fill('[aria-label=Mensaje]', 'Sí, gratis para clientes.');
  await page.click('button:has-text("Enviar")');
  await page.waitForSelector('.bubble.out:has-text("Sí, gratis para clientes.")');
  await shot(page, '06-chat');
  await page.click('button:has-text("Devolver al bot")');
  await page.waitForSelector('.sheet >> text=Atiende el bot');
  await page.click('[aria-label=Cerrar]');
  assert.equal((await sim('593987000001', { text: 'hola' })).length, 1);
  ok('chat: ver mensajes, responder en persona y devolver al bot');

  // ── Avisos ──
  await page.reload();
  await page.waitForSelector('[aria-label=Avisos] .badge');
  await page.click('[aria-label=Avisos]');
  await page.waitForSelector('.sheet >> text=Nueva cita por WhatsApp');
  await page.waitForSelector('.sheet >> text=Un cliente quiere hablar con una persona');
  await shot(page, '07-avisos');
  await page.click('[aria-label=Cerrar]');
  await page.waitForSelector('[aria-label=Avisos] .badge', { state: 'detached' });
  ok('avisos con contador que se limpia al abrir');

  // ── Clientes ──
  await page.click('nav >> text=Clientes');
  await page.waitForSelector('.card:has-text("Rosa Vera")');
  await page.fill('[aria-label="Buscar cliente"]', 'ana');
  await page.waitForSelector('.card:has-text("Rosa Vera")', { state: 'detached' });
  await page.click('.card:has-text("Ana Pérez")');
  await page.fill('#cu-notes', 'Prefiere a Carlos');
  await page.waitForSelector('.sheet >> text=Cancelada');
  await page.click('.sheet button:has-text("Guardar")');
  await page.waitForSelector('.sheet', { state: 'detached' });
  await page.click('.card:has-text("Ana Pérez")');
  assert.equal(await page.inputValue('#cu-notes'), 'Prefiere a Carlos');
  await page.click('[aria-label=Cerrar]');
  ok('clientes: buscar, historial y notas');

  // ── Más ──
  await page.click('nav >> text=Más');
  await page.waitForSelector('text=Período de prueba');
  await shot(page, '08-mas');
  await page.click('.card:has-text("Bloqueos")');
  await page.fill('#o-from', `${D}T09:00`);
  await page.fill('#o-to', `${D}T12:00`);
  await page.fill('#o-reason', 'Feriado');
  await page.click('button:has-text("Agregar bloqueo")');
  await page.waitForSelector('.card:has-text("Todo el local") >> text=Feriado');
  const offs = await (await fetch(API + '/time-offs', { headers: { authorization: 'Bearer ' + token } })).json();
  assert.equal(offs[0].startsAt, new Date(`${D}T09:00:00-05:00`).toISOString(), 'la hora del local se convierte bien a UTC');
  await page.click('.card:has-text("Feriado") >> text=Quitar');
  await page.waitForSelector('text=No hay bloqueos');
  ok('bloqueos: crear (hora local correcta) y quitar');
  await page.click('text=‹ Volver');
  await page.click('.card:has-text("Ajustes del local")');
  await page.fill('#t-address', 'Av. Amazonas N34-12, Quito');
  await page.fill('#t-wl', '20');
  await page.click('button:has-text("Guardar ajustes")');
  await page.waitForSelector('text=Cambios guardados');
  await page.fill('#t-wl', '2');
  await page.click('button:has-text("Guardar ajustes")');
  assert.equal(await page.locator('text=Cambios guardados').count(), 0, 'el navegador bloquea valores fuera de rango');
  ok('ajustes: guardar y validar');
  await page.click('text=‹ Volver');
  await page.click('.card:has-text("Personal")');
  await page.fill('#st-name', 'Recepción');
  await page.fill('#st-email', 'recepcion@demo.local');
  await page.fill('#st-pass', 'recepcion123');
  await page.click('button:has-text("Crear cuenta")');
  await page.waitForSelector('.card:has-text("recepcion@demo.local")');
  ok('crear cuenta de personal');
  await page.click('text=‹ Volver');
  await page.click('.card:has-text("Fila de espera")');
  await page.waitForSelector('text=Nadie está en fila de espera');
  ok('fila de espera vacía');

  // ── Personal: permisos ──
  await page.click('text=‹ Volver');
  await page.click('button:has-text("Cerrar sesión")');
  await page.waitForURL('**/login');
  await login('recepcion@demo.local', 'recepcion123');
  await page.waitForSelector('h1:has-text("Peluquería Demo")');
  await page.click('nav >> text=Catálogo');
  await page.waitForSelector('text=Manicure');
  assert.equal(await page.locator('.fab').count(), 0);
  await page.click('nav >> text=Más');
  await page.waitForSelector('text=Fila de espera');
  assert.equal(await page.locator('text=Ajustes del local').count(), 0);
  await page.goto(UI + '/admin');
  await page.waitForSelector('h1:has-text("Peluquería Demo")');
  assert.ok(!page.url().includes('/admin'));
  ok('el personal no ve opciones de configuración ni el panel de administración');

  // ── Administrador ──
  await page.click('nav >> text=Más');
  await page.click('button:has-text("Cerrar sesión")');
  await login('admin@plataforma.local', 'admin12345');
  await page.waitForSelector('h1:has-text("Administración de la plataforma")');
  await page.waitForSelector('[data-tenant=demo] >> text=En prueba');
  await page.click('button:has-text("Nuevo local")');
  await page.fill('#n-name', 'Barbería El Corte');
  assert.equal(await page.inputValue('#n-slug'), 'barberia-el-corte');
  await page.fill('#n-wa', '+593 99 000 0002');
  await page.fill('#n-oname', 'Pedro');
  await page.fill('#n-oemail', 'dueno@demo.local');
  await page.fill('#n-opass', 'pedro12345');
  await page.click('button:has-text("Crear local")');
  await page.waitForSelector('.error:has-text("Ya existe un usuario con ese correo")');
  await page.fill('#n-oemail', 'pedro@elcorte.local');
  await page.click('button:has-text("Crear local")');
  await page.waitForSelector('[data-tenant=barberia-el-corte] >> text=+593990000002');
  ok('administrador: crear local (con error de correo repetido)');
  await page.click('[data-tenant=demo] >> text=Suspender');
  await page.waitForSelector('[data-tenant=demo] >> text=Suspendido');
  assert.match((await sim('593987000077', { text: 'hola' }))[0].text, /no estamos recibiendo/);
  ok('suspender: el bot deja de atender');
  await page.click('[data-tenant=demo] >> text=Registrar pago');
  await page.selectOption('#y-plan', 'PRO');
  await page.fill('#y-months', '3');
  assert.equal(await page.inputValue('#y-amount'), '90.00');
  await page.fill('#y-ref', 'Transferencia 4455');
  await shot(page, '09-pago');
  await page.click('button:has-text("Guardar pago")');
  await page.waitForSelector('[data-tenant=demo] >> text=Activo');
  await page.waitForSelector('[data-tenant=demo] >> text=Plan Profesional');
  assert.equal((await sim('593987000078', { text: 'hola' })).length, 1);
  await page.setViewportSize({ width: 1100, height: 800 });
  await shot(page, '10-admin');
  ok('registrar pago calcula el monto, reactiva el local y el bot vuelve a atender');
  await page.goto(UI + '/');
  await page.waitForURL('**/admin');
  ok('el administrador no entra al panel de un local');

  // ── Dueño con cuenta suspendida ve el aviso ──
  await page.setViewportSize({ width: 390, height: 844 });
  await page.click('[data-tenant=barberia-el-corte] >> text=Suspender');
  await page.waitForSelector('[data-tenant=barberia-el-corte] >> text=Suspendido');
  await page.click('button:has-text("Salir")');
  await login('pedro@elcorte.local', 'pedro12345');
  await page.waitForSelector('.banner:has-text("Tu cuenta está suspendida")');
  await page.click('nav >> text=Catálogo');
  await page.waitForSelector('text=Crea tu primer servicio');
  await shot(page, '11-suspendido');
  ok('un local nuevo empieza vacío y el dueño suspendido ve el aviso');

  // ── PWA ──
  const manifest = await (await fetch(UI + '/manifest.webmanifest')).json();
  assert.equal(manifest.display, 'standalone');
  const sw = await page.evaluate(() => navigator.serviceWorker.getRegistration().then((r) => !!r));
  assert.ok(sw, 'service worker registrado');
  ok('instalable: manifiesto y service worker');

  await browser.close();
  const real = errors.filter((e) => !/401|403|409|Failed to load resource/.test(e));
  if (real.length) { console.log('Errores de consola:', real); process.exit(1); }
  console.log(`\n${n} comprobaciones de interfaz superadas ✔ (sin errores de consola)`);
})().catch((e) => { console.error('\n✗ FALLO:', e.message.split('\n').slice(0, 6).join('\n')); process.exit(1); });
