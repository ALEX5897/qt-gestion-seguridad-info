import { Inject, Injectable, Logger } from '@nestjs/common';
import { Tenant } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { InteractiveMessage, OutboundMessage, WHATSAPP_PROVIDER, WhatsAppProvider } from './whatsapp.types';

const WINDOW_MS = 24 * 3_600_000;

export interface TemplateSpec {
  /** Nombre de la plantilla aprobada en Meta; si está vacío se usa el mensaje normal. */
  name: string | undefined;
  bodyParams: string[];
  buttonPayloads: string[];
}

/** Envío de mensajes a clientes en nombre de un local, con registro en MessageLog. */
@Injectable()
export class MessagingService {
  private readonly logger = new Logger(MessagingService.name);

  constructor(
    private readonly prisma: PrismaService,
    @Inject(WHATSAPP_PROVIDER) private readonly provider: WhatsAppProvider,
  ) {}

  /** Envía en orden. Un fallo del proveedor se registra pero no interrumpe la operación de negocio. */
  async send(tenant: Tenant, to: string, messages: OutboundMessage[]): Promise<boolean> {
    const channel = { whatsappNumber: tenant.whatsappNumber, waPhoneNumberId: tenant.waPhoneNumberId ?? undefined };
    let ok = true;
    for (const message of messages) {
      try {
        const { providerMessageId } = await this.provider.send(channel, to, message);
        await this.prisma.messageLog.create({
          data: {
            tenantId: tenant.id,
            direction: 'OUT',
            customerPhone: to,
            providerMessageId,
            type: message.type,
            body: JSON.stringify(message),
          },
        });
      } catch (e) {
        ok = false;
        this.logger.error(`No se pudo enviar a ${to} (local ${tenant.id}): ${String(e)}`);
      }
    }
    return ok;
  }

  /**
   * Mensajes que inicia el sistema (recordatorios, ofertas de fila de espera).
   * Dentro de la ventana de 24 h se envía el mensaje interactivo normal;
   * fuera de ella WhatsApp exige una plantilla aprobada, si está configurada.
   */
  async sendProactive(
    tenant: Tenant,
    to: string,
    fallback: InteractiveMessage,
    template: TemplateSpec,
    now = new Date(),
  ) {
    if (template.name && !(await this.insideWindow(tenant.id, to, now))) {
      return this.send(tenant, to, [
        {
          type: 'template',
          name: template.name,
          language: process.env.META_TEMPLATE_LANG ?? 'es',
          bodyParams: template.bodyParams,
          buttonPayloads: template.buttonPayloads,
        },
      ]);
    }
    return this.send(tenant, to, [fallback]);
  }

  private async insideWindow(tenantId: number, phone: string, now: Date) {
    const last = await this.prisma.messageLog.findFirst({
      where: { tenantId, customerPhone: phone, direction: 'IN' },
      orderBy: { createdAt: 'desc' },
    });
    return !!last && now.getTime() - last.createdAt.getTime() < WINDOW_MS;
  }
}
