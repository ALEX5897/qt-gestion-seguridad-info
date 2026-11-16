import { Controller, Get, ParseIntPipe, Query } from '@nestjs/common';
import { Roles, TenantId } from '../auth/auth.decorators';
import { SchedulingService } from './scheduling.service';

/** Consulta de disponibilidad desde el panel del local. */
@Roles('OWNER', 'STAFF')
@Controller('availability')
export class SchedulingController {
  constructor(private readonly scheduling: SchedulingService) {}

  @Get()
  get(
    @TenantId() tenantId: number,
    @Query('serviceId', ParseIntPipe) serviceId: number,
    @Query('date') date: string,
    @Query('professionalId') professionalId?: string,
    @Query('ignoreAppointmentId') ignoreAppointmentId?: string,
  ) {
    return this.scheduling.getAvailability(tenantId, serviceId, date, {
      professionalId: professionalId ? Number(professionalId) : undefined,
      ignoreAppointmentId: ignoreAppointmentId ? Number(ignoreAppointmentId) : undefined,
    });
  }
}
