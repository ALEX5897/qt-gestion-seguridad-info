import { Controller, Get, HttpCode, Post } from '@nestjs/common';
import { Roles, TenantId } from '../auth/auth.decorators';
import { NotificationsService } from './notifications.service';

@Roles('OWNER', 'STAFF')
@Controller('notifications')
export class NotificationsController {
  constructor(private readonly notifications: NotificationsService) {}

  @Get()
  list(@TenantId() tenantId: number) {
    return this.notifications.list(tenantId);
  }

  @Post('read-all')
  @HttpCode(200)
  async readAll(@TenantId() tenantId: number) {
    await this.notifications.markAllRead(tenantId);
    return { ok: true };
  }
}
