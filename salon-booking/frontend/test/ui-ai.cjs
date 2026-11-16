// Prueba de interfaz de las funciones de IA. Requiere lo mismo que test/ui.cjs más el backend con
// ANTHROPIC_API_KEY=test ANTHROPIC_BASE_URL=http://localhost:4010 y `node ../backend/test/fake-claude.mjs`.
const { chromium } = require('playwright');
const assert = require('assert');
const API = process.env.API_URL ?? 'http://localhost:3001/api';
const UI = process.env.UI_URL ?? 'http://localhost:3000';
const SHOTS = process.env.SHOTS_DIR ?? require('os').tmpdir();
let n = 0;
const ok = (name) => console.log(`  ✓ ${++n}. ${name}`);

(async () => {
  const browser = await chromium.launch();
  const page = await (await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 })).newPage();
  const errors = [];
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  page.on('pageerror', (e) => errors.push(String(e)));

  await page.goto(UI + '/login');
  await page.fill('#email', 'dueno@demo.local');
  await page.fill('#password', 'demo12345');
  await page.click('button:has-text("Ingresar")');
  await page.waitForSelector('h1:has-text("Peluquería Demo")');

  // Ajustes: asistente e invitaciones
  await page.click('nav >> text=Más');
  await page.click('.card:has-text("Ajustes del local")');
  await page.waitForSelector('text=Este mes: 0 de 100 respuestas');
  assert.ok(await page.isChecked('label:has-text("Responder con IA") input'));
  assert.match(await page.inputValue('#t-info'), /parqueadero gratuito/);
  await page.fill('#t-info', 'Aceptamos tarjeta. Promo: martes 2x1 en barba.');
  await page.selectOption('#t-winback', '30');
  await page.click('button:has-text("Guardar ajustes")');
  await page.waitForSelector('text=Cambios guardados');
  await page.locator('#t-info').scrollIntoViewIfNeeded();
  await page.screenshot({ path: `${SHOTS}/12-ajustes-ia.png` });
  ok('ajustes: asistente con IA, información del local e invitación a volver');

  // El asistente usa de inmediato la información nueva
  const sim = (body) => fetch(API + '/dev/whatsapp/simulate', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ to: '593990000001', from: '593960000001', ...body }) }).then((r) => r.json());
  await sim({ text: 'hola', name: 'Ana' });
  const [reply] = await sim({ text: '¿Cuánto cuesta el corte?' });
  assert.match(reply.text, /\$8\.00/);
  const reqs = await (await fetch('http://localhost:4010/_requests')).json();
  assert.match(reqs.at(-1).body.system[0].text, /martes 2x1 en barba/);
  await page.reload();
  await page.click('.card:has-text("Ajustes del local")');
  await page.waitForSelector('text=Este mes: 1 de 100 respuestas');
  assert.equal(await page.inputValue('#t-winback'), '30');
  ok('el asistente responde con la información nueva y el contador de uso sube');

  // Consejos
  await page.click('text=‹ Volver');
  await page.click('.card:has-text("Consejos del negocio")');
  await page.waitForSelector('.tile');
  assert.equal(await page.locator('.tile').count(), 8);
  await page.waitForSelector('text=Ocupación por día');
  await page.click('button:has-text("Generar análisis")');
  await page.waitForSelector('[data-consejo]');
  assert.equal(await page.locator('[data-consejo]').count(), 3);
  await page.waitForSelector('text=Impacto alto');
  await page.waitForSelector('button:has-text("Actualizar análisis")');
  await page.screenshot({ path: `${SHOTS}/13-consejos.png`, fullPage: true });
  ok('consejos: indicadores y análisis con IA');
  await page.reload();
  await page.waitForSelector('[data-consejo]');
  ok('el análisis queda guardado al recargar');

  await browser.close();
  const real = errors.filter((e) => !/Failed to load resource/.test(e));
  if (real.length) { console.log('Errores de consola:', real); process.exit(1); }
  console.log(`\n${n} comprobaciones de interfaz de IA superadas ✔`);
})().catch((e) => { console.error('\n✗ FALLO:', e.message.split('\n').slice(0, 6).join('\n')); process.exit(1); });
