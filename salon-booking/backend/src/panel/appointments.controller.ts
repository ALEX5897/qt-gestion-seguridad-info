import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  Get,
  NotFoundException,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { dayLongOf, normalizePhone, time } from '../common/format';
import { Roles, TenantId } from '../auth/auth.decorators';
import { PrismaService } from '../prisma/prisma.service';
import { dayBoundsUtc } from '../scheduling/availability';
import { BookingService, SlotTakenError } from '../scheduling/booking.service';
import { WaitlistService } from '../scheduling/waitlist.service';
import { MessagingService } from '../whatsapp/messaging.service';
import { AppointmentStatusDto, CreateAppointmentDto, RescheduleDto } from './panel.dto';

const include = { customer: true, service: true, professional: { select: { id: true, name: true, color: true } } };

/** Agenda del local: ver el día, registrar citas manuales, cambiar estados, reprogramar. */
@Roles('OWNER', 'STAFF')
@Controller()
export class AppointmentsController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly booking: BookingService,
    private readonly waitlist: WaitlistService,
    private readonly messaging: MessagingService,
  ) {}

  /** Citas de un día local (YYYY-MM-DD), incluidas las canceladas. */
  @Get('appointments')
  async list(@TenantId() tenantId: number, @Query('date') date: string) {
    const tenant = await this.prisma.tenant.findUniqueOrThrow({ where: { id: tenantId } });
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date ?? '')) throw new BadRequestException('Fecha inválida (use YYYY-MM-DD)');
    const { start, end } = dayBoundsUtc(date, tenant.timezone);
    return this.prisma.appointment.findMany({
      where: { tenantId, startsAt: { gte: start, lte: end } },
      include,
      orderBy: { startsAt: 'asc' },
    });
  }

  /** Cita registrada por el local (cliente que llama o llega sin reserva). */
  @Post('appointments')
  async create(@TenantId() tenantId: number, @Body() dto: CreateAppointmentDto) {
    const phone = normalizePhone(dto.customerPhone);
    if (!phone) throw new BadRequestException('Teléfono inválido');
    const customer = await this.prisma.customer.upsert({
      where: { tenantId_phone: { tenantId, phone } },
      create: { tenantId, phone, name: dto.customerName },
      update: dto.customerName ? { name: dto.customerName } : {},
    });
    try {
      return await this.booking.book({
        tenantId,
        customerId: customer.id,
        professionalId: dto.professionalId,
        serviceId: dto.serviceId,
        startsAt: new Date(dto.startsAt),
        source: 'MANUAL',
        notes: dto.notes,
      });
    } catch (e) {
      if (e instanceof SlotTakenError) throw new ConflictException('Ese horario ya está ocupado');
      throw e;
    }
  }

  @Patch('appointments/:id/status')
  async setStatus(
    @TenantId() tenantId: number,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: AppointmentStatusDto,
  ) {
    const appt = await this.prisma.appointment.findFirst({
      where: { id, tenantId },
      include: { ...include, tenant: true },
    });
    if (!appt) throw new NotFoundException('Cita no encontrada');
    const active = appt.status === 'PENDING' || appt.status === 'CONFIRMED';
    if (!active) throw new ConflictException('La cita ya está cerrada');

    switch (dto.status) {
      case 'CONFIRMED':
        await this.booking.confirm(tenantId, id);
        break;
      case 'CANCELLED': {
        await this.booking.cancel(tenantId, id, 'BUSINESS');
        const tz = appt.tenant.timezone;
        await this.messaging.send(appt.tenant, appt.customer.phone, [
          {
            type: 'buttons',
            text: `Lo sentimos 🙏 *${appt.tenant.name}* tuvo que cancelar tu cita de ${appt.service.name} del ${dayLongOf(appt.startsAt, tz)} a las ${time(appt.startsAt, tz)}.`,
            buttons: [{ id: 'menu:book', title: 'Agendar otra cita' }],
          },
        ]);
        break;
      }
      case 'COMPLETED':
        await this.prisma.appointment.update({ where: { id }, data: { status: 'COMPLETED' } });
        break;
      case 'NO_SHOW':
        await this.prisma.$transaction([
          this.prisma.appointment.update({ where: { id }, data: { status: 'NO_SHOW' } }),
          this.prisma.customer.update({ where: { id: appt.customerId }, data: { noShowCount: { increment: 1 } } }),
        ]);
        break;
    }
    return this.prisma.appointment.findUnique({ where: { id }, include });
  }

  @Post('appointments/:id/reschedule')
  async reschedule(@TenantId() tenantId: number, @Param('id', ParseIntPipe) id: number, @Body() dto: RescheduleDto) {
    try {
      const result = await this.booking.reschedule(tenantId, id, dto.professionalId, new Date(dto.startsAt));
      if (!result) throw new NotFoundException('Cita no encontrada o ya cerrada');
      const tenant = await this.prisma.tenant.findUniqueOrThrow({ where: { id: tenantId } });
      const a = result.created;
      await this.messaging.send(tenant, a.customer.phone, [
        {
          type: 'text',
          text: `📅 *${tenant.name}* movió tu cita de ${a.service.name}. Nuevo horario: ${dayLongOf(a.startsAt, tenant.timezone)} a las ${time(a.startsAt, tenant.timezone)} con ${a.professional.name}.`,
        },
      ]);
      return a;
    } catch (e) {
      if (e instanceof SlotTakenError) throw new ConflictException('Ese horario ya está ocupado');
      throw e;
    }
  }

  // ───────────── Fila de espera ─────────────

  @Get('waitlist')
  waitlistEntries(@TenantId() tenantId: number) {
    return this.prisma.waitlistEntry.findMany({
      where: { tenantId, status: { in: ['WAITING', 'OFFERED'] } },
      include: { customer: true, service: true, offers: { where: { status: 'PENDING' } } },
      orderBy: [{ date: 'asc' }, { createdAt: 'asc' }],
    });
  }

  @Post('waitlist/:id/remove')
  async removeFromWaitlist(@TenantId() tenantId: number, @Param('id', ParseIntPipe) id: number) {
    if (!(await this.waitlist.leave(tenantId, id))) throw new NotFoundException('Entrada no encontrada');
    return { ok: true };
  }
}
