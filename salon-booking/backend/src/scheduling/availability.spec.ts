import { computeAvailableSlots, isoWeekday, SlotQuery } from './availability';

const TZ = 'America/Guayaquil'; // UTC-5, sin horario de verano

/** Hora local de Ecuador → Date UTC. */
const ec = (date: string, hhmm: string) => new Date(`${date}T${hhmm}:00-05:00`);
const hhmm = (d: Date) =>
  d.toLocaleTimeString('es-EC', { timeZone: TZ, hour: '2-digit', minute: '2-digit', hour12: false });

const base = (over: Partial<SlotQuery> = {}): SlotQuery => ({
  date: '2026-11-16',
  timezone: TZ,
  workingHours: [{ startMinute: 9 * 60, endMinute: 12 * 60 }],
  busy: [],
  durationMinutes: 30,
  stepMinutes: 30,
  now: ec('2026-11-15', '08:00'),
  ...over,
});

describe('computeAvailableSlots', () => {
  it('ofrece todos los horarios de una jornada libre', () => {
    const slots = computeAvailableSlots(base());
    expect(slots.map((s) => hhmm(s.start))).toEqual(['09:00', '09:30', '10:00', '10:30', '11:00', '11:30']);
  });

  it('respeta la zona horaria del local', () => {
    const [first] = computeAvailableSlots(base());
    expect(first.start.toISOString()).toBe('2026-11-16T14:00:00.000Z');
  });

  it('el servicio completo debe caber antes del cierre', () => {
    const slots = computeAvailableSlots(base({ durationMinutes: 90 }));
    expect(slots.map((s) => hhmm(s.start))).toEqual(['09:00', '09:30', '10:00', '10:30']);
  });

  it('excluye horarios que se cruzan con citas existentes', () => {
    const slots = computeAvailableSlots(
      base({ busy: [{ start: ec('2026-11-16', '10:00'), end: ec('2026-11-16', '11:00') }] }),
    );
    expect(slots.map((s) => hhmm(s.start))).toEqual(['09:00', '09:30', '11:00', '11:30']);
  });

  it('el buffer no puede pisar la cita siguiente, pero sí pasar del cierre', () => {
    const slots = computeAvailableSlots(
      base({
        bufferMinutes: 15,
        busy: [{ start: ec('2026-11-16', '10:00'), end: ec('2026-11-16', '10:30') }],
      }),
    );
    // 09:30 + 30 min + 15 buffer = 10:15 → choca. 11:30 termina 12:00 y el buffer pasa al cierre: permitido.
    expect(slots.map((s) => hhmm(s.start))).toEqual(['09:00', '10:30', '11:00', '11:30']);
    expect(hhmm(slots[0].blockedUntil)).toBe('09:45');
  });

  it('soporta jornadas partidas (descanso de almuerzo)', () => {
    const slots = computeAvailableSlots(
      base({
        workingHours: [
          { startMinute: 14 * 60, endMinute: 15 * 60 },
          { startMinute: 9 * 60, endMinute: 10 * 60 },
        ],
      }),
    );
    expect(slots.map((s) => hhmm(s.start))).toEqual(['09:00', '09:30', '14:00', '14:30']);
  });

  it('aplica la anticipación mínima', () => {
    const slots = computeAvailableSlots(
      base({ date: '2026-11-15', now: ec('2026-11-15', '09:10'), minAdvanceMinutes: 60 }),
    );
    expect(slots.map((s) => hhmm(s.start))).toEqual(['10:30', '11:00', '11:30']);
  });

  it('devuelve vacío sin horario laboral o con parámetros inválidos', () => {
    expect(computeAvailableSlots(base({ workingHours: [] }))).toEqual([]);
    expect(computeAvailableSlots(base({ durationMinutes: 0 }))).toEqual([]);
    expect(() => computeAvailableSlots(base({ date: 'no-es-fecha' }))).toThrow();
  });
});

describe('isoWeekday', () => {
  it('2026-11-16 es lunes', () => expect(isoWeekday('2026-11-16', TZ)).toBe(1));
});
