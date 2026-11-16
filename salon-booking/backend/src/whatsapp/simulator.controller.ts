import { Body, Controller, Get, Inject, NotFoundException, Post, Query } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { IsDateString, IsOptional, IsString } from 'class-validator';
import { Public } from '../auth/auth.decorators';
import { AutomationService } from '../scheduling/automation.service';
import { InboundService } from './inbound.service';
import { ConsoleProvider } from './providers/console.provider';
import { WHATSAPP_PROVIDER, WhatsAppProvider } from './whatsapp.types';

class SimulateDto {
  /** Número del local (whatsappNumber). */
  @IsString() to: string;
  /** Teléfono del cliente simulado. */
  @IsString() from: string;
  @IsOptional() @IsString() text?: string;
  /** id del botón/fila que "pulsa" el cliente. */
  @IsOptional() @IsString() replyId?: string;
  @IsOptional() @IsString() name?: string;
  /** Simular que el mensaje llega en otro momento. */
  @IsOptional() @IsDateString() now?: string;
}

class TickDto {
  /** Simular el paso del tiempo: ejecutar las tareas automáticas como si fuera esta hora. */
  @IsOptional() @IsDateString() now?: string;
}

/**
 * Herramientas de desarrollo (solo con WHATSAPP_PROVIDER=console):
 * simulan mensajes de clientes y el paso del tiempo, sin cuenta de Meta.
 */
@Public()
@Controller('dev')
export class SimulatorController {
  constructor(
    private readonly inbound: InboundService,
    private readonly automation: AutomationService,
    @Inject(WHATSAPP_PROVIDER) private readonly provider: WhatsAppProvider,
  ) {}

  @Post('whatsapp/simulate')
  async simulate(@Body() dto: SimulateDto) {
    const outbox = this.outbox();
    const before = outbox.length;
    await this.inbound.handle(
      {
        channel: { whatsappNumber: dto.to },
        from: dto.from,
        providerMessageId: `sim-in-${randomUUID()}`,
        text: dto.text,
        replyId: dto.replyId,
        profileName: dto.name,
        receivedAt: new Date(),
      },
      dto.now ? new Date(dto.now) : undefined,
    );
    return outbox
      .slice(before)
      .filter((m) => m.to === dto.from)
      .map((m) => m.message);
  }

  /** Mensajes enviados por el sistema (para ver recordatorios y ofertas de la fila de espera). */
  @Get('whatsapp/outbox')
  list(@Query('phone') phone?: string, @Query('last') last?: string) {
    const items = this.outbox().filter((m) => !phone || m.to === phone);
    return last ? items.slice(-Number(last)) : items;
  }

  @Post('automation/tick')
  tick(@Body() dto: TickDto) {
    this.outbox();
    return this.automation.tick(dto.now ? new Date(dto.now) : new Date());
  }

  private outbox() {
    if (!(this.provider instanceof ConsoleProvider)) throw new NotFoundException();
    return this.provider.outbox;
  }
}
