import { Module } from '@nestjs/common';
import { AiModule } from '../ai/ai.module';
import { SchedulingModule } from '../scheduling/scheduling.module';
import { TenantsModule } from '../tenants/tenants.module';
import { BotService } from './bot.service';
import { InboundService } from './inbound.service';
import { SimulatorController } from './simulator.controller';
import { WebhookController } from './webhook.controller';

@Module({
  imports: [TenantsModule, SchedulingModule, AiModule],
  controllers: [WebhookController, SimulatorController],
  providers: [BotService, InboundService],
})
export class WhatsappModule {}
