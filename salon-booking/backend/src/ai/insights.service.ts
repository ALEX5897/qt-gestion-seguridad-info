import Anthropic from '@anthropic-ai/sdk';
import { betaZodOutputFormat } from '@anthropic-ai/sdk/helpers/beta/zod';
import { Inject, Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { DateTime } from 'luxon';
import { z } from 'zod';
import { PrismaService } from '../prisma/prisma.service';
import { AiUsageService } from './ai-usage.service';
import { AI_CLIENT, AI_MODEL } from './ai.client';

const WINDOW_DAYS = 30;
const INACTIVE_DAYS = 45;
/** No se regenera el análisis más de una vez en este lapso (control de costo). */
const ADVICE_TTL_MS = 6 * 3_600_000;
const WEEKDAYS = ['lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado', 'domingo'];

const AdviceSchema = z.object({
  resumen: z.string().describe('Dos o tres frases con el estado del negocio en el período'),
  consejos: z
    .array(
      z.object({
        titulo: z.string().describe('Acción en pocas palabras'),
        por_que: z.string().describe('El dato concreto de las métricas que lo justifica'),
        accion: z.string().describe('Qué hacer exactamente, en uno o dos pasos'),
        impacto: z.enum(['alto', 'medio', 'bajo']),
      }),
    )
    .describe('De 3 a 5 consejos, del más al menos importante'),
});
export type Advice = z.infer<typeof AdviceSchema>;

/**
 * Indicadores del local y consejos generados con IA para decidir mejor:
 * qué horarios llenar, qué servicios impulsar, cómo bajar inasistencias
 * y a qué clientes recuperar.
 */
@Injectable()
export class InsightsService {
  private readonly logger = new Logger(InsightsService.name);

  constructor(
    @Inject(AI_CLIENT) private readonly client: Anthropic | null,
    private readonly prisma: PrismaService,
    private readonly usage: AiUsageService,
  ) {}

  /** Indicadores de los últimos 30 días. No usa IA: siempre está disponible. */
  async metrics(tenantId: number, now = new Date()) {
    const tenant = await this.prisma.tenant.findUniqueOrThrow({ where: { id: tenantId } });
    const tz = tenant.timezone;
    const from = new Date(now.getTime() - WINDOW_DAYS * 86_400_000);

    const [appointments, professionals, newCustomers, totalCustomers, waitlist, ai] = await Promise.all([
      this.prisma.appointment.findMany({
        where: { tenantId, startsAt: { gte: from, lte: now } },
        include: { service: true, professional: { select: { id: true, name: true } } },
      }),
      this.prisma.professional.findMany({ where: { tenantId, active: true }, include: { workingHours: true } }),
      this.prisma.customer.count({ where: { tenantId, createdAt: { gte: from } } }),
      this.prisma.customer.count({ where: { tenantId } }),
      this.prisma.waitlistEntry.findMany({ where: { tenantId, createdAt: { gte: from } }, include: { service: true } }),
      this.usage.assistantQuota(tenantId, now),
    ]);

    // Clientes cuya última visita fue hace más de 45 días y no tienen cita futura.
    const lastVisits = await this.prisma.appointment.groupBy({
      by: ['customerId'],
      where: { tenantId, status: 'COMPLETED' },
      _max: { startsAt: true },
    });
    const withFuture = new Set(
      (
        await this.prisma.appointment.findMany({
          where: { tenantId, status: { in: ['PENDING', 'CONFIRMED'] }, startsAt: { gt: now } },
          select: { customerId: true },
        })
      ).map((a) => a.customerId),
    );
    const inactiveCutoff = now.getTime() - INACTIVE_DAYS * 86_400_000;
    const inactive = lastVisits.filter(
      (v) => v._max.startsAt && v._max.startsAt.getTime() < inactiveCutoff && !withFuture.has(v.customerId),
    ).length;

    const count = (status: string) => appointments.filter((a) => a.status === status).length;
    const completed = appointments.filter((a) => a.status === 'COMPLETED');
    const cancelled = appointments.filter((a) => a.status === 'CANCELLED');
    const closed = count('COMPLETED') + count('NO_SHOW');
    const pct = (n: number, d: number) => (d ? Math.round((n / d) * 100) : 0);

    // Ocupación: minutos atendidos frente a los minutos de horario laboral del período.
    const days = Array.from(
      { length: WINDOW_DAYS },
      (_, i) => DateTime.fromJSDate(from, { zone: tz }).plus({ days: i + 1 }).weekday,
    );
    const availableByWeekday = new Map<number, number>();
    const availableByPro = new Map<number, number>();
    for (const p of professionals) {
      for (const weekday of days) {
        const minutes = p.workingHours
          .filter((w) => w.weekday === weekday)
          .reduce((s, w) => s + w.endMinute - w.startMinute, 0);
        availableByWeekday.set(weekday, (availableByWeekday.get(weekday) ?? 0) + minutes);
        availableByPro.set(p.id, (availableByPro.get(p.id) ?? 0) + minutes);
      }
    }
    const occupying = appointments.filter((a) => a.status !== 'CANCELLED');
    const minutesOf = (a: { startsAt: Date; endsAt: Date }) => (a.endsAt.getTime() - a.startsAt.getTime()) / 60_000;
    const weekdayOf = (d: Date) => DateTime.fromJSDate(d, { zone: tz }).weekday;
    const hourOf = (d: Date) => DateTime.fromJSDate(d, { zone: tz }).hour;

    const byService = new Map<string, { citas: number; ingresosCents: number }>();
    for (const a of occupying) {
      const row = byService.get(a.service.name) ?? { citas: 0, ingresosCents: 0 };
      row.citas++;
      if (a.status === 'COMPLETED') row.ingresosCents += a.service.priceCents ?? 0;
      byService.set(a.service.name, row);
    }

    return {
      periodo: { dias: WINDOW_DAYS, desde: from, hasta: now },
      citas: {
        total: appointments.length,
        atendidas: count('COMPLETED'),
        inasistencias: count('NO_SHOW'),
        canceladas: cancelled.length,
        canceladasPorCliente: cancelled.filter((a) => a.cancelReason === 'CUSTOMER').length,
        canceladasSinConfirmar: cancelled.filter((a) => a.cancelReason === 'NO_CONFIRMATION').length,
        canceladasPorLocal: cancelled.filter((a) => a.cancelReason === 'BUSINESS').length,
        porWhatsapp: appointments.filter((a) => a.source === 'WHATSAPP').length,
        registradasPorLocal: appointments.filter((a) => a.source === 'MANUAL').length,
        tasaInasistenciaPct: pct(count('NO_SHOW'), closed),
      },
      ingresosEstimadosCents: completed.reduce((s, a) => s + (a.service.priceCents ?? 0), 0),
      ocupacionPct: pct(
        occupying.reduce((s, a) => s + minutesOf(a), 0),
        [...availableByPro.values()].reduce((s, m) => s + m, 0),
      ),
      ocupacionPorDia: WEEKDAYS.map((dia, i) => ({
        dia,
        citas: occupying.filter((a) => weekdayOf(a.startsAt) === i + 1).length,
        ocupacionPct: pct(
          occupying.filter((a) => weekdayOf(a.startsAt) === i + 1).reduce((s, a) => s + minutesOf(a), 0),
          availableByWeekday.get(i + 1) ?? 0,
        ),
      })),
      citasPorFranja: {
        manana: occupying.filter((a) => hourOf(a.startsAt) < 12).length,
        mediodia: occupying.filter((a) => hourOf(a.startsAt) >= 12 && hourOf(a.startsAt) < 15).length,
        tarde: occupying.filter((a) => hourOf(a.startsAt) >= 15).length,
      },
      servicios: [...byService.entries()].map(([nombre, v]) => ({ nombre, ...v })).sort((a, b) => b.citas - a.citas),
      profesionales: professionals.map((p) => {
        const mine = occupying.filter((a) => a.professional.id === p.id);
        return {
          nombre: p.name,
          citas: mine.length,
          ocupacionPct: pct(
            mine.reduce((s, a) => s + minutesOf(a), 0),
            availableByPro.get(p.id) ?? 0,
          ),
        };
      }),
      clientes: { total: totalCustomers, nuevos: newCustomers, inactivos: inactive, diasParaInactivo: INACTIVE_DAYS },
      filaDeEspera: {
        solicitudes: waitlist.length,
        convertidas: waitlist.filter((w) => w.status === 'BOOKED').length,
        porDia: WEEKDAYS.map((dia, i) => ({
          dia,
          solicitudes: waitlist.filter((w) => (w.date.getUTCDay() || 7) === i + 1).length,
        })).filter((d) => d.solicitudes > 0),
      },
      asistente: { respuestasEsteMes: ai.used, cupoMensual: ai.limit },
      configuracion: { recordatorioHoras: tenant.reminderHoursBefore, invitarAVolverDias: tenant.winbackDays },
    };
  }

  async latest(tenantId: number) {
    const row = await this.prisma.insight.findFirst({ where: { tenantId }, orderBy: { createdAt: 'desc' } });
    return row ? { ...(row.payload as unknown as Advice), generadoEl: row.createdAt } : null;
  }

  get configured() {
    return this.client !== null;
  }

  /** Genera (o reutiliza, si es reciente) el análisis con consejos. */
  async advice(tenantId: number, now = new Date()) {
    const recent = await this.prisma.insight.findFirst({ where: { tenantId }, orderBy: { createdAt: 'desc' } });
    if (recent && now.getTime() - recent.createdAt.getTime() < ADVICE_TTL_MS) {
      return { ...(recent.payload as unknown as Advice), generadoEl: recent.createdAt };
    }
    if (!this.client)
      throw new ServiceUnavailableException('Los consejos con IA no están configurados en esta instalación');

    const tenant = await this.prisma.tenant.findUniqueOrThrow({ where: { id: tenantId } });
    const metrics = await this.metrics(tenantId, now);
    try {
      const response = await this.client.beta.messages.parse({
        model: AI_MODEL(),
        max_tokens: 8000,
        output_config: { effort: 'medium', format: betaZodOutputFormat(AdviceSchema) },
        // Si el modelo principal declina por política, la API reintenta en el de respaldo.
        betas: ['server-side-fallback-2026-07-01'],
        fallbacks: 'default',
        system: `Eres un asesor de negocios para peluquerías, barberías y centros de estética pequeños en Ecuador. Analizas los indicadores de un local y le dices a su dueño qué hacer para llenar su agenda, reducir inasistencias y ganar y retener clientes.

Escribe para el dueño de un local pequeño, no para un analista: lenguaje sencillo, directo y en español. Cada consejo debe apoyarse en un dato concreto de las métricas (cítalo con su número) y proponer una acción que pueda hacer esta semana.

Herramientas que el dueño ya tiene en este sistema y puedes recomendar ajustar: recordatorio de confirmación de asistencia (horas antes), fila de espera automática, invitación automática a volver para clientes inactivos (días sin visita), horarios por profesional, duración y precio de servicios, bloqueo de clientes que faltan, y un asistente de IA que responde por WhatsApp.

Sé honesto con los límites de los datos: si hay muy pocas citas en el período, dilo en el resumen y da consejos para empezar a captar clientes en lugar de sacar conclusiones de porcentajes poco fiables. No inventes cifras que no estén en las métricas. Los montos están en centavos de dólar: exprésalos en dólares.`,
        messages: [
          {
            role: 'user',
            content: `Local: ${tenant.name}\n\nIndicadores de los últimos ${WINDOW_DAYS} días (JSON):\n${JSON.stringify(metrics, null, 1)}`,
          },
        ],
      });
      await this.usage.record(tenantId, 'INSIGHTS', response.usage.input_tokens, response.usage.output_tokens, now);
      if (response.stop_reason === 'refusal' || !response.parsed_output) {
        throw new ServiceUnavailableException('No se pudo generar el análisis en este momento');
      }
      const payload = response.parsed_output;
      const row = await this.prisma.insight.create({
        data: { tenantId, payload: payload as unknown as Prisma.InputJsonValue },
      });
      return { ...payload, generadoEl: row.createdAt };
    } catch (e) {
      if (e instanceof ServiceUnavailableException) throw e;
      if (e instanceof Anthropic.APIError) this.logger.error(`IA (consejos): error ${e.status} ${e.message}`);
      else this.logger.error('IA (consejos): error inesperado', e as Error);
      throw new ServiceUnavailableException('No se pudo generar el análisis en este momento. Intenta más tarde.');
    }
  }
}
