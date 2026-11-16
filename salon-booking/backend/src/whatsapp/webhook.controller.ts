import {
  Body,
  Controller,
  ForbiddenException,
  Get,
  Headers,
  HttpCode,
  Logger,
  Post,
  Query,
  RawBodyRequest,
  Req,
} from '@nestjs/common';
import { Request } from 'express';
import { Public } from '../auth/auth.decorators';
import { InboundService } from './inbound.service';
import { parseMetaWebhook, verifyMetaSignature } from './meta-webhook';

/** Webhook de WhatsApp Cloud API. Configurar en Meta: https://<dominio>/api/webhooks/whatsapp */
@Public()
@Controller('webhooks/whatsapp')
export class WebhookController {
  private readonly logger = new Logger(WebhookController.name);

  constructor(private readonly inbound: InboundService) {}

  /** Verificación inicial que hace Meta al registrar el webhook. */
  @Get()
  verify(
    @Query('hub.mode') mode: string,
    @Query('hub.verify_token') token: string,
    @Query('hub.challenge') challenge: string,
  ) {
    if (mode === 'subscribe' && token && token === process.env.META_VERIFY_TOKEN) return challenge;
    throw new ForbiddenException();
  }

  @Post()
  @HttpCode(200)
  receive(
    @Req() req: RawBodyRequest<Request>,
    @Headers('x-hub-signature-256') signature: string | undefined,
    @Body() body: unknown,
  ) {
    if (!req.rawBody || !verifyMetaSignature(req.rawBody, signature, process.env.META_APP_SECRET ?? '')) {
      throw new ForbiddenException('Firma inválida');
    }
    // Se responde 200 de inmediato; Meta reintenta si tardamos.
    // Fase 4: encolar en BullMQ para garantizar orden por cliente y reintentos.
    for (const msg of parseMetaWebhook(body)) {
      this.inbound.handle(msg).catch((e) => this.logger.error(`Error procesando ${msg.providerMessageId}`, e));
    }
    return { ok: true };
  }
}
