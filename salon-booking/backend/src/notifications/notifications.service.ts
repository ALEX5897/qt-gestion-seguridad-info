import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

export type NotificationType =
  | 'BOOKED'
  | 'CANCELLED'
  | 'RESCHEDULED'
  | 'CONFIRMED'
  | 'NO_CONFIRMATION'
  | 'HUMAN_REQUEST'
  | 'WAITLIST_BOOKED'
  | 'MESSAGE';

/** Avisos que el dueño ve en su panel (campana). */
@Injectable()
export class NotificationsService {
  constructor(private readonly prisma: PrismaService) {}

  notify(tenantId: number, type: NotificationType, title: string, body: string) {
    return this.prisma.notification.create({ data: { tenantId, type, title, body } });
  }

  async list(tenantId: number) {
    const [items, unread] = await Promise.all([
      this.prisma.notification.findMany({ where: { tenantId }, orderBy: { createdAt: 'desc' }, take: 50 }),
      this.prisma.notification.count({ where: { tenantId, readAt: null } }),
    ]);
    return { items, unread };
  }

  markAllRead(tenantId: number) {
    return this.prisma.notification.updateMany({ where: { tenantId, readAt: null }, data: { readAt: new Date() } });
  }
}
