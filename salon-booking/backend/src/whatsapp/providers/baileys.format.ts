import { OutboundMessage } from '../whatsapp.types';

/**
 * WhatsApp no entrega botones ni listas enviados desde una sesión no oficial,
 * así que cada mensaje se convierte en texto con opciones numeradas y el
 * cliente responde con el número.
 */
export function toPlainText(message: OutboundMessage): string {
  if (message.type === 'text') return message.text;
  if (message.type === 'template') return message.bodyParams.join(' · ');
  const options = message.type === 'buttons' ? message.buttons : message.rows;
  const lines = options.map((o, i) => {
    const description = 'description' in o && o.description ? ` — ${o.description}` : '';
    return `*${i + 1}.* ${o.title}${description}`;
  });
  return `${message.text}\n\n${lines.join('\n')}\n\n_Responde con el número de la opción._`;
}

/** Opciones (id y título) del último mensaje enviado, tal como quedó en MessageLog. */
export function optionsOf(lastOutboundBody: string | null | undefined): { id: string; title: string }[] {
  if (!lastOutboundBody) return [];
  try {
    const m = JSON.parse(lastOutboundBody);
    return (m.buttons ?? m.rows ?? []).filter(
      (o: { id?: unknown; title?: unknown }) => typeof o.id === 'string' && typeof o.title === 'string',
    );
  } catch {
    return [];
  }
}

const normalize = (s: string) =>
  s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9: ]/g, '')
    .trim();

/**
 * Traduce lo que escribió el cliente a la opción que eligió: el número ("2")
 * o el texto de la opción ("mis citas"). Devuelve undefined si no eligió ninguna.
 */
export function resolveChoice(text: string, options: { id: string; title: string }[]): string | undefined {
  const clean = text.trim();
  const number = /^(\d{1,2})[.)]?$/.exec(clean);
  if (number) return options[Number(number[1]) - 1]?.id;
  const wanted = normalize(clean);
  return wanted ? options.find((o) => normalize(o.title) === wanted)?.id : undefined;
}

/** Teléfono (solo dígitos) de un identificador de WhatsApp; null si es grupo, estado o canal. */
export function phoneFromJid(jid: string | null | undefined): string | null {
  if (!jid) return null;
  const [user, server] = jid.split('@');
  if (server !== 's.whatsapp.net' && server !== 'lid') return null;
  const digits = user.split(':')[0].replace(/\D/g, '');
  return digits || null;
}
