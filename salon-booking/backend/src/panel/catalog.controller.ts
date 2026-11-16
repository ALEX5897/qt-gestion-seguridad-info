import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  NotFoundException,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { Roles, TenantId } from '../auth/auth.decorators';
import { PrismaService } from '../prisma/prisma.service';
import { ProfessionalDto, ServiceDto, TimeOffDto } from './panel.dto';

/** Límite de profesionales durante el período de prueba (sin plan contratado). */
const TRIAL_MAX_PROFESSIONALS = 3;

/** Catálogo del local: servicios, profesionales con sus horarios, y bloqueos de agenda. */
@Roles('OWNER', 'STAFF')
@Controller()
export class CatalogController {
  constructor(private readonly prisma: PrismaService) {}

  // ───────────── Servicios ─────────────

  @Get('services')
  services(@TenantId() tenantId: number) {
    return this.prisma.service.findMany({ where: { tenantId }, orderBy: [{ active: 'desc' }, { name: 'asc' }] });
  }

  @Roles('OWNER')
  @Post('services')
  createService(@TenantId() tenantId: number, @Body() dto: ServiceDto) {
    return this.prisma.service.create({ data: { ...dto, tenantId } });
  }

  @Roles('OWNER')
  @Patch('services/:id')
  async updateService(@TenantId() tenantId: number, @Param('id', ParseIntPipe) id: number, @Body() dto: ServiceDto) {
    await this.own('service', tenantId, id);
    return this.prisma.service.update({ where: { id }, data: dto });
  }

  // ───────────── Profesionales ─────────────

  @Get('professionals')
  professionals(@TenantId() tenantId: number) {
    return this.prisma.professional.findMany({
      where: { tenantId },
      include: { workingHours: { orderBy: [{ weekday: 'asc' }, { startMinute: 'asc' }] }, services: true },
      orderBy: [{ active: 'desc' }, { name: 'asc' }],
    });
  }

  @Roles('OWNER')
  @Post('professionals')
  async createProfessional(@TenantId() tenantId: number, @Body() dto: ProfessionalDto) {
    await this.checkProfessionalLimit(tenantId);
    await this.validateProfessional(tenantId, dto);
    const { workingHours = [], services = [], ...data } = dto;
    return this.prisma.professional.create({
      data: {
        ...data,
        tenantId,
        workingHours: { create: workingHours },
        services: {
          create: services.map((s) => ({ serviceId: s.serviceId, durationMinutes: s.durationMinutes ?? null })),
        },
      },
      include: { workingHours: true, services: true },
    });
  }

  @Roles('OWNER')
  @Patch('professionals/:id')
  async updateProfessional(
    @TenantId() tenantId: number,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: ProfessionalDto,
  ) {
    const current = await this.own('professional', tenantId, id);
    if (dto.active && !current.active) await this.checkProfessionalLimit(tenantId);
    await this.validateProfessional(tenantId, dto);
    const { workingHours, services, ...data } = dto;
    return this.prisma.$transaction(async (tx) => {
      if (workingHours) {
        await tx.workingHours.deleteMany({ where: { professionalId: id } });
        await tx.workingHours.createMany({ data: workingHours.map((w) => ({ ...w, professionalId: id })) });
      }
      if (services) {
        await tx.professionalService.deleteMany({ where: { professionalId: id } });
        await tx.professionalService.createMany({
          data: services.map((s) => ({
            professionalId: id,
            serviceId: s.serviceId,
            durationMinutes: s.durationMinutes ?? null,
          })),
        });
      }
      return tx.professional.update({ where: { id }, data, include: { workingHours: true, services: true } });
    });
  }

  // ───────────── Bloqueos ─────────────

  @Get('time-offs')
  timeOffs(@TenantId() tenantId: number, @Query('all') all?: string) {
    return this.prisma.timeOff.findMany({
      where: { tenantId, ...(all ? {} : { endsAt: { gte: new Date() } }) },
      include: { professional: { select: { id: true, name: true } } },
      orderBy: { startsAt: 'asc' },
    });
  }

  @Post('time-offs')
  async createTimeOff(@TenantId() tenantId: number, @Body() dto: TimeOffDto) {
    const startsAt = new Date(dto.startsAt);
    const endsAt = new Date(dto.endsAt);
    if (endsAt <= startsAt) throw new BadRequestException('El fin debe ser posterior al inicio');
    if (dto.professionalId) await this.own('professional', tenantId, dto.professionalId);
    return this.prisma.timeOff.create({
      data: { tenantId, professionalId: dto.professionalId ?? null, startsAt, endsAt, reason: dto.reason },
    });
  }

  @Delete('time-offs/:id')
  async deleteTimeOff(@TenantId() tenantId: number, @Param('id', ParseIntPipe) id: number) {
    await this.own('timeOff', tenantId, id);
    await this.prisma.timeOff.delete({ where: { id } });
    return { ok: true };
  }

  // ───────────── utilidades ─────────────

  /** Garantiza que el registro pertenece al local del usuario. */
  private async own(model: 'service' | 'professional' | 'timeOff', tenantId: number, id: number) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const row = await (this.prisma[model] as any).findFirst({ where: { id, tenantId } });
    if (!row) throw new NotFoundException('Registro no encontrado');
    return row;
  }

  private async validateProfessional(tenantId: number, dto: ProfessionalDto) {
    for (const w of dto.workingHours ?? []) {
      if (w.endMinute <= w.startMinute)
        throw new BadRequestException('Horario inválido: el fin debe ser mayor al inicio');
    }
    const byDay = new Map<number, { startMinute: number; endMinute: number }[]>();
    for (const w of dto.workingHours ?? []) byDay.set(w.weekday, [...(byDay.get(w.weekday) ?? []), w]);
    for (const ranges of byDay.values()) {
      ranges.sort((a, b) => a.startMinute - b.startMinute);
      for (let i = 1; i < ranges.length; i++) {
        if (ranges[i].startMinute < ranges[i - 1].endMinute) {
          throw new BadRequestException('Los horarios de un mismo día no pueden cruzarse');
        }
      }
    }
    const ids = [...new Set((dto.services ?? []).map((s) => s.serviceId))];
    if (ids.length !== (dto.services ?? []).length) throw new BadRequestException('Servicio repetido');
    if (ids.length) {
      const count = await this.prisma.service.count({ where: { tenantId, id: { in: ids } } });
      if (count !== ids.length) throw new BadRequestException('Servicio no pertenece al local');
    }
  }

  private async checkProfessionalLimit(tenantId: number) {
    const [active, sub] = await Promise.all([
      this.prisma.professional.count({ where: { tenantId, active: true } }),
      this.prisma.subscription.findFirst({
        where: { tenantId },
        orderBy: { currentPeriodEnd: 'desc' },
        include: { plan: true },
      }),
    ]);
    const max = sub?.plan.maxProfessionals ?? TRIAL_MAX_PROFESSIONALS;
    if (active >= max) {
      throw new ForbiddenException(
        `Tu plan permite hasta ${max} profesionales activos. Mejora tu plan para agregar más.`,
      );
    }
  }
}
