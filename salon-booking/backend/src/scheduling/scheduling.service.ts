import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { DateTime } from 'luxon';
import { PrismaService } from '../prisma/prisma.service';
import { computeAvailableSlots, dayBoundsUtc, isoWeekday, Slot } from './availability';

export interface ProfessionalAvailability {
  professionalId: number;
  professionalName: string;
  slots: Slot[];
}

export interface AvailabilityOptions {
  professionalId?: number;
  now?: Date;
  /** Al reprogramar: la cita actual no debe bloquear sus propios horarios. */
  ignoreAppointmentId?: number;
  /** Al aceptar una oferta de la fila de espera: su reserva temporal no cuenta. */
  ignoreOfferId?: number;
}

/** Estados que ocupan agenda. */
export const ACTIVE_STATUSES = ['PENDING', 'CONFIRMED'] as const;

@Injectable()
export class SchedulingService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Horarios libres de un servicio en un día, por profesional.
   * Si no se indica profesional, devuelve todos los que realizan el servicio.
   * Ocupan agenda: citas activas, bloqueos y cupos ofrecidos a la fila de espera
   * mientras la oferta está vigente.
   */
  async getAvailability(
    tenantId: number,
    serviceId: number,
    date: string,
    opts: AvailabilityOptions = {},
  ): Promise<ProfessionalAvailability[]> {
    const now = opts.now ?? new Date();
    const tenant = await this.prisma.tenant.findUniqueOrThrow({ where: { id: tenantId } });
    const service = await this.prisma.service.findFirst({ where: { id: serviceId, tenantId, active: true } });
    if (!service) throw new NotFoundException('Servicio no encontrado');

    const day = DateTime.fromISO(date ?? '', { zone: tenant.timezone });
    if (!day.isValid) throw new BadRequestException('Fecha inválida (use YYYY-MM-DD)');
    const today = DateTime.fromJSDate(now, { zone: tenant.timezone }).startOf('day');
    if (day < today || day > today.plus({ days: tenant.maxAdvanceDays })) return [];

    const weekday = isoWeekday(date, tenant.timezone);
    const { start, end } = dayBoundsUtc(date, tenant.timezone);

    const professionals = await this.prisma.professional.findMany({
      where: {
        tenantId,
        active: true,
        ...(opts.professionalId ? { id: opts.professionalId } : {}),
        services: { some: { serviceId } },
      },
      include: {
        workingHours: { where: { weekday } },
        services: { where: { serviceId } },
        appointments: {
          where: {
            status: { in: [...ACTIVE_STATUSES] },
            startsAt: { lt: end },
            endsAt: { gt: start },
            ...(opts.ignoreAppointmentId ? { id: { not: opts.ignoreAppointmentId } } : {}),
          },
          select: { startsAt: true, endsAt: true },
        },
      },
      orderBy: { name: 'asc' },
    });

    const [timeOffs, offers] = await Promise.all([
      this.prisma.timeOff.findMany({ where: { tenantId, startsAt: { lt: end }, endsAt: { gt: start } } }),
      this.prisma.waitlistOffer.findMany({
        where: {
          status: 'PENDING',
          expiresAt: { gt: now },
          professionalId: { in: professionals.map((p) => p.id) },
          startsAt: { lt: end },
          endsAt: { gt: start },
          ...(opts.ignoreOfferId ? { id: { not: opts.ignoreOfferId } } : {}),
        },
      }),
    ]);

    return professionals.map((p) => ({
      professionalId: p.id,
      professionalName: p.name,
      slots: computeAvailableSlots({
        date,
        timezone: tenant.timezone,
        workingHours: p.workingHours,
        busy: [
          ...p.appointments.map((a) => ({ start: a.startsAt, end: a.endsAt })),
          ...timeOffs
            .filter((t) => t.professionalId === null || t.professionalId === p.id)
            .map((t) => ({ start: t.startsAt, end: t.endsAt })),
          ...offers.filter((o) => o.professionalId === p.id).map((o) => ({ start: o.startsAt, end: o.endsAt })),
        ],
        durationMinutes: p.services[0]?.durationMinutes ?? service.durationMinutes,
        bufferMinutes: service.bufferMinutes,
        stepMinutes: tenant.slotStepMinutes,
        minAdvanceMinutes: tenant.minAdvanceMinutes,
        now,
      }),
    }));
  }
}
