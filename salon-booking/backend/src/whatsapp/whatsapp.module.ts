import { Module } from '@nestjs/common';
import { SchedulingModule } from '../scheduling/scheduling.module';
import { TenantsModule } from '../tenants/tenants.module';
import { BotService } from './bot.service';
import { InboundService } from './inbound.service';
import { SimulatorController } from './simulator.controller';
import { WebhookController } from './webhook.controller';

@Module({
  imports: [TenantsModule, SchedulingModule],
  controllers: [WebhookController, SimulatorController],
  providers: [BotService, InboundService],
})
export class WhatsappModule {}
