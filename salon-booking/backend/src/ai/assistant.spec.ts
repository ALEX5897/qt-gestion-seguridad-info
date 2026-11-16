import { compose } from './assistant.service';

describe('compose (mensaje final del asistente)', () => {
  it('texto solo cuando no hay botones ni horarios', () => {
    expect(compose('Hola', [], [])).toEqual({ type: 'text', text: 'Hola' });
  });

  it('los horarios tienen prioridad y se limitan a 10 filas', () => {
    const rows = Array.from({ length: 12 }, (_, i) => ({ id: `slot:1:${i}`, title: `h${i}` }));
    const m = compose('Elige', rows, [{ id: 'menu:book', title: 'Agendar' }]);
    expect(m.type).toBe('list');
    expect(m.type === 'list' && m.rows).toHaveLength(10);
  });

  it('máximo 3 botones', () => {
    const buttons = [1, 2, 3, 4].map((i) => ({ id: `b${i}`, title: `B${i}` }));
    const m = compose('Opciones', [], buttons);
    expect(m.type === 'buttons' && m.buttons).toHaveLength(3);
  });

  it('recorta textos más largos que el límite de WhatsApp', () => {
    const m = compose('x'.repeat(1500), [], []);
    expect(m.text.length).toBe(1000);
    expect(m.text.endsWith('…')).toBe(true);
  });
});
