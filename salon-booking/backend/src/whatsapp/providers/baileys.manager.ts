import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import makeWASocket, {
  Browsers,
  DisconnectReason,
  fetchLatestBaileysVersion,
  useMultiFileAuthState,
  WAMessage,
  WASocket,
} from '@whiskeysockets/baileys';
import * as fs from 'fs';
import type { Agent } from 'https';
import * as path from 'path';
import pino from 'pino';
import * as QRCode from 'qrcode';
import { phoneFromJid } from './baileys.format';

export type LinkState = 'disconnected' | 'connecting' | 'qr' | 'connected';

export interface LinkStatus {
  state: LinkState;
  /** Imagen del código QR (data URL) mientras se espera el escaneo. */
  qr: string | null;
  /** Código de 8 caracteres para vincular escribiéndolo en el teléfono (alternativa al QR). */
  pairingCode: string | null;
  /** Número de la cuenta de WhatsApp vinculada. */
  linkedNumber: string | null;
  error: string | null;
}

export interface IncomingText {
  tenantId: number;
  from: string;
  messageId: string;
  text: string;
  name?: string;
  at: Date;
}

interface Session {
  sock: WASocket | null;
  status: LinkStatus;
  /** Identificador de WhatsApp de cada cliente, para responderle al mismo chat. */
  jids: Map<string, string>;
  startedAt: number;
  retries: number;
  stopped: boolean;
  /** Teléfono a vincular por código; si no hay, se usa el QR. */
  pairPhone: string | null;
}

const MAX_RETRIES = 5;

/**
 * Sesiones de WhatsApp con la librería NO OFICIAL Baileys, una por local.
 * Funciona como "WhatsApp Web": el dueño escanea un código QR con el teléfono del local.
 *
 * SOLO PARA PRUEBAS: incumple los términos de WhatsApp y el número puede ser
 * bloqueado. En producción se usa el proveedor oficial (WHATSAPP_PROVIDER=meta).
 */
@Injectable()
export class BaileysManager implements OnModuleDestroy {
  private readonly logger = new Logger('WhatsApp(Baileys)');
  private readonly sessions = new Map<number, Session>();
  private readonly dir = path.resolve(process.env.WA_SESSIONS_DIR ?? '.wa-sessions');
  private handler: ((msg: IncomingText) => Promise<void>) | null = null;
  /** Último error de vinculación por local, para mostrarlo en el panel. */
  private readonly errors = new Map<number, string>();

  /** Quién recibe los mensajes de los clientes (lo registra el módulo del bot). */
  onMessage(handler: (msg: IncomingText) => Promise<void>) {
    this.handler = handler;
  }

  status(tenantId: number): LinkStatus {
    return (
      this.sessions.get(tenantId)?.status ?? {
        state: 'disconnected',
        qr: null,
        pairingCode: null,
        linkedNumber: null,
        error: this.errors.get(tenantId) ?? null,
      }
    );
  }

  /** Locales con credenciales guardadas (para reconectar al iniciar el servidor). */
  savedTenants(): number[] {
    if (!fs.existsSync(this.dir)) return [];
    return fs
      .readdirSync(this.dir)
      .filter((name) => /^\d+$/.test(name) && fs.existsSync(path.join(this.dir, name, 'creds.json')))
      .map(Number);
  }

  /**
   * Inicia la vinculación (o reconecta con las credenciales guardadas).
   * Con `pairPhone` se pide un código para escribir en el teléfono en lugar del QR.
   */
  async start(tenantId: number, pairPhone: string | null = null): Promise<LinkStatus> {
    const current = this.sessions.get(tenantId);
    if (current?.status.state === 'connected') return current.status;
    if (current) {
      // Cambiar de método (QR ↔ código) o reintentar: se descarta el intento anterior.
      if (current.status.state !== 'disconnected' && current.pairPhone === pairPhone) return current.status;
      current.stopped = true;
      current.sock?.end(undefined);
      fs.rmSync(this.authDir(tenantId), { recursive: true, force: true });
    }
    this.errors.delete(tenantId);
    const session: Session = {
      sock: null,
      status: { state: 'connecting', qr: null, pairingCode: null, linkedNumber: null, error: null },
      jids: new Map(),
      startedAt: Date.now(),
      retries: 0,
      stopped: false,
      pairPhone,
    };
    this.sessions.set(tenantId, session);
    await this.connect(tenantId, session);
    return session.status;
  }

  /** Cierra la sesión en WhatsApp y borra las credenciales del local. */
  async logout(tenantId: number) {
    const session = this.sessions.get(tenantId);
    if (session) {
      session.stopped = true;
      await session.sock?.logout().catch(() => undefined);
      session.sock?.end(undefined);
    }
    this.sessions.delete(tenantId);
    fs.rmSync(this.authDir(tenantId), { recursive: true, force: true });
  }

  async sendText(tenantId: number, to: string, text: string): Promise<string | undefined> {
    const session = this.sessions.get(tenantId);
    if (!session?.sock || session.status.state !== 'connected') {
      throw new Error('El WhatsApp del local no está vinculado');
    }
    const jid = session.jids.get(to) ?? `${to}@s.whatsapp.net`;
    const sent = await session.sock.sendMessage(jid, { text });
    return sent?.key.id ?? undefined;
  }

  onModuleDestroy() {
    for (const session of this.sessions.values()) {
      session.stopped = true;
      session.sock?.end(undefined);
    }
  }

