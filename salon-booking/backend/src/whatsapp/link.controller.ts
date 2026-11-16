import { BadRequestException, Body, Controller, Delete, Get, HttpCode, Post } from '@nestjs/common';
import { IsOptional, IsString } from 'class-validator';
import { normalizePhone } from '../common/format';
import { Roles, TenantId } from '../auth/auth.decorators';
import { BaileysBridge } from './baileys.bridge';
import { BaileysManager } from './providers/baileys.manager';

class StartLinkDto {
  /** Número a vincular con código de 8 caracteres; sin él se usa el código QR. */
  @IsOptional() @IsString() phone?: string;
}

/**
 * Vinculación del WhatsApp del local con un código QR o con un código de 8 caracteres.
 * Solo existe con WHATSAPP_PROVIDER=baileys (modo de pruebas, no oficial).
 */
@Roles('OWNER')
@Controller('whatsapp/link')
export class LinkController {
  constructor(
    private readonly manager: BaileysManager,
    private readonly bridge: BaileysBridge,
  ) {}

  @Get()
  status(@TenantId() tenantId: number) {
    return { available: this.bridge.active, ...this.manager.status(tenantId) };
  }

  @Post()
  @HttpCode(200)
  async start(@TenantId() tenantId: number, @Body() dto: StartLinkDto) {
    if (!this.bridge.active) throw new BadRequestException('La vinculación no está activada en esta instalación');
    const phone = dto.phone ? normalizePhone(dto.phone) : null;
    if (dto.phone && !phone)
      throw new BadRequestException('Número inválido. Escríbelo con código de país, p. ej. 593991234567');
    return { available: true, ...(await this.manager.start(tenantId, phone)) };
  }

  @Delete()
  async logout(@TenantId() tenantId: number) {
    if (!this.bridge.active)
      throw new BadRequestException('La vinculación por código QR no está activada en esta instalación');
    await this.manager.logout(tenantId);
    return { available: true, ...this.manager.status(tenantId) };
  }
}
