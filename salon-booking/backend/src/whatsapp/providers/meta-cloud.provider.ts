import { Injectable, Logger } from '@nestjs/common';
import axios from 'axios';
import { Channel, OutboundMessage, WhatsAppProvider } from '../whatsapp.types';

/**
 * WhatsApp Cloud API (Meta). Funciona igual con el número de prueba gratuito
 * (hasta 5 destinatarios verificados en el panel de Meta) y con números reales.
 */
@Injectable()
export class MetaCloudProvider implements WhatsAppProvider {
  private readonly logger = new Logger(MetaCloudProvider.name);
  private readonly version = process.env.META_GRAPH_VERSION ?? 'v23.0';
  private readonly token = process.env.META_ACCESS_TOKEN ?? '';

  async send(channel: Channel, to: string, message: OutboundMessage) {
    if (!channel.waPhoneNumberId) throw new Error('El local no tiene waPhoneNumberId configurado');
    const url = `https://graph.facebook.com/${this.version}/${channel.waPhoneNumberId}/messages`;
    try {
      const { data } = await axios.post(
        url,
        { messaging_product: 'whatsapp', recipient_type: 'individual', to, ...toMetaPayload(message) },
        { headers: { Authorization: `Bearer ${this.token}` }, timeout: 10_000 },
      );
      return { providerMessageId: data?.messages?.[0]?.id as string | undefined };
    } catch (err) {
      const detail = axios.isAxiosError(err) ? JSON.stringify(err.response?.data) : String(err);
      this.logger.error(`Error enviando a ${to}: ${detail}`);
      throw err;
    }
  }
}

export function toMetaPayload(message: OutboundMessage): Record<string, unknown> {
  switch (message.type) {
    case 'text':
      return { type: 'text', text: { body: message.text } };
    case 'buttons':
      return {
        type: 'interactive',
        interactive: {
          type: 'button',
          body: { text: message.text },
          action: {
            buttons: message.buttons.slice(0, 3).map((b) => ({
              type: 'reply',
              reply: { id: b.id, title: b.title.slice(0, 20) },
            })),
          },
        },
      };
    case 'list':
      return {
        type: 'interactive',
        interactive: {
          type: 'list',
          body: { text: message.text },
          action: {
            button: message.buttonLabel.slice(0, 20),
            sections: [
              {
                title: 'Opciones',
                rows: message.rows.slice(0, 10).map((r) => ({
                  id: r.id,
                  title: r.title.slice(0, 24),
                  ...(r.description ? { description: r.description.slice(0, 72) } : {}),
                })),
              },
            ],
          },
        },
      };
    case 'template':
      return {
        type: 'template',
        template: {
          name: message.name,
          language: { code: message.language },
          components: [
            { type: 'body', parameters: message.bodyParams.map((text) => ({ type: 'text', text })) },
            ...message.buttonPayloads.map((payload, index) => ({
              type: 'button',
              sub_type: 'quick_reply',
              index: String(index),
              parameters: [{ type: 'payload', payload }],
            })),
          ],
        },
      };
  }
}
