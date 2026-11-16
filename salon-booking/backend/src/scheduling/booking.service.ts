import { Injectable, NotFoundException } from '@nestjs/common';
import { Appointment, AppointmentSource, CancelReason, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { ACTIVE_STATUSES } from './scheduling.service';

export class SlotTakenError extends Error {
  constructor() {
    super('El horario ya no está disponible');
  }
}

export interface BookInput {
  tenantId: number;
  customerId: number;
  professionalId: number;
  serviceId: number;
  startsAt: Date;
  source?: AppointmentSource;
  notes?: string;
  now?: Date;
  /** Al reprogramar: la cita que se reemplaza no cuenta como cruce. */
  ignoreAppointmentId?: number;
  /** Al aceptar una oferta de la fila de espera: su reserva temporal no cuenta. */
  ignoreOfferId?: number;
}

type FreedHook = (freed: Appointment) => Promise<void>;

@Injectable()
export class BookingService {
  private readonly freedHooks: FreedHook[] = [];

  constructor(private readonly prisma: PrismaService) {}

  /** Permite reaccionar cuando un cupo queda libre (la fila de espera se suscribe aquí). */
  onSlotFreed(hook: FreedHook) {
    this.freedHooks.push(hook);
  }

  /**
   * Crea una cita evitando la doble reserva: bloquea la fila del profesional
   * (SELECT ... FOR UPDATE) para serializar reservas concurrentes y comprueba
   * los cruces dentro de la transacción.
   *
   * Si falta menos que el plazo de recordatorio del local, la cita nace
   * CONFIRMADA: no tiene sentido pedir confirmación de algo recién reservado.
   */
  async book(input: BookInput) {
    const now = input.now ?? new Date();
    return this.prisma.$transaction(
      async (tx) => {
        // El bloqueo va PRIMERO: así la comprobación de cruces de abajo ve las
        // citas que otra transacción concurrente acaba de confirmar.
        await tx.$queryRaw`SELECT id FROM Professional WHERE id = ${input.professionalId} AND tenantId = ${input.tenantId} FOR UPDATE`;

        const tenant = await tx.tenant.findUniqueOrThrow({ where: { id: input.tenantId } });
        const service = await tx.service.findFirst({ where: { id: input.serviceId, tenantId: input.tenantId } });
        const link = await tx.professionalService.findFirst({
          where: {
            professionalId: input.professionalId,
            serviceId: input.serviceId,
            professional: { tenantId: input.tenantId, active: true },
          },
        });
        if (!service || !link) throw new NotFoundException('El profesional no realiza este servicio');

        const duration = link.durationMinutes ?? service.durationMinutes;
        const endsAt = new Date(input.startsAt.getTime() + (duration + service.bufferMinutes) * 60_000);
        const overlapping = { startsAt: { lt: endsAt }, endsAt: { gt: input.startsAt } };

        const [appointments, offers, timeOffs] = await Promise.all([
          tx.appointment.count({
            where: {
              professionalId: input.professionalId,
              status: { in: [...ACTIVE_STATUSES] },
              ...overlapping,
              ...(input.ignoreAppointmentId ? { id: { not: input.ignoreAppointmentId } } : {}),
            },
          }),
          tx.waitlistOffer.count({
            where: {
              professionalId: input.professionalId,
              status: 'PENDING',
              expiresAt: { gt: now },
              ...overlapping,
              ...(input.ignoreOfferId ? { id: { not: input.ignoreOfferId } } : {}),
            },
          }),
          tx.timeOff.count({
            where: {
              tenantId: input.tenantId,
              OR: [{ professionalId: null }, { professionalId: input.professionalId }],
              ...overlapping,
            },
          }),
        ]);
        if (appointments + offers + timeOffs > 0) throw new SlotTakenError();

        const soon = input.startsAt.getTime() - now.getTime() <= tenant.reminderHoursBefore * 3_600_000;
        return tx.appointment.create({
          data: {
            tenantId: input.tenantId,
            customerId: input.customerId,
            professionalId: input.professionalId,
            serviceId: input.serviceId,
            startsAt: input.startsAt,
            endsAt,
            source: input.source ?? 'WHATSAPP',
            notes: input.notes,
            ...(soon ? { status: 'CONFIRMED' as const, confirmedAt: now } : {}),
          },
          include: { service: true, professional: true, customer: true },
        });
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted },
    );
  }

  upcomingForCustomer(tenantId: number, customerId: number, now = new Date()) {
    return this.prisma.appointment.findMany({
      where: { tenantId, customerId, status: { in: [...ACTIVE_STATUSES] }, startsAt: { gte: now } },
      include: { service: true, professional: true },
      orderBy: { startsAt: 'asc' },
      take: 10,
    });
  }

  /** Cita activa del local (y del cliente, si se indica). */
  findActive(tenantId: number, appointmentId: number, customerId?: number) {
    return this.prisma.appointment.findFirst({
      where: {
        id: appointmentId,
        tenantId,
        ...(customerId ? { customerId } : {}),
        status: { in: [...ACTIVE_STATUSES] },
      },
      include: { service: true, professional: true, customer: true },
    });
  }

  /** El cliente confirma su asistencia. Devuelve null si la cita ya no está activa. */
  async confirm(tenantId: number, appointmentId: number, customerId?: number) {
    const appt = await this.findActive(tenantId, appointmentId, customerId);
    if (!appt) return null;
    if (appt.status === 'CONFIRMED') return appt;
    return this.prisma.appointment.update({
      where: { id: appt.id },
      data: { status: 'CONFIRMED', confirmedAt: new Date() },
      include: { service: true, professional: true, customer: true },
    });
  }

  /**
   * Cancela una cita activa y avisa a la fila de espera que hay un cupo.
   * Devuelve null si no existe, no pertenece al cliente o ya no está activa.
   */
  async cancel(tenantId: number, appointmentId: number, reason: CancelReason, customerId?: number) {
    const appt = await this.findActive(tenantId, appointmentId, customerId);
    if (!appt) return null;
    // updateMany con el estado en el WHERE: dos cancelaciones simultáneas no liberan el cupo dos veces.
    const { count } = await this.prisma.appointment.updateMany({
      where: { id: appt.id, status: { in: [...ACTIVE_STATUSES] } },
      data: { status: 'CANCELLED', cancelReason: reason, cancelledAt: new Date() },
    });
    if (count === 0) return null;
    const cancelled = { ...appt, status: 'CANCELLED' as const, cancelReason: reason };
    await this.notifyFreed(cancelled);
    return cancelled;
  }

  /** Mueve una cita a otro horario/profesional: crea la nueva y libera la anterior. */
  async reschedule(
    tenantId: number,
    appointmentId: number,
    professionalId: number,
    startsAt: Date,
    opts: { customerId?: number; now?: Date } = {},
  ) {
    const old = await this.findActive(tenantId, appointmentId, opts.customerId);
    if (!old) return null;
    const created = await this.book({
      tenantId,
      customerId: old.customerId,
      professionalId,
      serviceId: old.serviceId,
      startsAt,
      source: old.source,
      notes: old.notes ?? undefined,
      now: opts.now,
      ignoreAppointmentId: old.id,
    });
    await this.prisma.appointment.update({
      where: { id: old.id },
      data: { status: 'CANCELLED', cancelReason: opts.customerId ? 'CUSTOMER' : 'BUSINESS', cancelledAt: new Date() },
    });
    await this.notifyFreed(old);
    return { old, created };
  }

  private async notifyFreed(appt: Appointment) {
    for (const hook of this.freedHooks) await hook(appt);
  }
}
