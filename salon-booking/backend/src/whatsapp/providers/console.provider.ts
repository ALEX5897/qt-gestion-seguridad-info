import { Injectable, Logger } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { Channel, OutboundMessage, WhatsAppProvider } from '../whatsapp.types';

export interface OutboxItem {
  at: Date;
  channel: Channel;
  to: string;
  message: OutboundMessage;
}

/** Simulador local: no envía nada, imprime en consola y guarda los últimos mensajes. */
@Injectable()
export class ConsoleProvider implements WhatsAppProvider {
  readonly name = 'console';
  private readonly logger = new Logger('WhatsApp(simulador)');
  readonly outbox: OutboxItem[] = [];

  async send(channel: Channel, to: string, message: OutboundMessage) {
    this.outbox.push({ at: new Date(), channel, to, message });
    if (this.outbox.length > 200) this.outbox.shift();
    this.logger.log(`→ ${to}: ${JSON.stringify(message)}`);
    return { providerMessageId: `sim-${randomUUID()}` };
  }
}
