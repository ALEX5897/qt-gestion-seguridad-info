import { createHmac, timingSafeEqual } from 'crypto';
import { InboundMessage } from './whatsapp.types';

/** Valida la cabecera X-Hub-Signature-256 que firma Meta con el App Secret. */
export function verifyMetaSignature(rawBody: Buffer, header: string | undefined, appSecret: string): boolean {
  if (!header?.startsWith('sha256=') || !appSecret) return false;
  const expected = createHmac('sha256', appSecret).update(rawBody).digest();
  const received = Buffer.from(header.slice('sha256='.length), 'hex');
  return received.length === expected.length && timingSafeEqual(received, expected);
}

/* eslint-disable @typescript-eslint/no-explicit-any */
/** Extrae los mensajes de clientes de un webhook de Meta. Ignora estados de entrega. */
export function parseMetaWebhook(body: any): InboundMessage[] {
  const result: InboundMessage[] = [];
  for (const entry of body?.entry ?? []) {
    for (const change of entry?.changes ?? []) {
      const value = change?.value;
      if (change?.field !== 'messages' || !value?.messages) continue;
      const channel = {
        waPhoneNumberId: value.metadata?.phone_number_id,
        whatsappNumber: value.metadata?.display_phone_number?.replace(/\D/g, ''),
      };
      const names = new Map<string, string>((value.contacts ?? []).map((c: any) => [c.wa_id, c.profile?.name]));
      for (const m of value.messages) {
        const reply = m.interactive?.button_reply ?? m.interactive?.list_reply ?? null;
        result.push({
          channel,
          from: m.from,
          providerMessageId: m.id,
          text: m.text?.body ?? m.button?.text,
          replyId: reply?.id ?? m.button?.payload,
          profileName: names.get(m.from),
          receivedAt: m.timestamp ? new Date(Number(m.timestamp) * 1000) : new Date(),
        });
      }
    }
  }
  return result;
}
