import {
  Body,
  ConflictException,
  Controller,
  Get,
  NotFoundException,
  Param,
  ParseIntPipe,
  Patch,
  Post,
} from '@nestjs/common';
import * as bcrypt from 'bcrypt';
import { AuthUser, CurrentUser, Roles, TenantId } from '../auth/auth.decorators';
import { PrismaService } from '../prisma/prisma.service';
import { TenantsService } from '../tenants/tenants.service';
import { CreateStaffDto, SettingsDto, UpdateStaffDto } from './panel.dto';

@Controller()
export class AccountController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tenants: TenantsService,
  ) {}

  /** Datos de la sesión: usuario, local, estado de la suscripción. */
  @Get('me')
  async me(@CurrentUser() auth: AuthUser) {
    const user = await this.prisma.user.findUniqueOrThrow({
      where: { id: auth.sub },
      select: { id: true, name: true, email: true, role: true, tenantId: true },
    });
    if (!user.tenantId) return { user, tenant: null, subscription: null };
    const tenant = await this.prisma.tenant.findUniqueOrThrow({ where: { id: user.tenantId } });
    const sub = await this.prisma.subscription.findFirst({
      where: { tenantId: tenant.id },
      orderBy: { currentPeriodEnd: 'desc' },
      include: { plan: true },
    });
    const { serviceable, reason } = await this.tenants.isServiceable(tenant);
    return {
      user,
      tenant,
      subscription: {
        serviceable,
        reason,
        plan: sub?.plan.name ?? null,
        validUntil: sub?.currentPeriodEnd ?? tenant.trialEndsAt,
      },
    };
  }

  @Roles('OWNER')
  @Patch('tenant/settings')
  updateSettings(@TenantId() tenantId: number, @Body() dto: SettingsDto) {
    return this.prisma.tenant.update({ where: { id: tenantId }, data: dto });
  }

  // ───────────── Usuarios del local ─────────────

  @Roles('OWNER')
  @Get('staff')
  staff(@TenantId() tenantId: number) {
    return this.prisma.user.findMany({
      where: { tenantId },
      select: { id: true, name: true, email: true, role: true, active: true },
      orderBy: { id: 'asc' },
    });
  }

  /** El dueño crea cuentas para su personal (pueden ver la agenda, no cambiar el catálogo). */
  @Roles('OWNER')
  @Post('staff')
  async createStaff(@TenantId() tenantId: number, @Body() dto: CreateStaffDto) {
    const email = dto.email.toLowerCase();
    if (await this.prisma.user.findUnique({ where: { email } })) {
      throw new ConflictException('Ya existe un usuario con ese correo');
    }
    return this.prisma.user.create({
      data: { tenantId, name: dto.name, email, role: 'STAFF', passwordHash: await bcrypt.hash(dto.password, 10) },
      select: { id: true, name: true, email: true, role: true, active: true },
    });
  }

  @Roles('OWNER')
  @Patch('staff/:id')
  async updateStaff(@TenantId() tenantId: number, @Param('id', ParseIntPipe) id: number, @Body() dto: UpdateStaffDto) {
    const user = await this.prisma.user.findFirst({ where: { id, tenantId, role: 'STAFF' } });
    if (!user) throw new NotFoundException('Usuario no encontrado');
    return this.prisma.user.update({
      where: { id },
      data: { active: dto.active },
      select: { id: true, name: true, email: true, role: true, active: true },
    });
  }
}
