import Anthropic from '@anthropic-ai/sdk';

/** Token de inyección del cliente de Claude (null cuando la IA no está configurada). */
export const AI_CLIENT = Symbol('AI_CLIENT');

/** Modelo por defecto; se puede cambiar con AI_MODEL. */
export const AI_MODEL = () => process.env.AI_MODEL ?? 'claude-opus-5-5';

/**
 * La IA es opcional: sin credenciales (o con AI_ENABLED=false) el sistema
 * funciona igual, solo con botones. El SDK lee ANTHROPIC_API_KEY del entorno.
 */
export function createAiClient(): Anthropic | null {
  if (process.env.AI_ENABLED === 'false') return null;
  if (!process.env.ANTHROPIC_API_KEY && !process.env.ANTHROPIC_AUTH_TOKEN) return null;
  // Un cliente de WhatsApp no espera minutos: tiempo límite corto y un solo reintento.
  return new Anthropic({ timeout: 45_000, maxRetries: 1 });
}
