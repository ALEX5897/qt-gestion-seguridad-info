import { Injectable, Logger } from '@nestjs/common';
import { Appointment } from '@prisma/client';
import { dayLong, isoDate, time } from '../common/format';
import { NotificationsService } from '../notifications/notifications.service';
import { PrismaService } from '../prisma/prisma.service';
import { MessagingService } from '../whatsapp/messaging.service';
import { BookingService, SlotTakenError } from './booking.service';
import { SchedulingService } from './scheduling.service';

/** Fecha local YYYY-MM-DD → valor de una columna DATE. */
export const dateOnly = (date: string) => new Date(`${date}T00:00:00Z`);

export type AcceptResult = { ok: true; appointment: Awaited<ReturnType<BookingService['book']>> } | { ok: false };

/**
 * Fila de espera. Cuando se libera un cupo se ofrece a UNA persona a la vez,
 * por orden de llegada, con un tiempo límite para aceptar. Mientras la oferta
 * está vigente el cupo queda reservado; si la rechaza o no responde, pasa al siguiente.
 */
@Injectable()
export class WaitlistService {
  private readonly logger = new Logger(WaitlistService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly scheduling: SchedulingService,
    private readonly booking: BookingService,
    private readonly messaging: MessagingService,
    private readonly notifications: NotificationsService,
  ) {
    this.booking.onSlotFreed((appt) => this.handleFreed(appt));
  }

  /** Anota al cliente para un día. Si ya estaba anotado para lo mismo, devuelve esa entrada. */
  async join(tenantId: number, customerId: number, serviceId: number, professionalId: number | null, date: string) {
    const existing = await this.prisma.waitlistEntry.findFirst({
      where: { tenantId, customerId, serviceId, date: dateOnly(date), status: { in: ['WAITING', 'OFFERED'] } },
    });
    if (existing) return existing;
    return this.prisma.waitlistEntry.create({
      data: { tenantId, customerId, serviceId, professionalId, date: dateOnly(date) },
    });
  }

  activeForCustomer(tenantId: number, customerId: number) {
    return this.prisma.waitlistEntry.findMany({
      where: { tenantId, customerId, status: { in: ['WAITING', 'OFFERED'] } },
      include: { service: true },
      orderBy: { date: 'asc' },
    });
  }

  /** El cliente (o el local) retira una entrada; si tenía una oferta vigente, el cupo pasa al siguiente. */
  async leave(tenantId: number, entryId: number, customerId?: number) {
    const entry = await this.prisma.waitlistEntry.findFirst({
      where: { id: entryId, tenantId, ...(customerId ? { customerId } : {}), status: { in: ['WAITING', 'OFFERED'] } },
      include: { offers: { where: { status: 'PENDING' } } },
    });
    if (!entry) return false;
    await this.prisma.waitlistEntry.update({ where: { id: entry.id }, data: { status: 'CANCELLED' } });
    for (const offer of entry.offers) {
      await this.prisma.waitlistOffer.update({ where: { id: offer.id }, data: { status: 'DECLINED' } });
      await this.offerNext(tenantId, offer.professionalId, offer.freedStart, offer.freedEnd);
    }
    return true;
  }

  private async handleFreed(appt: Appointment) {
    try {
      await this.offerNext(appt.tenantId, appt.professionalId, appt.startsAt, appt.endsAt);
    } catch (e) {
      // Un fallo aquí no debe revertir la cancelación que liberó el cupo.
      this.logger.error(`Error ofreciendo cupo liberado de la cita ${appt.id}`, e as Error);
    }
  }

  /**
   * Ofrece el intervalo liberado al primer cliente en espera al que le sirva:
   * mismo día, un servicio que ese profesional realiza y que quepa en el hueco.
   * Devuelve la oferta creada o null si nadie califica.
   */
  async offerNext(tenantId: number, professionalId: number, freedStart: Date, freedEnd: Date, now = new Date()) {
    if (freedEnd.getTime() <= now.getTime()) return null;
    const tenant = await this.prisma.tenant.findUniqueOrThrow({ where: { id: tenantId } });
    if (tenant.status === 'SUSPENDED') return null;
    const date = isoDate(freedStart, tenant.timezone);

    const entries = await this.prisma.waitlistEntry.findMany({
      where: {
        tenantId,
        date: dateOnly(date),
        status: 'WAITING',
        OR: [{ professionalId: null }, { professionalId }],
        customer: { blocked: false },
        // Quien ya recibió una oferta por este mismo hueco no la recibe de nuevo.
        offers: { none: { professionalId, startsAt: { lt: freedEnd }, endsAt: { gt: freedStart } } },
      },
      include: { customer: true, service: true },
      orderBy: { createdAt: 'asc' },
    });

    for (const entry of entries) {
      const [avail] = await this.scheduling
        .getAvailability(tenantId, entry.serviceId, date, { professionalId, now })
        .catch(() => []);
      const slot = avail?.slots.find(
        (s) =>
          s.start.getTime() < freedEnd.getTime() &&
          s.blockedUntil.getTime() > freedStart.getTime() &&
          inWindow(s.start, tenant.timezone, entry.fromMinute, entry.toMinute),
      );
      if (!slot) continue;

      const offer = await this.prisma.waitlistOffer.create({
        data: {
          entryId: entry.id,
          professionalId,
          startsAt: slot.start,
          endsAt: slot.blockedUntil,
          freedStart,
          freedEnd,
          expiresAt: new Date(now.getTime() + tenant.waitlistOfferMinutes * 60_000),
        },
      });
      await this.prisma.waitlistEntry.update({ where: { id: entry.id }, data: { status: 'OFFERED' } });

      const day = dayLong(date, tenant.timezone);
      const hour = time(slot.start, tenant.timezone);
      const name = entry.customer.name?.split(' ')[0] ?? '';
      await this.messaging.sendProactive(
        tenant,
        entry.customer.phone,
        {
          type: 'buttons',
          text:
            `🎉 ¡Se liberó un cupo en *${tenant.name}*!\n\n💇 ${entry.service.name} con ${avail.professionalName}\n` +
            `📅 ${day} a las ${hour}\n\nTienes ${tenant.waitlistOfferMinutes} minutos para aceptarlo.`,
          buttons: [
            { id: `wl:yes:${offer.id}`, title: 'Lo quiero' },
            { id: `wl:no:${offer.id}`, title: 'No, gracias' },
          ],
        },
        {
          name: process.env.META_TEMPLATE_WAITLIST,
          bodyParams: [name || 'cliente', entry.service.name, day, hour, String(tenant.waitlistOfferMinutes)],
          buttonPayloads: [`wl:yes:${offer.id}`, `wl:no:${offer.id}`],
        },
        now,
      );
      return offer;
    }
    return null;
  }

