/** Número del local por el que entra/sale el mensaje. */
export interface Channel {
  /** E.164 sin "+" (ej. 593991234567). */
  whatsappNumber?: string;
  /** phone_number_id de Meta Cloud API. */
  waPhoneNumberId?: string;
}

export interface InboundMessage {
  channel: Channel;
  /** Teléfono del cliente, E.164 sin "+". */
  from: string;
  providerMessageId: string;
  /** Texto escrito por el cliente. */
  text?: string;
  /** id del botón o fila de lista que el cliente pulsó. */
  replyId?: string;
  profileName?: string;
  receivedAt: Date;
}

export interface ReplyButton {
  id: string;
  /** Máximo 20 caracteres (límite de WhatsApp). */
  title: string;
}

export interface ListRow {
  id: string;
  /** Máximo 24 caracteres. */
  title: string;
  description?: string;
}

export type InteractiveMessage =
  | { type: 'text'; text: string }
  /** Hasta 3 botones. */
  | { type: 'buttons'; text: string; buttons: ReplyButton[] }
  /** Hasta 10 filas en total. */
  | { type: 'list'; text: string; buttonLabel: string; rows: ListRow[] };

/**
 * Plantilla aprobada por Meta: obligatoria para escribir a un cliente cuando
 * pasaron más de 24 h desde su último mensaje (recordatorios, fila de espera).
 */
export interface TemplateMessage {
  type: 'template';
  name: string;
  language: string;
  /** Valores de {{1}}, {{2}}... del cuerpo. */
  bodyParams: string[];
  /** Payload de cada botón de respuesta rápida, en orden. */
  buttonPayloads: string[];
}

export type OutboundMessage = InteractiveMessage | TemplateMessage;

/**
 * Abstracción del proveedor de WhatsApp. Permite empezar con el simulador
 * o con el número de prueba gratuito de Meta y cambiar después sin tocar
 * la lógica del bot.
 */
export interface WhatsAppProvider {
  /** Identifica al proveedor: console (simulador), meta (oficial) o baileys (no oficial, pruebas). */
  readonly name: string;
  send(channel: Channel, to: string, message: OutboundMessage): Promise<{ providerMessageId?: string }>;
}

export const WHATSAPP_PROVIDER = Symbol('WHATSAPP_PROVIDER');
