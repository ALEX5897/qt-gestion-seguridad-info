import { Injectable } from '@nestjs/common';
import { AiUsageKind } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

/** Cupo de respuestas del asistente durante el período de prueba (sin plan). */
export const TRIAL_AI_QUOTA = 100;

const monthOf = (d: Date) => d.toISOString().slice(0, 7);

/** Registra el consumo de IA por local y aplica el cupo mensual del plan. */
@Injectable()
export class AiUsageService {
  constructor(private readonly prisma: PrismaService) {}

  async record(tenantId: number, kind: AiUsageKind, inputTokens: number, outputTokens: number, now = new Date()) {
    const month = monthOf(now);
    await this.prisma.aiUsage.upsert({
      where: { tenantId_month_kind: { tenantId, month, kind } },
      create: { tenantId, month, kind, requests: 1, inputTokens, outputTokens },
      update: {
        requests: { increment: 1 },
        inputTokens: { increment: inputTokens },
        outputTokens: { increment: outputTokens },
      },
    });
  }

  /** Respuestas del asistente usadas este mes y el cupo que da el plan. */
  async assistantQuota(tenantId: number, now = new Date()) {
    const [usage, sub] = await Promise.all([
      this.prisma.aiUsage.findUnique({
        where: { tenantId_month_kind: { tenantId, month: monthOf(now), kind: 'ASSISTANT' } },
      }),
      this.prisma.subscription.findFirst({
        where: { tenantId },
        orderBy: { currentPeriodEnd: 'desc' },
        include: { plan: true },
      }),
    ]);
    const used = usage?.requests ?? 0;
    const limit = sub?.plan.monthlyAiQuota ?? TRIAL_AI_QUOTA;
    return { used, limit, available: used < limit };
  }
}
