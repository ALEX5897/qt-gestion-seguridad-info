import { Body, Controller, Get, Param, ParseIntPipe, Patch, Post } from '@nestjs/common';
import { AuthUser, CurrentUser, Roles } from '../auth/auth.decorators';
import { CreateTenantDto, RegisterPaymentDto, SetStatusDto } from './tenants.dto';
import { TenantsService } from './tenants.service';

/** Panel del administrador general: alta de locales, habilitar/deshabilitar, pagos. */
@Roles('SUPERADMIN')
@Controller('admin')
export class AdminTenantsController {
  constructor(private readonly tenants: TenantsService) {}

  @Get('plans')
  plans() {
    return this.tenants.plans();
  }

  @Get('tenants')
  list() {
    return this.tenants.list();
  }

  @Post('tenants')
  create(@Body() dto: CreateTenantDto) {
    return this.tenants.create(dto);
  }

  @Patch('tenants/:id/status')
  setStatus(@Param('id', ParseIntPipe) id: number, @Body() dto: SetStatusDto) {
    return this.tenants.setStatus(id, dto.status);
  }

  @Post('tenants/:id/payments')
  registerPayment(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: RegisterPaymentDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.tenants.registerPayment(id, dto, user.sub);
  }
}
