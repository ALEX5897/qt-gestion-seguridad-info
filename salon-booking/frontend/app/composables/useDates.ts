// Utilidades de fecha y hora en la zona horaria del local.
export function useDates() {
  const { tz } = useSession();

  const fmt = (opts: Intl.DateTimeFormatOptions) => (d: string | Date) =>
    new Intl.DateTimeFormat('es-EC', { timeZone: tz.value, ...opts }).format(new Date(d));

  const time = fmt({ hour: '2-digit', minute: '2-digit', hour12: false });
  const dayLong = fmt({ weekday: 'long', day: 'numeric', month: 'long' });
  const dayShort = fmt({ weekday: 'short', day: 'numeric', month: 'short' });
  const dateTime = fmt({ weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', hour12: false });

  /** Fecha local YYYY-MM-DD de un instante. */
  const isoDate = (d: string | Date = new Date()) =>
    new Intl.DateTimeFormat('en-CA', { timeZone: tz.value, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(d));

  const addDays = (date: string, n: number) =>
    new Date(Date.parse(date + 'T12:00:00Z') + n * 86_400_000).toISOString().slice(0, 10);

  /** "lunes 16 de noviembre" a partir de YYYY-MM-DD (sin depender de la zona). */
  const labelOf = (date: string) =>
    new Intl.DateTimeFormat('es-EC', { timeZone: 'UTC', weekday: 'long', day: 'numeric', month: 'long' }).format(
      new Date(date + 'T12:00:00Z'),
    );

  /** Convierte "YYYY-MM-DDTHH:mm" (hora del local) en un instante ISO. */
  function zonedToIso(local: string) {
    const guess = new Date(local + ':00Z');
    const parts = Object.fromEntries(
      new Intl.DateTimeFormat('en-CA', {
        timeZone: tz.value, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
      }).formatToParts(guess).map((p) => [p.type, p.value]),
    );
    const shown = Date.parse(`${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}:00Z`);
    return new Date(guess.getTime() - (shown - guess.getTime())).toISOString();
  }

  const minutesToHHMM = (m: number) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
  const hhmmToMinutes = (s: string) => { const [h, m] = s.split(':').map(Number); return h * 60 + m; };
  const money = (cents: number | null | undefined) => (cents == null ? '' : `$${(cents / 100).toFixed(2)}`);

  return { time, dayLong, dayShort, dateTime, isoDate, addDays, labelOf, zonedToIso, minutesToHHMM, hhmmToMinutes, money };
}

export const STATUS_LABEL: Record<string, string> = {
  PENDING: 'Por confirmar',
  CONFIRMED: 'Confirmada',
  COMPLETED: 'Atendida',
  CANCELLED: 'Cancelada',
  NO_SHOW: 'No asistió',
};
export const WEEKDAYS = ['Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado', 'Domingo'];
