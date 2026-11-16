import { Global, Module } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { MessagingService } from './messaging.service';
import { BaileysManager } from './providers/baileys.manager';
import { BaileysProvider } from './providers/baileys.provider';
import { ConsoleProvider } from './providers/console.provider';
import { MetaCloudProvider } from './providers/meta-cloud.provider';
import { WHATSAPP_PROVIDER } from './whatsapp.types';

/**
 * Proveedor de WhatsApp según WHATSAPP_PROVIDER:
 *   console = simulador local · meta = API oficial · baileys = sesión no oficial (solo pruebas)
 */
@Global()
@Module({
  providers: [
    MessagingService,
    BaileysManager,
    {
      provide: WHATSAPP_PROVIDER,
      inject: [BaileysManager, PrismaService],
      useFactory: (manager: BaileysManager, prisma: PrismaService) => {
        switch (process.env.WHATSAPP_PROVIDER) {
          case 'meta':
            return new MetaCloudProvider();
          case 'baileys':
            return new BaileysProvider(manager, prisma);
          default:
            return new ConsoleProvider();
        }
      },
    },
  ],
  exports: [MessagingService, WHATSAPP_PROVIDER, BaileysManager],
})
export class MessagingModule {}
