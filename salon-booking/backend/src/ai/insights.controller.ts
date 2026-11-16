import { Controller, Get, HttpCode, Post } from '@nestjs/common';
import { Roles, TenantId } from '../auth/auth.decorators';
import { InsightsService } from './insights.service';

/** Indicadores y consejos del negocio (solo el dueño). */
@Roles('OWNER')
@Controller('insights')
export class InsightsController {
  constructor(private readonly insights: InsightsService) {}

  @Get()
  async get(@TenantId() tenantId: number) {
    const [metrics, advice] = await Promise.all([this.insights.metrics(tenantId), this.insights.latest(tenantId)]);
    return { metrics, advice, aiAvailable: this.insights.configured };
  }

  @Post('advice')
  @HttpCode(200)
  advice(@TenantId() tenantId: number) {
    return this.insights.advice(tenantId);
  }
}
