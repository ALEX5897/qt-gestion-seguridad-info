import { PrismaService } from '../../prisma/prisma.service';
import { Channel, OutboundMessage, WhatsAppProvider } from '../whatsapp.types';
import { toPlainText } from './baileys.format';
import { BaileysManager } from './baileys.manager';

/** Envío por la sesión no oficial del local: todo sale como texto con opciones numeradas. */
export class BaileysProvider implements WhatsAppProvider {
  readonly name = 'baileys';

  constructor(
    private readonly manager: BaileysManager,
    private readonly prisma: PrismaService,
  ) {}

  async send(channel: Channel, to: string, message: OutboundMessage) {
    const tenant = await this.prisma.tenant.findUnique({ where: { whatsappNumber: channel.whatsappNumber ?? '' } });
    if (!tenant) throw new Error('Local no encontrado para el número de salida');
    return { providerMessageId: await this.manager.sendText(tenant.id, to, toPlainText(message)) };
  }
}
