import { optionsOf, phoneFromJid, resolveChoice, toPlainText } from './baileys.format';

const buttons = {
  type: 'buttons' as const,
  text: '¿Qué deseas hacer?',
  buttons: [
    { id: 'menu:book', title: 'Agendar cita' },
    { id: 'menu:mine', title: 'Mis citas' },
  ],
};

describe('toPlainText', () => {
  it('numera botones', () => {
    expect(toPlainText(buttons)).toBe(
      '¿Qué deseas hacer?\n\n*1.* Agendar cita\n*2.* Mis citas\n\n_Responde con el número de la opción._',
    );
  });
  it('numera filas con su descripción', () => {
    const t = toPlainText({
      type: 'list',
      text: 'Servicios',
      buttonLabel: 'Ver',
      rows: [
        { id: 'svc:1', title: 'Corte', description: '30 min · $8.00' },
        { id: 'svc:2', title: 'Barba', description: '' },
      ],
    });
    expect(t).toContain('*1.* Corte — 30 min · $8.00');
    expect(t).toContain('*2.* Barba\n');
  });
  it('deja el texto simple igual', () => expect(toPlainText({ type: 'text', text: 'Hola' })).toBe('Hola'));
});

describe('resolveChoice', () => {
  const options = optionsOf(JSON.stringify(buttons));
  it('acepta el número, con o sin punto', () => {
    expect(resolveChoice('1', options)).toBe('menu:book');
    expect(resolveChoice(' 2. ', options)).toBe('menu:mine');
  });
  it('acepta el texto de la opción sin importar mayúsculas ni tildes', () => {
    expect(resolveChoice('MIS CITAS', options)).toBe('menu:mine');
    expect(resolveChoice('agendar cita!', options)).toBe('menu:book');
  });
  it('no inventa opciones', () => {
    expect(resolveChoice('3', options)).toBeUndefined();
    expect(resolveChoice('0', options)).toBeUndefined();
    expect(resolveChoice('quiero un corte mañana', options)).toBeUndefined();
    expect(resolveChoice('1', optionsOf('{"type":"text","text":"hola"}'))).toBeUndefined();
    expect(resolveChoice('1', optionsOf('no es json'))).toBeUndefined();
  });
});

describe('phoneFromJid', () => {
  it('extrae el teléfono de un chat individual', () => {
    expect(phoneFromJid('593991234567@s.whatsapp.net')).toBe('593991234567');
    expect(phoneFromJid('593991234567:12@s.whatsapp.net')).toBe('593991234567');
  });
  it('ignora grupos, estados y canales', () => {
    expect(phoneFromJid('120363000000000000@g.us')).toBeNull();
    expect(phoneFromJid('status@broadcast')).toBeNull();
    expect(phoneFromJid('123@newsletter')).toBeNull();
    expect(phoneFromJid(undefined)).toBeNull();
  });
});
