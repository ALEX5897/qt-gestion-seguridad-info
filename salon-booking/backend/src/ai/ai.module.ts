import { Module } from '@nestjs/common';
import { SchedulingModule } from '../scheduling/scheduling.module';
import { AiUsageService } from './ai-usage.service';
import { AI_CLIENT, createAiClient } from './ai.client';
import { AssistantService } from './assistant.service';
import { InsightsController } from './insights.controller';
import { InsightsService } from './insights.service';

/** Inteligencia artificial: asistente del bot y consejos para el dueño. Es opcional. */
@Module({
  imports: [SchedulingModule],
  controllers: [InsightsController],
  providers: [{ provide: AI_CLIENT, useFactory: createAiClient }, AiUsageService, AssistantService, InsightsService],
  exports: [AssistantService, AiUsageService],
})
export class AiModule {}
