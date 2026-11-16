import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { DateTime } from 'luxon';
import { dayLongOf, time } from '../common/format';
import { NotificationsService } from '../notifications/notifications.service';
import { PrismaService } from '../prisma/prisma.service';
import { checkServiceability } from '../tenants/serviceability';
import { MessagingService } from '../whatsapp/messaging.service';
import { BookingService } from './booking.service';
import { WaitlistService } from './waitlist.service';

/** Las invitaciones a volver solo salen en horario diurno del local. */
const WINBACK_FROM_HOUR = 10;
const WINBACK_UNTIL_HOUR = 19;
const WINBACK_MAX_PER_TICK = 20;

export interface TickResult {
  confirmationsRequested: number;
  cancelledWithoutConfirmation: number;
  offersExpired: number;
  waitlistEntriesExpired: number;
  subscriptionsPastDue: number;
  winbackInvitations: number;
}

/**
 * Tareas automáticas, cada minuto:
 *  - pedir confirmación de asistencia antes de la cita,
 *  - cancelar las citas que no se confirmaron a tiempo (y avisar a la fila de espera),
 *  - vencer ofertas de la fila de espera sin respuesta,
 *  - marcar suscripciones vencidas,
 *  - invitar a volver a los clientes que llevan tiempo sin venir (si el local lo activó).
 *
 * Todo se decide leyendo la base de datos, así que reiniciar el servidor no pierde nada.
 */
