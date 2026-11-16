import { DateTime } from 'luxon';

export const money = (cents: number) => `$${(cents / 100).toFixed(2)}`;
export const time = (d: Date, tz: string) => DateTime.fromJSDate(d, { zone: tz }).toFormat('HH:mm');
export const isoDate = (d: Date, tz: string) => DateTime.fromJSDate(d, { zone: tz }).toISODate()!;
export const shortDay = (d: Date, tz: string) =>
  DateTime.fromJSDate(d, { zone: tz }).setLocale('es').toFormat('ccc d/LL');
/** "lunes 16 de noviembre" a partir de una fecha local YYYY-MM-DD. */
export const dayLong = (date: string, tz: string) =>
  DateTime.fromISO(date, { zone: tz }).setLocale('es').toFormat("cccc d 'de' LLLL");
export const dayLongOf = (d: Date, tz: string) => dayLong(isoDate(d, tz), tz);

/**
 * Normaliza un teléfono al formato internacional sin "+".
 * Acepta formatos locales de Ecuador: 0991234567 → 593991234567.
 */
export function normalizePhone(raw: string): string | null {
  let digits = raw.replace(/\D/g, '');
  if (digits.startsWith('00')) digits = digits.slice(2);
  if (/^0\d{8,9}$/.test(digits)) digits = '593' + digits.slice(1);
  else if (/^9\d{8}$/.test(digits)) digits = '593' + digits;
  return /^[1-9]\d{7,14}$/.test(digits) ? digits : null;
}
