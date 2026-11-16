import { Module } from '@nestjs/common';
import { AutomationService } from './automation.service';
import { BookingService } from './booking.service';
import { SchedulingController } from './scheduling.controller';
import { SchedulingService } from './scheduling.service';
import { WaitlistService } from './waitlist.service';

@Module({
  controllers: [SchedulingController],
  providers: [SchedulingService, BookingService, WaitlistService, AutomationService],
  exports: [SchedulingService, BookingService, WaitlistService, AutomationService],
})
export class SchedulingModule {}
