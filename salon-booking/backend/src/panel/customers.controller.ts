import {
  Body,
  Controller,
  Get,
  HttpCode,
  NotFoundException,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { Roles, TenantId } from '../auth/auth.decorators';
import { PrismaService } from '../prisma/prisma.service';
import { MessagingService } from '../whatsapp/messaging.service';
import { CustomerDto, SendMessageDto } from './panel.dto';

/** Clientes del local y sus conversaciones de WhatsApp. */
@Roles('OWNER', 'STAFF')
@Controller()
export class CustomersController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly messaging: MessagingService,
  ) {}

  @Get('customers')
  list(@TenantId() tenantId: number, @Query('q') q?: string) {
    return this.prisma.customer.findMany({
      where: {
        tenantId,
        ...(q ? { OR: [{ name: { contains: q } }, { phone: { contains: q.replace(/\D/g, '') || q } }] } : {}),
      },
      include: { _count: { select: { appointments: true } } },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });
  }

  @Get('customers/:id')
  async detail(@TenantId() tenantId: number, @Param('id', ParseIntPipe) id: number) {
    const customer = await this.prisma.customer.findFirst({
      where: { id, tenantId },
      include: {
        appointments: {
          include: { service: true, professional: { select: { name: true } } },
          orderBy: { startsAt: 'desc' },
          take: 30,
        },
      },
    });
    if (!customer) throw new NotFoundException('Cliente no encontrado');
    return customer;
  }

  @Patch('customers/:id')
  async update(@TenantId() tenantId: number, @Param('id', ParseIntPipe) id: number, @Body() dto: CustomerDto) {
    await this.find(tenantId, id);
    return this.prisma.customer.update({ where: { id }, data: dto });
  }

  // ───────────── Chats ─────────────

  /** Conversaciones recientes; primero las que esperan respuesta de una persona. */
  @Get('conversations')
  conversations(@TenantId() tenantId: number) {
    return this.prisma.conversation.findMany({
      where: { tenantId },
      include: { customer: { select: { id: true, name: true, phone: true } } },
      orderBy: [{ humanTakeover: 'desc' }, { lastMessageAt: 'desc' }],
      take: 60,
    });
  }

  @Get('conversations/:customerId/messages')
  async messages(@TenantId() tenantId: number, @Param('customerId', ParseIntPipe) customerId: number) {
    const customer = await this.find(tenantId, customerId);
    const rows = await this.prisma.messageLog.findMany({
      where: { tenantId, customerPhone: customer.phone },
      orderBy: { id: 'desc' },
      take: 100,
    });
    // Cuando el cliente pulsa un botón llega su id interno; se muestra el texto que vio.
    const labels = new Map<string, string>();
    return rows.reverse().map((m) => {
      const base = { id: m.id, direction: m.direction, at: m.createdAt };
      if (m.direction === 'OUT') {
        const out = renderOutbound(m.body);
        for (const o of out.choices) labels.set(o.id, o.title);
        return { ...base, text: out.text, options: out.choices.map((o) => o.title), pressed: false };
      }
      const pressed = m.type === 'interactive';
      return { ...base, text: pressed ? (labels.get(m.body) ?? 'Opción seleccionada') : m.body, options: [], pressed };
    });
  }

  /** El local responde en persona; el bot queda en pausa para ese cliente. */
  @Post('conversations/:customerId/messages')
  async send(
    @TenantId() tenantId: number,
    @Param('customerId', ParseIntPipe) customerId: number,
    @Body() dto: SendMessageDto,
  ) {
    const customer = await this.find(tenantId, customerId);
    const tenant = await this.prisma.tenant.findUniqueOrThrow({ where: { id: tenantId } });
    await this.setTakeover(tenantId, customerId, true);
    const ok = await this.messaging.send(tenant, customer.phone, [{ type: 'text', text: dto.text }]);
    return { ok };
  }

  @Post('conversations/:customerId/takeover')
  @HttpCode(200)
  async takeover(@TenantId() tenantId: number, @Param('customerId', ParseIntPipe) customerId: number) {
    await this.find(tenantId, customerId);
    await this.setTakeover(tenantId, customerId, true);
    return { ok: true };
  }

  /** Devuelve la conversación al bot. */
  @Post('conversations/:customerId/release')
  @HttpCode(200)
  async release(@TenantId() tenantId: number, @Param('customerId', ParseIntPipe) customerId: number) {
    await this.find(tenantId, customerId);
    await this.setTakeover(tenantId, customerId, false);
    return { ok: true };
  }

  private setTakeover(tenantId: number, customerId: number, humanTakeover: boolean) {
    return this.prisma.conversation.upsert({
      where: { customerId },
      create: { tenantId, customerId, humanTakeover, state: humanTakeover ? 'HUMAN' : 'IDLE' },
      update: { humanTakeover, state: humanTakeover ? 'HUMAN' : 'IDLE', context: {} },
    });
  }

  private async find(tenantId: number, id: number) {
    const customer = await this.prisma.customer.findFirst({ where: { id, tenantId } });
    if (!customer) throw new NotFoundException('Cliente no encontrado');
    return customer;
  }
}

/** Convierte un mensaje saliente guardado en MessageLog en texto y opciones legibles. */
function renderOutbound(body: string): { text: string; choices: { id: string; title: string }[] } {
  try {
    const m = JSON.parse(body);
    if (m.type === 'template') {
      return { text: `[Plantilla ${m.name}] ${(m.bodyParams ?? []).join(' · ')}`, choices: [] };
    }
    return { text: m.text ?? '', choices: m.buttons ?? m.rows ?? [] };
  } catch {
    return { text: body, choices: [] };
  }
}
