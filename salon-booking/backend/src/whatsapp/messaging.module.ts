import { Global, Module } from '@nestjs/common';
import { MessagingService } from './messaging.service';
import { ConsoleProvider } from './providers/console.provider';
import { MetaCloudProvider } from './providers/meta-cloud.provider';
import { WHATSAPP_PROVIDER } from './whatsapp.types';

@Global()
@Module({
  providers: [
    MessagingService,
    {
      provide: WHATSAPP_PROVIDER,
      useFactory: () => (process.env.WHATSAPP_PROVIDER === 'meta' ? new MetaCloudProvider() : new ConsoleProvider()),
    },
  ],
  exports: [MessagingService, WHATSAPP_PROVIDER],
})
export class MessagingModule {}
