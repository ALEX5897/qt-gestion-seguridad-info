import { normalizePhone } from './format';

describe('normalizePhone', () => {
  it('convierte celulares locales de Ecuador', () => {
    expect(normalizePhone('099 123 4567')).toBe('593991234567');
    expect(normalizePhone('991234567')).toBe('593991234567');
  });
  it('convierte fijos locales (02 2345678)', () => expect(normalizePhone('02 234-5678')).toBe('59322345678'));
  it('respeta números ya internacionales', () => {
    expect(normalizePhone('+593 99 123 4567')).toBe('593991234567');
    expect(normalizePhone('0015551234567')).toBe('15551234567');
  });
  it('rechaza valores inválidos', () => {
    expect(normalizePhone('123')).toBeNull();
    expect(normalizePhone('abc')).toBeNull();
  });
});
