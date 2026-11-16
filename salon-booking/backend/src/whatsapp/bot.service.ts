import { Injectable } from '@nestjs/common';
import { Customer, Tenant } from '@prisma/client';
import { DateTime } from 'luxon';
import { dayLong, dayLongOf, isoDate, money, shortDay, time } from '../common/format';
import { NotificationsService } from '../notifications/notifications.service';
import { PrismaService } from '../prisma/prisma.service';
import { isoWeekday } from '../scheduling/availability';
import { BookingService, SlotTakenError } from '../scheduling/booking.service';
import { SchedulingService } from '../scheduling/scheduling.service';
import { WaitlistService } from '../scheduling/waitlist.service';
import { InboundMessage, InteractiveMessage, ListRow } from './whatsapp.types';

export interface BotContext {
  serviceId?: number;
  /** null = cualquier profesional */
  professionalId?: number | null;
  date?: string;
  /** Si está presente, la reserva reemplaza a esta cita (reprogramación). */
  rescheduleId?: number;
}

export interface BotInput {
  tenant: Tenant;
  customer: Customer;
  /** Primer mensaje de este cliente al local. */
  isNewCustomer?: boolean;
  context: BotContext;
  msg: InboundMessage;
  now: Date;
}

export interface BotOutput {
  messages: InteractiveMessage[];
  state: string;
  context: BotContext;
  /** El cliente pidió hablar con una persona: se pausa el bot. */
  humanTakeover?: boolean;
}

const GREETING = /^(hola|buenas|buenos|menu|menú|inicio|hi)\b/i;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const MAX_DAYS_SHOWN = 7;
const SLOTS_PER_PAGE = 9;
const PRIVACY_NOTICE =
  '\n\n_Usamos tu número solo para gestionar tus citas en este local. Puedes pedir que eliminemos tus datos cuando quieras._';

/** Convierte un argumento a id; 0 (que no existe) si no es un entero válido. */
const toId = (s: string | undefined) => (s && /^\d+$/.test(s) ? Number(s) : 0);

/**
 * Bot de reservas basado en botones y listas interactivas.
 * Los ids de las respuestas describen la acción (svc:3, day:2026-11-16, ...),
 * así el flujo no se rompe si el cliente pulsa un botón de un mensaje anterior.
 */
