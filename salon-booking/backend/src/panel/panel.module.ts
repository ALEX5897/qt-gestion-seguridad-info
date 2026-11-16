import { Module } from '@nestjs/common';
import { AiModule } from '../ai/ai.module';
import { SchedulingModule } from '../scheduling/scheduling.module';
import { TenantsModule } from '../tenants/tenants.module';
import { AccountController } from './account.controller';
import { AppointmentsController } from './appointments.controller';
import { CatalogController } from './catalog.controller';
import { CustomersController } from './customers.controller';

/** API del panel del local (dueño y personal). */
@Module({
  imports: [SchedulingModule, TenantsModule, AiModule],
  controllers: [AccountController, CatalogController, AppointmentsController, CustomersController],
})
export class PanelModule {}