  // ───────────── interno ─────────────

  private authDir(tenantId: number) {
    return path.join(this.dir, String(tenantId));
  }

  private async connect(tenantId: number, session: Session) {
    try {
      const { state, saveCreds } = await useMultiFileAuthState(this.authDir(tenantId));
      const { version } = await fetchLatestBaileysVersion().catch(() => ({ version: undefined }));
      const sock = makeWASocket({
        auth: state,
        ...proxyAgent(),
        ...(version ? { version } : {}),
        logger: pino({ level: 'silent' }),
        browser: Browsers.ubuntu('Agenda del local'),
        syncFullHistory: false,
        markOnlineOnConnect: false,
      });
      session.sock = sock;

      sock.ev.on('creds.update', saveCreds);

      sock.ev.on('connection.update', async ({ connection, lastDisconnect, qr }) => {
        if (session.stopped) return;
        if (qr && session.pairPhone) {
          // Vinculación por código: se pide una sola vez, cuando WhatsApp está listo para emparejar.
          if (!session.status.pairingCode) {
            const code = await sock.requestPairingCode(session.pairPhone);
            session.status = {
              state: 'qr',
              qr: null,
              pairingCode: `${code.slice(0, 4)}-${code.slice(4)}`,
              linkedNumber: null,
              error: null,
            };
          }
        } else if (qr) {
          session.status = {
            state: 'qr',
            qr: await QRCode.toDataURL(qr, { margin: 1, width: 320 }),
            pairingCode: null,
            linkedNumber: null,
            error: null,
          };
        }
        if (connection === 'open') {
          session.retries = 0;
          session.status = {
            state: 'connected',
            qr: null,
            pairingCode: null,
            linkedNumber: phoneFromJid(sock.user?.id),
            error: null,
          };
          this.logger.log(`Local ${tenantId}: WhatsApp vinculado (${session.status.linkedNumber})`);
        }
        if (connection === 'close' && !session.stopped) {
          const code = (lastDisconnect?.error as { output?: { statusCode?: number } } | undefined)?.output?.statusCode;
          if (code === DisconnectReason.loggedOut) {
            // El dueño cerró la sesión desde el teléfono: hay que volver a escanear.
            fs.rmSync(this.authDir(tenantId), { recursive: true, force: true });
            this.sessions.delete(tenantId);
            this.logger.warn(`Local ${tenantId}: sesión de WhatsApp cerrada desde el teléfono`);
          } else if (session.retries < MAX_RETRIES) {
            session.retries++;
            session.status = { ...session.status, state: 'connecting', qr: null, pairingCode: null };
            setTimeout(() => void this.connect(tenantId, session), 2000 * session.retries);
          } else {
            this.errors.set(tenantId, 'No se pudo conectar con WhatsApp. Revisa la conexión a internet del servidor.');
            this.sessions.delete(tenantId);
            this.logger.error(`Local ${tenantId}: no se pudo conectar con WhatsApp (código ${code ?? 'desconocido'})`);
          }
        }
      });

      sock.ev.on('messages.upsert', ({ messages, type }) => {
        if (type !== 'notify') return; // solo mensajes nuevos, no el historial
        for (const m of messages) void this.receive(tenantId, session, m);
      });
    } catch (e) {
      this.errors.set(tenantId, 'No se pudo iniciar la vinculación con WhatsApp.');
      this.sessions.delete(tenantId);
      this.logger.error(`Local ${tenantId}: error iniciando Baileys`, e as Error);
    }
  }

  private async receive(tenantId: number, session: Session, m: WAMessage) {
    try {
      const jid = m.key.remoteJid;
      if (m.key.fromMe || !m.message || !jid || !m.key.id) return;
      // Las cuentas nuevas llegan con un identificador interno (@lid); si viene el teléfono real, se usa.
      const key = m.key as typeof m.key & { senderPn?: string; remoteJidAlt?: string };
      const from = phoneFromJid(key.senderPn) ?? phoneFromJid(key.remoteJidAlt) ?? phoneFromJid(jid);
      if (!from) return; // grupos, estados y canales no se atienden
      const at = new Date(Number(m.messageTimestamp ?? 0) * 1000);
      if (at.getTime() < session.startedAt - 60_000) return; // mensajes viejos al reconectar

      session.jids.set(from, jid);
      const text = m.message.conversation ?? m.message.extendedTextMessage?.text ?? '';
      await this.handler?.({ tenantId, from, messageId: m.key.id, text, name: m.pushName ?? undefined, at });
    } catch (e) {
      this.logger.error(`Local ${tenantId}: error procesando un mensaje`, e as Error);
    }
  }
}

/**
 * Si el servidor sale a internet por un proxy (WA_PROXY o HTTPS_PROXY), la conexión con
 * WhatsApp también debe usarlo: la librería no lee esas variables por sí sola.
 */
function proxyAgent(): { agent?: Agent; fetchAgent?: Agent } {
  const proxy = process.env.WA_PROXY ?? process.env.HTTPS_PROXY ?? process.env.https_proxy;
  if (!proxy) return {};
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { HttpsProxyAgent } = require('https-proxy-agent') as { HttpsProxyAgent: new (url: string) => Agent };
  const agent = new HttpsProxyAgent(proxy);
  return { agent, fetchAgent: agent };
}