  /** El cliente acepta el cupo ofrecido: se convierte en cita. */
  async accept(tenantId: number, offerId: number, customerId: number, now = new Date()): Promise<AcceptResult> {
    const offer = await this.prisma.waitlistOffer.findFirst({
      where: { id: offerId, status: 'PENDING', entry: { tenantId, customerId } },
      include: { entry: { include: { customer: true, service: true } } },
    });
    if (!offer || offer.expiresAt.getTime() <= now.getTime()) return { ok: false };

    try {
      const appointment = await this.booking.book({
        tenantId,
        customerId,
        professionalId: offer.professionalId,
        serviceId: offer.entry.serviceId,
        startsAt: offer.startsAt,
        now,
        ignoreOfferId: offer.id,
      });
      await this.prisma.waitlistOffer.update({ where: { id: offer.id }, data: { status: 'ACCEPTED' } });
      await this.prisma.waitlistEntry.update({ where: { id: offer.entryId }, data: { status: 'BOOKED' } });
      const tenant = await this.prisma.tenant.findUniqueOrThrow({ where: { id: tenantId } });
      await this.notifications.notify(
        tenantId,
        'WAITLIST_BOOKED',
        'Cupo tomado desde la fila de espera',
        `${offer.entry.customer.name ?? offer.entry.customer.phone}: ${offer.entry.service.name}, ` +
          `${dayLong(isoDate(offer.startsAt, tenant.timezone), tenant.timezone)} ${time(offer.startsAt, tenant.timezone)}`,
      );
      // Si el hueco liberado era más grande que este servicio, se ofrece el resto.
      await this.offerNext(tenantId, offer.professionalId, offer.freedStart, offer.freedEnd, now);
      return { ok: true, appointment };
    } catch (e) {
      if (!(e instanceof SlotTakenError)) throw e;
      await this.release(offer.id, offer.entryId, 'EXPIRED');
      return { ok: false };
    }
  }

  async decline(tenantId: number, offerId: number, customerId: number, now = new Date()) {
    const offer = await this.prisma.waitlistOffer.findFirst({
      where: { id: offerId, status: 'PENDING', entry: { tenantId, customerId } },
    });
    if (!offer) return false;
    await this.release(offer.id, offer.entryId, 'DECLINED');
    await this.offerNext(tenantId, offer.professionalId, offer.freedStart, offer.freedEnd, now);
    return true;
  }

  /** Vence las ofertas sin respuesta y pasa cada cupo al siguiente de la fila. */
  async expireOffers(now = new Date()) {
    const expired = await this.prisma.waitlistOffer.findMany({
      where: { status: 'PENDING', expiresAt: { lte: now } },
      include: { entry: { include: { customer: true, tenant: true } } },
    });
    for (const offer of expired) {
      await this.release(offer.id, offer.entryId, 'EXPIRED');
      await this.messaging.send(offer.entry.tenant, offer.entry.customer.phone, [
        {
          type: 'text',
          text: 'El tiempo para aceptar el cupo terminó. Sigues en la fila de espera por si se libera otro. 🙂',
        },
      ]);
      await this.offerNext(offer.entry.tenantId, offer.professionalId, offer.freedStart, offer.freedEnd, now);
    }
    return expired.length;
  }

  /** Cierra las entradas de días que ya pasaron. */
  async expireOldEntries(now = new Date()) {
    const cutoff = new Date(now.getTime() - 36 * 3_600_000); // margen para cualquier zona horaria
    const { count } = await this.prisma.waitlistEntry.updateMany({
      where: { status: 'WAITING', date: { lt: cutoff } },
      data: { status: 'EXPIRED' },
    });
    return count;
  }

  /** Cierra una oferta y devuelve al cliente a la fila. */
  private async release(offerId: number, entryId: number, status: 'DECLINED' | 'EXPIRED') {
    await this.prisma.waitlistOffer.update({ where: { id: offerId }, data: { status } });
    await this.prisma.waitlistEntry.updateMany({
      where: { id: entryId, status: 'OFFERED' },
      data: { status: 'WAITING' },
    });
  }
}

function inWindow(start: Date, tz: string, fromMinute: number | null, toMinute: number | null) {
  if (fromMinute == null && toMinute == null) return true;
  const [h, m] = time(start, tz).split(':').map(Number);
  const minute = h * 60 + m;
  return (fromMinute == null || minute >= fromMinute) && (toMinute == null || minute <= toMinute);
}