@Injectable()
export class BotService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly scheduling: SchedulingService,
    private readonly booking: BookingService,
    private readonly waitlist: WaitlistService,
    private readonly notifications: NotificationsService,
  ) {}

  async handle(input: BotInput): Promise<BotOutput> {
    const { msg, context } = input;
    const id = msg.replyId ?? '';
    const [action, arg1, arg2] = id.split(':');

    switch (action) {
      case 'menu':
        if (arg1 === 'book') return this.askService(input);
        if (arg1 === 'mine') return this.showMine(input);
        if (arg1 === 'human') return this.requestHuman(input);
        break;
      case 'svc':
        return this.askProfessional(input, { serviceId: toId(arg1) });
      case 'pro':
        return this.askDay(input, { ...context, professionalId: arg1 === 'any' ? null : toId(arg1) });
      case 'day':
        if (!DATE.test(arg1 ?? '')) break;
        return this.askSlot(input, { ...context, date: arg1 }, 0);
      case 'more':
        return this.askSlot(input, context, toId(arg1));
      case 'slot':
        return this.askConfirm(input, toId(arg1), toId(arg2));
      case 'book':
        return this.confirmBooking(input, toId(arg1), toId(arg2));
      case 'appt':
        return this.showAppointment(input, toId(arg1));
      case 'resch':
        return this.startReschedule(input, toId(arg1));
      case 'cancel':
        return this.askCancel(input, toId(arg1));
      case 'cancelok':
        return this.doCancel(input, toId(arg1));
      case 'conf':
        return arg1 === 'yes' ? this.confirmAttendance(input, toId(arg2)) : this.askCancel(input, toId(arg2));
      case 'wl':
        if (arg1 === 'ask') return this.askWaitlistDay(input);
        if (arg1 === 'yes') return this.acceptOffer(input, toId(arg2));
        if (arg1 === 'no') return this.declineOffer(input, toId(arg2));
        break;
      case 'wlday':
        if (!DATE.test(arg1 ?? '')) break;
        return this.joinWaitlist(input, arg1);
      case 'wlcancel':
        return this.leaveWaitlist(input, toId(arg1));
    }

    if (msg.text && !GREETING.test(msg.text.trim()) && id === '') {
      return this.menu(input, 'No te entendí 🙈. Usa los botones para continuar:');
    }
    return this.menu(input);
  }

  // ───────────── menú ─────────────

  private menu(input: BotInput, intro?: string): BotOutput {
    const name = input.customer.name ? ` ${input.customer.name.split(' ')[0]}` : '';
    const text =
      intro ??
      `¡Hola${name}! 👋 Bienvenido a *${input.tenant.name}*. ¿Qué deseas hacer?` +
        (input.isNewCustomer ? PRIVACY_NOTICE : '');
    return {
      state: 'MENU',
      context: {},
      messages: [
        {
          type: 'buttons',
          text,
          buttons: [
            { id: 'menu:book', title: 'Agendar cita' },
            { id: 'menu:mine', title: 'Mis citas' },
            { id: 'menu:human', title: 'Hablar con alguien' },
          ],
        },
      ],
    };
  }

  private async requestHuman(input: BotInput): Promise<BotOutput> {
    await this.notifications.notify(
      input.tenant.id,
      'HUMAN_REQUEST',
      'Un cliente quiere hablar con una persona',
      `${this.who(input)} espera respuesta en el chat.`,
    );
    return {
      messages: [{ type: 'text', text: 'Perfecto, una persona del equipo te responderá por este chat en breve. 🙌' }],
      state: 'HUMAN',
      context: {},
      humanTakeover: true,
    };
  }

  // ───────────── reservar ─────────────

  private async askService(input: BotInput): Promise<BotOutput> {
    const services = await this.prisma.service.findMany({
      where: { tenantId: input.tenant.id, active: true, professionals: { some: { professional: { active: true } } } },
      orderBy: { name: 'asc' },
      take: 10,
    });
    if (!services.length) return this.menu(input, 'Por ahora no hay servicios disponibles para reservar.');
    return {
      state: 'SERVICE',
      context: {},
      messages: [
        {
          type: 'list',
          text: '¿Qué servicio deseas?',
          buttonLabel: 'Ver servicios',
          rows: services.map((s) => ({
            id: `svc:${s.id}`,
            title: s.name,
            description: [`${s.durationMinutes} min`, s.priceCents != null ? money(s.priceCents) : null]
              .filter(Boolean)
              .join(' · '),
          })),
        },
      ],
    };
  }

  private async askProfessional(input: BotInput, context: BotContext): Promise<BotOutput> {
    const pros = await this.prisma.professional.findMany({
      where: { tenantId: input.tenant.id, active: true, services: { some: { serviceId: context.serviceId ?? 0 } } },
      orderBy: { name: 'asc' },
      take: 9,
    });
    if (!pros.length) return this.menu(input, 'Ese servicio no está disponible por ahora.');
    if (pros.length === 1) return this.askDay(input, { ...context, professionalId: pros[0].id });
    return {
      state: 'PROFESSIONAL',
      context,
      messages: [
        {
          type: 'list',
          text: '¿Con quién te gustaría atenderte?',
          buttonLabel: 'Elegir',
          rows: [{ id: 'pro:any', title: 'Cualquiera', description: 'El primero disponible' }].concat(
            pros.map((p) => ({ id: `pro:${p.id}`, title: p.name, description: '' })),
          ),
        },
      ],
    };
  }

  private async askDay(input: BotInput, context: BotContext): Promise<BotOutput> {
    if (!context.serviceId) return this.askService(input);
    const { tenant, now } = input;
    const today = DateTime.fromJSDate(now, { zone: tenant.timezone }).startOf('day');
    const rows: ListRow[] = [];

    for (let i = 0; i <= tenant.maxAdvanceDays && rows.length < MAX_DAYS_SHOWN; i++) {
      const date = today.plus({ days: i }).toISODate()!;
      const slots = await this.slotsFor(input, context, date);
      if (slots.length) {
        rows.push({
          id: `day:${date}`,
          title: dayLabel(date, tenant.timezone, i),
          description: `${slots.length} horarios libres`,
        });
      }
    }
    if (!rows.length) {
      return {
        state: 'DAY',
        context,
        messages: [
          {
            type: 'buttons',
            text: 'No encontramos horarios libres en los próximos días. 😕 ¿Quieres que te avisemos si se libera un cupo?',
            buttons: [
              { id: 'wl:ask', title: 'Fila de espera' },
              { id: 'menu:book', title: 'Otro servicio' },
            ],
          },
        ],
      };
    }
    if (!context.rescheduleId) {
      rows.push({ id: 'wl:ask', title: 'Otro día', description: 'Avísenme si se libera un cupo' });
    }
    return {
      state: 'DAY',
      context,
      messages: [{ type: 'list', text: '¿Qué día te queda mejor?', buttonLabel: 'Ver días', rows }],
    };
  }

  private async askSlot(input: BotInput, context: BotContext, offset: number): Promise<BotOutput> {
    if (!context.serviceId || !context.date) return this.askService(input);
    const slots = await this.slotsFor(input, context, context.date);
    if (!slots.length) return this.askDay(input, context);

    const page = slots.slice(offset, offset + SLOTS_PER_PAGE);
    if (!page.length) return this.askSlot(input, context, 0);
    const rows: ListRow[] = page.map((s) => ({
      id: `slot:${s.professionalId}:${s.start.getTime()}`,
      title: time(s.start, input.tenant.timezone),
      description: context.professionalId == null ? s.professionalName : '',
    }));
    if (offset + SLOTS_PER_PAGE < slots.length) {
      rows.push({ id: `more:${offset + SLOTS_PER_PAGE}`, title: 'Más tarde ➡️', description: 'Ver más horarios' });
    }
    return {
      state: 'SLOT',
      context,
      messages: [
        {
          type: 'list',
          text: `Horarios para el ${dayLong(context.date, input.tenant.timezone)}:`,
          buttonLabel: 'Ver horarios',
          rows,
        },
      ],
    };
  }

  private async askConfirm(input: BotInput, professionalId: number, startMs: number): Promise<BotOutput> {
    const { context, tenant } = input;
    const [service, pro] = await Promise.all([
      this.prisma.service.findFirst({ where: { id: context.serviceId ?? 0, tenantId: tenant.id } }),
      this.prisma.professional.findFirst({ where: { id: professionalId, tenantId: tenant.id } }),
    ]);
    if (!service || !pro) return this.askService(input);
    const start = new Date(startMs);
    return {
      state: 'CONFIRM',
      context,
      messages: [
        {
          type: 'buttons',
          text:
            `${context.rescheduleId ? 'Nuevo horario para tu cita' : 'Revisa tu reserva'}:\n\n💇 *${service.name}*\n👤 ${pro.name}\n` +
            `📅 ${dayLongOf(start, tenant.timezone)}\n🕒 ${time(start, tenant.timezone)}\n\n¿Confirmas?`,
          buttons: [
            { id: `book:${professionalId}:${startMs}`, title: context.rescheduleId ? 'Sí, cambiar' : 'Sí, reservar' },
            {
              id: context.rescheduleId ? 'menu:mine' : 'menu:book',
              title: context.rescheduleId ? 'No cambiar' : 'Elegir otro',
            },
          ],
        },
      ],
    };
  }

  private async confirmBooking(input: BotInput, professionalId: number, startMs: number): Promise<BotOutput> {
    const { context, tenant, customer, now } = input;
    if (!context.serviceId) return this.askService(input);
    const tz = tenant.timezone;
    const startsAt = new Date(startMs);
    const date = isoDate(startsAt, tz);

    try {
      // Volver a validar contra la disponibilidad real (horario, anticipación, bloqueos).
      const stillFree = (await this.slotsFor(input, { ...context, professionalId }, date)).some(
        (s) => s.start.getTime() === startMs,
      );
      if (!stillFree) throw new SlotTakenError();

      let appt;
      if (context.rescheduleId) {
        const result = await this.booking.reschedule(tenant.id, context.rescheduleId, professionalId, startsAt, {
          customerId: customer.id,
          now,
        });
        if (!result) return this.menu(input, 'Esa cita ya no está activa. ¿Qué deseas hacer?');
        appt = result.created;
      } else {
        appt = await this.booking.book({
          tenantId: tenant.id,
          customerId: customer.id,
          professionalId,
          serviceId: context.serviceId,
          startsAt,
          now,
        });
      }

      const when = `${dayLong(date, tz)} a las ${time(appt.startsAt, tz)}`;
      await this.notifications.notify(
        tenant.id,
        context.rescheduleId ? 'RESCHEDULED' : 'BOOKED',
        context.rescheduleId ? 'Cita reprogramada por WhatsApp' : 'Nueva cita por WhatsApp',
        `${this.who(input)}: ${appt.service.name} con ${appt.professional.name}, ${when}`,
      );
      return {
        state: 'IDLE',
        context: {},
        messages: [
          {
            type: 'text',
            text:
              `✅ ¡Listo! Tu cita quedó ${context.rescheduleId ? 'reprogramada' : 'reservada'}.\n\n` +
              `💇 ${appt.service.name} con ${appt.professional.name}\n📅 ${when}` +
              (tenant.address ? `\n📍 ${tenant.address}` : '') +
              (appt.status === 'PENDING'
                ? `\n\nTe escribiremos ${tenant.reminderHoursBefore} h antes para confirmar tu asistencia.`
                : '\n\n¡Te esperamos!'),
          },
        ],
      };
    } catch (e) {
      if (!(e instanceof SlotTakenError)) throw e;
      const retry = await this.askSlot(input, { ...context, date }, 0);
      return {
        ...retry,
        messages: [{ type: 'text', text: 'Uy, ese horario acaba de ocuparse. 😅 Elige otro:' }, ...retry.messages],
      };
    }
  }

  // ───────────── mis citas ─────────────

  private async showMine(input: BotInput): Promise<BotOutput> {
    const { tenant, customer, now } = input;
    const tz = tenant.timezone;
    const [appts, waiting] = await Promise.all([
      this.booking.upcomingForCustomer(tenant.id, customer.id, now),
      this.waitlist.activeForCustomer(tenant.id, customer.id),
    ]);
    if (!appts.length && !waiting.length) {
      return {
        state: 'MENU',
        context: {},
        messages: [
          { type: 'buttons', text: 'No tienes citas próximas.', buttons: [{ id: 'menu:book', title: 'Agendar cita' }] },
        ],
      };
    }
    const lines = appts.map(
      (a) =>
        `• ${dayLongOf(a.startsAt, tz)} ${time(a.startsAt, tz)} — ${a.service.name} con ${a.professional.name}` +
        (a.status === 'CONFIRMED' ? ' ✅' : ''),
    );
    const waitLines = waiting.map((w) => `• ${dayLong(w.date.toISOString().slice(0, 10), 'UTC')} — ${w.service.name}`);
    const rows: ListRow[] = [
      ...appts.slice(0, 7).map((a) => ({
        id: `appt:${a.id}`,
        title: `${shortDay(a.startsAt, tz)} ${time(a.startsAt, tz)}`,
        description: a.service.name,
      })),
      ...waiting.slice(0, 3).map((w) => ({
        id: `wlcancel:${w.id}`,
        title: 'Salir de la fila',
        description: `${w.service.name} · ${dayLong(w.date.toISOString().slice(0, 10), 'UTC')}`,
      })),
    ];
    return {
      state: 'MY_APPTS',
      context: {},
      messages: [
        {
          type: 'list',
          text:
            (lines.length ? `Tus próximas citas:\n\n${lines.join('\n')}` : 'No tienes citas próximas.') +
            (waitLines.length ? `\n\nEn fila de espera:\n${waitLines.join('\n')}` : '') +
            '\n\nElige una para cambiarla o cancelarla.',
          buttonLabel: 'Gestionar',
          rows,
        },
      ],
    };
  }

  private async showAppointment(input: BotInput, appointmentId: number): Promise<BotOutput> {
    const appt = await this.booking.findActive(input.tenant.id, appointmentId, input.customer.id);
    if (!appt) return this.menu(input, 'Esa cita ya no está activa. ¿Qué deseas hacer?');
    const tz = input.tenant.timezone;
    return {
      state: 'APPT',
      context: {},
      messages: [
        {
          type: 'buttons',
          text: `💇 *${appt.service.name}* con ${appt.professional.name}\n📅 ${dayLongOf(appt.startsAt, tz)} a las ${time(appt.startsAt, tz)}\n\n¿Qué deseas hacer?`,
          buttons: [
            { id: `resch:${appt.id}`, title: 'Reprogramar' },
            { id: `cancel:${appt.id}`, title: 'Cancelar cita' },
            { id: 'menu:mine', title: 'Volver' },
          ],
        },
      ],
    };
  }

  private async startReschedule(input: BotInput, appointmentId: number): Promise<BotOutput> {
    const appt = await this.booking.findActive(input.tenant.id, appointmentId, input.customer.id);
    if (!appt) return this.menu(input, 'Esa cita ya no está activa. ¿Qué deseas hacer?');
    return this.askProfessional(input, { serviceId: appt.serviceId, rescheduleId: appt.id });
  }

  private async askCancel(input: BotInput, appointmentId: number): Promise<BotOutput> {
    const appt = await this.booking.findActive(input.tenant.id, appointmentId, input.customer.id);
    if (!appt) return this.menu(input, 'Esa cita ya no está activa. ¿Qué deseas hacer?');
    const tz = input.tenant.timezone;
    return {
      state: 'CANCEL',
      context: {},
      messages: [
        {
          type: 'buttons',
          text: `¿Seguro que quieres cancelar *${appt.service.name}* del ${dayLongOf(appt.startsAt, tz)} a las ${time(appt.startsAt, tz)}?`,
          buttons: [
            { id: `cancelok:${appt.id}`, title: 'Sí, cancelar' },
            { id: `resch:${appt.id}`, title: 'Mejor reprogramar' },
            { id: 'menu:mine', title: 'No, volver' },
          ],
        },
      ],
    };
  }

  private async doCancel(input: BotInput, appointmentId: number): Promise<BotOutput> {
    const cancelled = await this.booking.cancel(input.tenant.id, appointmentId, 'CUSTOMER', input.customer.id);
    if (cancelled) {
      const tz = input.tenant.timezone;
      await this.notifications.notify(
        input.tenant.id,
        'CANCELLED',
        'Cita cancelada por el cliente',
        `${this.who(input)}: ${cancelled.service.name}, ${dayLongOf(cancelled.startsAt, tz)} ${time(cancelled.startsAt, tz)}`,
      );
    }
    return this.menu(
      input,
      cancelled
        ? 'Tu cita fue cancelada. ¡Gracias por avisarnos! ¿Algo más?'
        : 'Esa cita ya no está activa. ¿Algo más?',
    );
  }

  private async confirmAttendance(input: BotInput, appointmentId: number): Promise<BotOutput> {
    const appt = await this.booking.confirm(input.tenant.id, appointmentId, input.customer.id);
    if (!appt) {
      return this.menu(
        input,
        'Esa cita ya no está activa (pudo haberse cancelado por falta de confirmación). ¿Qué deseas hacer?',
      );
    }
    const tz = input.tenant.timezone;
    const when = `${dayLongOf(appt.startsAt, tz)} a las ${time(appt.startsAt, tz)}`;
    await this.notifications.notify(
      input.tenant.id,
      'CONFIRMED',
      'Asistencia confirmada',
      `${this.who(input)}: ${appt.service.name}, ${when}`,
    );
    return {
      state: 'IDLE',
      context: {},
      messages: [
        {
          type: 'text',
          text:
            `✅ ¡Gracias! Tu asistencia quedó confirmada: ${appt.service.name}, ${when}.` +
            (input.tenant.address ? `\n📍 ${input.tenant.address}` : '') +
            '\n\n¡Te esperamos!',
        },
      ],
    };
  }

  // ───────────── fila de espera ─────────────

  /** Muestra los días completos (alguien trabaja, pero no quedan horarios) para anotarse. */
  private async askWaitlistDay(input: BotInput): Promise<BotOutput> {
    const { context, tenant, now } = input;
    if (!context.serviceId) return this.askService(input);
    const pros = await this.prisma.professional.findMany({
      where: {
        tenantId: tenant.id,
        active: true,
        services: { some: { serviceId: context.serviceId } },
        ...(context.professionalId ? { id: context.professionalId } : {}),
      },
      include: { workingHours: true },
    });
    const today = DateTime.fromJSDate(now, { zone: tenant.timezone }).startOf('day');
    const rows: ListRow[] = [];
    for (let i = 0; i <= Math.min(tenant.maxAdvanceDays, 21) && rows.length < 10; i++) {
      const date = today.plus({ days: i }).toISODate()!;
      const weekday = isoWeekday(date, tenant.timezone);
      if (!pros.some((p) => p.workingHours.some((w) => w.weekday === weekday))) continue;
      if ((await this.slotsFor(input, context, date)).length) continue;
      rows.push({
        id: `wlday:${date}`,
        title: dayLabel(date, tenant.timezone, i),
        description: 'Sin cupos · anotarme',
      });
    }
    if (!rows.length) {
      const again = await this.askDay(input, { ...context, rescheduleId: undefined });
      return {
        ...again,
        messages: [
          { type: 'text', text: 'Por ahora hay horarios libres todos los días próximos. 🙂' },
          ...again.messages,
        ],
      };
    }
    return {
      state: 'WAITLIST_DAY',
      context,
      messages: [
        {
          type: 'list',
          text: 'Estos días están completos. ¿Para cuál quieres que te avisemos si se libera un cupo?',
          buttonLabel: 'Ver días',
          rows,
        },
      ],
    };
  }

  private async joinWaitlist(input: BotInput, date: string): Promise<BotOutput> {
    const { context, tenant, customer } = input;
    if (!context.serviceId) return this.askService(input);
    await this.waitlist.join(tenant.id, customer.id, context.serviceId, context.professionalId ?? null, date);
    return {
      state: 'IDLE',
      context: {},
      messages: [
        {
          type: 'buttons',
          text:
            `📝 Listo, quedaste en la fila de espera para el ${dayLong(date, tenant.timezone)}.\n\n` +
            `Si se libera un cupo te escribiremos y tendrás ${tenant.waitlistOfferMinutes} minutos para aceptarlo.`,
          buttons: [
            { id: 'menu:book', title: 'Agendar otro día' },
            { id: 'menu:mine', title: 'Mis citas' },
          ],
        },
      ],
    };
  }

  private async leaveWaitlist(input: BotInput, entryId: number): Promise<BotOutput> {
    const ok = await this.waitlist.leave(input.tenant.id, entryId, input.customer.id);
    return this.menu(input, ok ? 'Saliste de la fila de espera. ¿Algo más?' : 'Ya no estabas en esa fila. ¿Algo más?');
  }

  private async acceptOffer(input: BotInput, offerId: number): Promise<BotOutput> {
    const { tenant, customer, now } = input;
    const result = await this.waitlist.accept(tenant.id, offerId, customer.id, now);
    if (!result.ok) {
      return this.menu(
        input,
        'Ese cupo ya no está disponible 😕 (el tiempo para aceptarlo terminó). Sigues en la fila por si se libera otro.',
      );
    }
    const a = result.appointment;
    return {
      state: 'IDLE',
      context: {},
      messages: [
        {
          type: 'text',
          text:
            `✅ ¡El cupo es tuyo!\n\n💇 ${a.service.name} con ${a.professional.name}\n` +
            `📅 ${dayLongOf(a.startsAt, tenant.timezone)} a las ${time(a.startsAt, tenant.timezone)}` +
            (tenant.address ? `\n📍 ${tenant.address}` : '') +
            '\n\n¡Te esperamos!',
        },
      ],
    };
  }

  private async declineOffer(input: BotInput, offerId: number): Promise<BotOutput> {
    await this.waitlist.decline(input.tenant.id, offerId, input.customer.id, input.now);
    return this.menu(
      input,
      'Entendido, no tomamos ese cupo. Sigues en la fila por si se libera otro horario. ¿Algo más?',
    );
  }

  // ───────────── utilidades ─────────────

  private who(input: BotInput) {
    return input.customer.name ? `${input.customer.name} (${input.customer.phone})` : input.customer.phone;
  }

  /** Horarios libres del día; con "cualquiera" fusiona profesionales (uno por horario). */
  private async slotsFor(input: BotInput, context: BotContext, date: string) {
    const avail = await this.scheduling.getAvailability(input.tenant.id, context.serviceId!, date, {
      professionalId: context.professionalId ?? undefined,
      now: input.now,
      ignoreAppointmentId: context.rescheduleId,
    });
    const byStart = new Map<number, { start: Date; professionalId: number; professionalName: string }>();
    for (const p of avail) {
      for (const s of p.slots) {
        if (!byStart.has(s.start.getTime())) {
          byStart.set(s.start.getTime(), {
            start: s.start,
            professionalId: p.professionalId,
            professionalName: p.professionalName,
          });
        }
      }
    }
    return [...byStart.values()].sort((a, b) => a.start.getTime() - b.start.getTime());
  }
}

const dayLabel = (date: string, tz: string, offset: number) =>
  offset === 0
    ? 'Hoy'
    : offset === 1
      ? 'Mañana'
      : DateTime.fromISO(date, { zone: tz }).setLocale('es').toFormat('cccc d LLL');