@Injectable()
export class AutomationService {
  private readonly logger = new Logger(AutomationService.name);
  private running = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly booking: BookingService,
    private readonly waitlist: WaitlistService,
    private readonly messaging: MessagingService,
    private readonly notifications: NotificationsService,
  ) {}

  @Cron(CronExpression.EVERY_MINUTE)
  async scheduled() {
    if (process.env.AUTOMATION_ENABLED === 'false') return;
    await this.tick(new Date()).catch((e) => this.logger.error('Error en tareas automáticas', e));
  }

  /** `now` es inyectable para poder probar el paso del tiempo. */
  async tick(now: Date): Promise<TickResult | null> {
    if (this.running) return null;
    this.running = true;
    try {
      return {
        confirmationsRequested: await this.requestConfirmations(now),
        cancelledWithoutConfirmation: await this.cancelUnconfirmed(now),
        offersExpired: await this.waitlist.expireOffers(now),
        waitlistEntriesExpired: await this.waitlist.expireOldEntries(now),
        subscriptionsPastDue: await this.markPastDue(now),
        winbackInvitations: await this.inviteInactiveCustomers(now),
      };
    } finally {
      this.running = false;
    }
  }

  private async requestConfirmations(now: Date) {
    const candidates = await this.prisma.appointment.findMany({
      where: {
        status: 'PENDING',
        confirmationRequestedAt: null,
        startsAt: { gt: now, lte: new Date(now.getTime() + 8 * 86_400_000) },
        tenant: { status: { not: 'SUSPENDED' } },
      },
      include: { tenant: true, customer: true, service: true, professional: true },
    });
    let sent = 0;
    for (const a of candidates) {
      if (a.startsAt.getTime() - now.getTime() > a.tenant.reminderHoursBefore * 3_600_000) continue;
      // Marcar antes de enviar: si el envío falla no se repite el mensaje en cada minuto.
      const { count } = await this.prisma.appointment.updateMany({
        where: { id: a.id, status: 'PENDING', confirmationRequestedAt: null },
        data: { confirmationRequestedAt: now },
      });
      if (count === 0) continue;

      const tz = a.tenant.timezone;
      const name = a.customer.name?.split(' ')[0] ?? '';
      const day = dayLongOf(a.startsAt, tz);
      const hour = time(a.startsAt, tz);
      await this.messaging.sendProactive(
        a.tenant,
        a.customer.phone,
        {
          type: 'buttons',
          text:
            `Hola${name ? ' ' + name : ''} 👋 Te recordamos tu cita en *${a.tenant.name}*:\n\n` +
            `💇 ${a.service.name} con ${a.professional.name}\n📅 ${day} a las ${hour}\n\n¿Confirmas tu asistencia?`,
          buttons: [
            { id: `conf:yes:${a.id}`, title: 'Sí, confirmo' },
            { id: `conf:no:${a.id}`, title: 'No podré ir' },
          ],
        },
        {
          name: process.env.META_TEMPLATE_CONFIRMATION,
          bodyParams: [name || 'cliente', a.service.name, day, hour],
          buttonPayloads: [`conf:yes:${a.id}`, `conf:no:${a.id}`],
        },
        now,
      );
      sent++;
    }
    return sent;
  }

  private async cancelUnconfirmed(now: Date) {
    const pending = await this.prisma.appointment.findMany({
      where: { status: 'PENDING', confirmationRequestedAt: { not: null } },
      include: { tenant: true, customer: true, service: true },
    });
    let cancelled = 0;
    for (const a of pending) {
      const deadline = Math.min(
        a.confirmationRequestedAt!.getTime() + a.tenant.confirmationTimeoutMinutes * 60_000,
        a.startsAt.getTime(),
      );
      if (now.getTime() < deadline) continue;
      if (!(await this.booking.cancel(a.tenantId, a.id, 'NO_CONFIRMATION'))) continue;
      cancelled++;

      const tz = a.tenant.timezone;
      const when = `${dayLongOf(a.startsAt, tz)} a las ${time(a.startsAt, tz)}`;
      await this.messaging.send(a.tenant, a.customer.phone, [
        {
          type: 'buttons',
          text: `No recibimos tu confirmación, así que liberamos tu cita de *${a.service.name}* del ${when}. Si aún la necesitas, puedes agendar de nuevo.`,
          buttons: [{ id: 'menu:book', title: 'Agendar cita' }],
        },
      ]);
      await this.notifications.notify(
        a.tenantId,
        'NO_CONFIRMATION',
        'Cita cancelada por falta de confirmación',
        `${a.customer.name ?? a.customer.phone}: ${a.service.name}, ${when}`,
      );
    }
    return cancelled;
  }

  private async markPastDue(now: Date) {
    const { count } = await this.prisma.subscription.updateMany({
      where: { status: 'ACTIVE', currentPeriodEnd: { lt: now } },
      data: { status: 'PAST_DUE' },
    });
    return count;
  }

  /**
   * Invita a volver a quienes no vienen hace `winbackDays` días.
   * Reglas para no molestar: solo clientes que alguna vez escribieron al local y
   * no pidieron dejar de recibir invitaciones; sin cita futura; una invitación por
   * ciclo; solo en horario diurno del local; y un máximo por pasada.
   */
  private async inviteInactiveCustomers(now: Date) {
    const tenants = await this.prisma.tenant.findMany({
      where: { winbackDays: { gt: 0 }, status: { not: 'SUSPENDED' } },
      include: { subscriptions: { orderBy: { currentPeriodEnd: 'desc' }, take: 1 } },
    });
    let sent = 0;
    for (const { subscriptions, ...tenant } of tenants) {
      if (!checkServiceability(tenant, subscriptions[0] ?? null, now).serviceable) continue;
      const hour = DateTime.fromJSDate(now, { zone: tenant.timezone }).hour;
      if (hour < WINBACK_FROM_HOUR || hour >= WINBACK_UNTIL_HOUR) continue;

      const cutoff = new Date(now.getTime() - tenant.winbackDays * 86_400_000);
      const candidates = await this.prisma.customer.findMany({
        where: {
          tenantId: tenant.id,
          blocked: false,
          marketingOptOut: false,
          optInAt: { not: null },
          OR: [{ lastWinbackAt: null }, { lastWinbackAt: { lt: cutoff } }],
          // Vino alguna vez, pero no después de la fecha de corte, y no tiene nada agendado.
          appointments: { some: { status: 'COMPLETED' } },
          NOT: {
            appointments: {
              some: {
                OR: [
                  { status: 'COMPLETED', startsAt: { gte: cutoff } },
                  { status: { in: ['PENDING', 'CONFIRMED'] }, startsAt: { gt: now } },
                ],
              },
            },
          },
        },
        take: WINBACK_MAX_PER_TICK,
      });

      for (const c of candidates) {
        // Marcar antes de enviar: un fallo de envío no debe repetir la invitación cada minuto.
        await this.prisma.customer.update({ where: { id: c.id }, data: { lastWinbackAt: now } });
        const name = c.name?.split(' ')[0] ?? '';
        await this.messaging.sendProactive(
          tenant,
          c.phone,
          {
            type: 'buttons',
            text: `Hola${name ? ' ' + name : ''} 👋 En *${tenant.name}* te extrañamos. ¿Te reservamos un espacio para tu próxima visita?`,
            buttons: [
              { id: 'menu:book', title: 'Agendar cita' },
              { id: 'promo:stop', title: 'No recibir avisos' },
            ],
          },
          {
            name: process.env.META_TEMPLATE_WINBACK,
            bodyParams: [name || 'cliente', tenant.name],
            buttonPayloads: ['menu:book', 'promo:stop'],
          },
          now,
        );
        sent++;
      }
    }
    return sent;
  }
}
