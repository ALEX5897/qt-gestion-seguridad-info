import { DateTime } from 'luxon';

/** Rango de trabajo en minutos desde la medianoche local (ej. 540 = 09:00). */
export interface MinuteRange {
  startMinute: number;
  endMinute: number;
}

/** Intervalo ocupado en tiempo absoluto (citas existentes, bloqueos). */
export interface BusyInterval {
  start: Date;
  end: Date;
}

export interface SlotQuery {
  /** Día a consultar en la zona horaria del local, formato YYYY-MM-DD. */
  date: string;
  timezone: string;
  /** Horario del profesional para ese día de la semana. */
  workingHours: MinuteRange[];
  /** Citas activas y bloqueos que se cruzan con el día. */
  busy: BusyInterval[];
  /** Duración del servicio (para este profesional). */
  durationMinutes: number;
  /** Tiempo de limpieza posterior; ocupa agenda pero no tiene que caber al final de la jornada. */
  bufferMinutes?: number;
  /** Granularidad de los horarios ofrecidos. */
  stepMinutes: number;
  now: Date;
  /** No ofrecer horarios que empiecen antes de now + minAdvanceMinutes. */
  minAdvanceMinutes?: number;
}

export interface Slot {
  start: Date;
  /** Fin del servicio (sin buffer). */
  end: Date;
  /** Fin real de la ocupación (con buffer); es lo que se guarda en Appointment.endsAt. */
  blockedUntil: Date;
}

/**
 * Calcula los horarios libres de un profesional en un día.
 *
 * Reglas:
 *  - El servicio completo (duración) debe caber dentro de un rango de trabajo.
 *  - El buffer debe estar libre de otras citas, pero puede pasar del cierre del rango.
 *  - No se ofrece nada que choque con un intervalo ocupado.
 *  - Los horarios se alinean al paso (stepMinutes) contando desde el inicio de cada rango.
 */
export function computeAvailableSlots(q: SlotQuery): Slot[] {
  if (q.durationMinutes <= 0 || q.stepMinutes <= 0) return [];

  const day = DateTime.fromISO(q.date, { zone: q.timezone });
  if (!day.isValid) throw new Error(`Fecha inválida: ${q.date}`);

  const buffer = q.bufferMinutes ?? 0;
  const earliest = q.now.getTime() + (q.minAdvanceMinutes ?? 0) * 60_000;
  const busy = q.busy.map((b) => [b.start.getTime(), b.end.getTime()] as const);

  const slots: Slot[] = [];
  const ranges = [...q.workingHours].sort((a, b) => a.startMinute - b.startMinute);

  for (const range of ranges) {
    for (let minute = range.startMinute; minute + q.durationMinutes <= range.endMinute; minute += q.stepMinutes) {
      const start = day.startOf('day').plus({ minutes: minute });
      const startMs = start.toMillis();
      const endMs = start.plus({ minutes: q.durationMinutes }).toMillis();
      const blockedMs = start.plus({ minutes: q.durationMinutes + buffer }).toMillis();

      if (startMs < earliest) continue;
      if (busy.some(([bs, be]) => startMs < be && bs < blockedMs)) continue;

      slots.push({ start: new Date(startMs), end: new Date(endMs), blockedUntil: new Date(blockedMs) });
    }
  }
  return slots;
}

/** Día de la semana ISO (1 = lunes ... 7 = domingo) de una fecha local. */
export function isoWeekday(date: string, timezone: string): number {
  return DateTime.fromISO(date, { zone: timezone }).weekday;
}

/** Inicio y fin (UTC) del día local, para consultar citas de ese día. */
export function dayBoundsUtc(date: string, timezone: string): { start: Date; end: Date } {
  const d = DateTime.fromISO(date, { zone: timezone });
  return { start: d.startOf('day').toJSDate(), end: d.endOf('day').toJSDate() };
}
