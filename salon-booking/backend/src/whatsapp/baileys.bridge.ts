import { Inject, Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { InboundService } from './inbound.service';
import { BaileysManager, IncomingText } from './providers/baileys.manager';
import { WHATSAPP_PROVIDER, WhatsAppProvider } from './whatsapp.types';

/** Une las sesiones no oficiales de WhatsApp con el bot: cada mensaje recibido entra al flujo normal. */
@Injectable()
export class BaileysBridge implements OnModuleInit {
  private readonly logger = new Logger(BaileysBridge.name);

  constructor(
    private readonly manager: BaileysManager,
    private readonly inbound: InboundService,
    private readonly prisma: PrismaService,
    @Inject(WHATSAPP_PROVIDER) private readonly provider: WhatsAppProvider,
  ) {}

  get active() {
    return this.provider.name === 'baileys';
  }

  onModuleInit() {
    if (!this.active) return;
    this.logger.warn('WhatsApp en modo NO OFICIAL (Baileys): solo para pruebas; el número puede ser bloqueado.');
    this.manager.onMessage((msg) => this.incoming(msg));
    // Reconecta los locales que ya habían escaneado el código.
    for (const tenantId of this.manager.savedTenants()) void this.manager.start(tenantId);
  }

  private async incoming(msg: IncomingText) {
    const tenant = await this.prisma.tenant.findUnique({ where: { id: msg.tenantId } });
    if (!tenant) return;
    await this.inbound.handle({
      channel: { whatsappNumber: tenant.whatsappNumber },
      from: msg.from,
      providerMessageId: `wa-${msg.messageId}`,
      text: msg.text || undefined,
      profileName: msg.name,
      receivedAt: msg.at,
    });
  }
}
