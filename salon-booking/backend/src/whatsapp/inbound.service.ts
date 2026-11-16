import { Injectable, Logger } from '@nestjs/common';
import { Prisma, Tenant } from '@prisma/client';
import { NotificationsService } from '../notifications/notifications.service';
import { PrismaService } from '../prisma/prisma.service';
import { TenantsService } from '../tenants/tenants.service';
import { BotContext, BotService } from './bot.service';
import { MessagingService } from './messaging.service';
import { optionsOf, resolveChoice } from './providers/baileys.format';
import { Channel, InboundMessage } from './whatsapp.types';

const UNAVAILABLE_TEXT =
  'Hola 👋 En este momento no estamos recibiendo reservas por este medio. Por favor comunícate directamente con el local.';

/**
 * Punto de entrada de todo mensaje de cliente:
 *  1. Identifica el local por el número que recibió el mensaje (solo números registrados).
 *  2. Descarta duplicados (Meta puede reenviar el mismo webhook).
 *  3. Verifica que el local tenga la suscripción vigente.
 *  4. Registra al cliente y pasa el mensaje al bot (salvo que el local haya tomado el chat).
 */
@Injectable()
export class InboundService {
  private readonly logger = new Logger(InboundService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly tenants: TenantsService,
    private readonly bot: BotService,
    private readonly messaging: MessagingService,
    private readonly notifications: NotificationsService,
  ) {}

  async handle(msg: InboundMessage, now = new Date()): Promise<void> {
    const tenant = await this.resolveTenant(msg.channel);
    if (!tenant) {
      this.logger.warn(`Mensaje a un número no registrado: ${JSON.stringify(msg.channel)}`);
      return;
    }

    msg = await this.withTypedChoice(tenant.id, msg);
    if (!(await this.logInbound(tenant.id, msg))) return; // duplicado

    const { serviceable, reason } = await this.tenants.isServiceable(tenant);
    if (!serviceable) {
      this.logger.log(`Local ${tenant.id} no atendido (${reason})`);
      // Un solo aviso por cliente cada 24 h para no gastar mensajes.
      const recent = await this.prisma.messageLog.findFirst({
        where: {
          tenantId: tenant.id,
          customerPhone: msg.from,
          direction: 'OUT',
          createdAt: { gt: new Date(Date.now() - 24 * 3_600_000) },
        },
      });
      if (!recent) await this.messaging.send(tenant, msg.from, [{ type: 'text', text: UNAVAILABLE_TEXT }]);
      return;
    }

    const existing = await this.prisma.customer.findUnique({
      where: { tenantId_phone: { tenantId: tenant.id, phone: msg.from } },
    });
    const customer =
      existing ??
      (await this.prisma.customer.create({
        data: { tenantId: tenant.id, phone: msg.from, name: msg.profileName, optInAt: new Date() },
      }));
    if (customer.blocked) return;
    if (!customer.optInAt) {
      // Cliente creado por el local: al escribirnos da su consentimiento.
      await this.prisma.customer.update({ where: { id: customer.id }, data: { optInAt: new Date() } });
    }

    const conversation = await this.prisma.conversation.upsert({
      where: { customerId: customer.id },
      create: { tenantId: tenant.id, customerId: customer.id },
      update: { lastMessageAt: new Date() },
    });
    if (conversation.humanTakeover) {
      // El local está respondiendo en persona: solo se le avisa del mensaje nuevo.
      await this.notifications.notify(
        tenant.id,
        'MESSAGE',
        `Mensaje de ${customer.name ?? customer.phone}`,
        msg.text ?? '(respuesta con botón)',
      );
      return;
    }

    const out = await this.bot.handle({
      tenant,
      customer,
      isNewCustomer: !existing,
      context: (conversation.context as BotContext | null) ?? {},
      msg,
      now,
    });

    await this.prisma.conversation.update({
      where: { id: conversation.id },
      data: {
        state: out.state,
        context: out.context as Prisma.InputJsonValue,
        humanTakeover: out.humanTakeover ?? false,
      },
    });
    await this.messaging.send(tenant, msg.from, out.messages);
  }

  /**
   * Si el cliente escribe el número de una opción ("2") o su texto ("mis citas") en vez
   * de pulsar el botón, se trata como si lo hubiera pulsado. Con la sesión no oficial,
   * donde no hay botones, es la única forma de elegir.
   */
  private async withTypedChoice(tenantId: number, msg: InboundMessage): Promise<InboundMessage> {
    if (msg.replyId || !msg.text || msg.text.length > 40) return msg;
    const last = await this.prisma.messageLog.findFirst({
      where: { tenantId, customerPhone: msg.from, direction: 'OUT' },
      orderBy: { id: 'desc' },
    });
    const replyId = resolveChoice(msg.text, optionsOf(last?.body));
    return replyId ? { ...msg, replyId, text: undefined } : msg;
  }

  private async resolveTenant(channel: Channel): Promise<Tenant | null> {
    if (channel.waPhoneNumberId) {
      const t = await this.tenants.findByWaPhoneNumberId(channel.waPhoneNumberId);
      if (t) return t;
    }
    return channel.whatsappNumber ? this.tenants.findByWhatsappNumber(channel.whatsappNumber) : null;
  }

  /** Guarda el mensaje; devuelve false si ya se había procesado. */
  private async logInbound(tenantId: number, msg: InboundMessage): Promise<boolean> {
    try {
      await this.prisma.messageLog.create({
        data: {
          tenantId,
          direction: 'IN',
          customerPhone: msg.from,
          providerMessageId: msg.providerMessageId,
          type: msg.replyId ? 'interactive' : 'text',
          body: msg.replyId ?? msg.text ?? '',
        },
      });
      return true;
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') return false;
      throw e;
    }
  }
}
