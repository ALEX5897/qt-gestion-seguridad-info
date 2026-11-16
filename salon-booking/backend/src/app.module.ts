import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ScheduleModule } from '@nestjs/schedule';
import { AiModule } from './ai/ai.module';
import { AuthModule } from './auth/auth.module';
import { NotificationsModule } from './notifications/notifications.module';
import { PanelModule } from './panel/panel.module';
import { PrismaModule } from './prisma/prisma.module';
import { SchedulingModule } from './scheduling/scheduling.module';
import { TenantsModule } from './tenants/tenants.module';
import { MessagingModule } from './whatsapp/messaging.module';
import { WhatsappModule } from './whatsapp/whatsapp.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    ScheduleModule.forRoot(),
    PrismaModule,
    AuthModule,
    MessagingModule,
    NotificationsModule,
    TenantsModule,
    SchedulingModule,
    AiModule,
    PanelModule,
    WhatsappModule,
  ],
})
export class AppModule {}
