import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import * as bcrypt from 'bcrypt';
import { DateTime } from 'luxon';
import { PrismaService } from '../prisma/prisma.service';
import { CreateTenantDto, RegisterPaymentDto } from './tenants.dto';
import { checkServiceability } from './serviceability';
import { TenantStatus } from '@prisma/client';

@Injectable()
export class TenantsService {
  constructor(private readonly prisma: PrismaService) {}

  /** Locales con su estado real de servicio y el consumo del mes. */
  async list() {
    const tenants = await this.prisma.tenant.findMany({
      orderBy: { createdAt: 'desc' },
      include: {
        subscriptions: { orderBy: { currentPeriodEnd: 'desc' }, take: 1, include: { plan: true } },
        users: { where: { role: 'OWNER' }, select: { name: true, email: true }, take: 1 },
        _count: { select: { professionals: { where: { active: true } }, customers: true } },
      },
    });
    const monthStart = DateTime.now().startOf('month').toJSDate();
    const now = new Date();
    return Promise.all(
      tenants.map(async ({ subscriptions, users, _count, ...t }) => {
        const sub = subscriptions[0] ?? null;
        const messagesThisMonth = await this.prisma.messageLog.count({
          where: { tenantId: t.id, direction: 'OUT', createdAt: { gte: monthStart } },
        });
        return {
          ...t,
          owner: users[0] ?? null,
          plan: sub?.plan ?? null,
          validUntil: sub?.currentPeriodEnd ?? t.trialEndsAt,
          ...checkServiceability(t, sub, now),
          usage: { professionals: _count.professionals, customers: _count.customers, messagesThisMonth },
        };
      }),
    );
  }

  plans() {
    return this.prisma.plan.findMany({ where: { active: true }, orderBy: { priceCents: 'asc' } });
  }

  async create(dto: CreateTenantDto) {
    const exists = await this.prisma.tenant.findFirst({
      where: { OR: [{ slug: dto.slug }, { whatsappNumber: dto.whatsappNumber }] },
    });
    if (exists) throw new ConflictException('Ya existe un local con ese slug o número');
    if (await this.prisma.user.findUnique({ where: { email: dto.ownerEmail.toLowerCase() } })) {
      throw new ConflictException('Ya existe un usuario con ese correo');
    }

    const passwordHash = await bcrypt.hash(dto.ownerPassword, 10);
    return this.prisma.tenant.create({
      data: {
        name: dto.name,
        slug: dto.slug,
        whatsappNumber: dto.whatsappNumber,
        waPhoneNumberId: dto.waPhoneNumberId,
        address: dto.address,
        status: 'TRIAL',
        trialEndsAt: DateTime.now()
          .plus({ days: dto.trialDays ?? 14 })
          .toJSDate(),
        users: {
          create: { name: dto.ownerName, email: dto.ownerEmail.toLowerCase(), passwordHash, role: 'OWNER' },
        },
      },
    });
  }

  async setStatus(id: number, status: TenantStatus) {
    await this.ensure(id);
    return this.prisma.tenant.update({ where: { id }, data: { status } });
  }

  /**
   * Registra un pago manual y extiende la suscripción.
   * El nuevo período empieza al terminar el vigente (o hoy, si ya venció).
   */
  async registerPayment(id: number, dto: RegisterPaymentDto, recordedById: number) {
    await this.ensure(id);
    const plan = await this.prisma.plan.findUnique({ where: { code: dto.planCode } });
    if (!plan) throw new NotFoundException('Plan no encontrado');

    const last = await this.latestSubscription(id);
    const now = new Date();
    const start = last && last.currentPeriodEnd > now ? last.currentPeriodEnd : now;
    const end = DateTime.fromJSDate(start).plus({ months: dto.months }).toJSDate();

    return this.prisma.$transaction(async (tx) => {
      const sub = await tx.subscription.create({
        data: { tenantId: id, planId: plan.id, currentPeriodStart: start, currentPeriodEnd: end },
      });
      await tx.payment.create({
        data: {
          subscriptionId: sub.id,
          amountCents: dto.amountCents,
          method: dto.method,
          reference: dto.reference,
          paidAt: now,
          recordedById,
        },
      });
      await tx.tenant.update({ where: { id }, data: { status: 'ACTIVE' } });
      return sub;
    });
  }

  findByWhatsappNumber(whatsappNumber: string) {
    return this.prisma.tenant.findUnique({ where: { whatsappNumber } });
  }

  findByWaPhoneNumberId(waPhoneNumberId: string) {
    return this.prisma.tenant.findUnique({ where: { waPhoneNumberId } });
  }

  async isServiceable(tenant: { id: number; status: TenantStatus; trialEndsAt: Date | null }) {
    return checkServiceability(tenant, await this.latestSubscription(tenant.id), new Date());
  }

  private latestSubscription(tenantId: number) {
    return this.prisma.subscription.findFirst({ where: { tenantId }, orderBy: { currentPeriodEnd: 'desc' } });
  }

  private async ensure(id: number) {
    if (!(await this.prisma.tenant.findUnique({ where: { id } }))) throw new NotFoundException('Local no encontrado');
  }
}
