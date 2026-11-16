import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsEmail,
  IsArray,
  IsBoolean,
  IsDateString,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';

export class SettingsDto {
  @IsOptional() @IsString() @MinLength(2) @MaxLength(80) name?: string;
  @IsOptional() @IsString() @MaxLength(200) address?: string;
  @IsOptional() @IsIn([5, 10, 15, 20, 30, 60]) slotStepMinutes?: number;
  @IsOptional() @IsInt() @Min(0) @Max(2880) minAdvanceMinutes?: number;
  @IsOptional() @IsInt() @Min(1) @Max(90) maxAdvanceDays?: number;
  @IsOptional() @IsInt() @Min(1) @Max(72) reminderHoursBefore?: number;
  @IsOptional() @IsInt() @Min(15) @Max(2880) confirmationTimeoutMinutes?: number;
  @IsOptional() @IsInt() @Min(5) @Max(240) waitlistOfferMinutes?: number;
  @IsOptional() @IsBoolean() aiEnabled?: boolean;
  @IsOptional() @IsString() @MaxLength(3000) assistantInfo?: string;
  /** 0 apaga la invitación; el mínimo real es 21 días para no molestar. */
  @IsOptional() @IsIn([0, 21, 30, 45, 60, 90]) winbackDays?: number;
}

export class ServiceDto {
  @IsString() @MinLength(2) @MaxLength(60) name: string;
  @IsInt() @Min(5) @Max(600) durationMinutes: number;
  @IsOptional() @IsInt() @Min(0) @Max(120) bufferMinutes?: number;
  @IsOptional() @IsInt() @Min(0) priceCents?: number | null;
  @IsOptional() @IsBoolean() active?: boolean;
}

export class WorkingHoursDto {
  @IsInt() @Min(1) @Max(7) weekday: number;
  @IsInt() @Min(0) @Max(1439) startMinute: number;
  @IsInt() @Min(1) @Max(1440) endMinute: number;
}

export class ProfessionalServiceDto {
  @IsInt() serviceId: number;
  @IsOptional() @IsInt() @Min(5) @Max(600) durationMinutes?: number | null;
}

export class ProfessionalDto {
  @IsString() @MinLength(2) @MaxLength(60) name: string;
  @IsOptional() @IsString() @MaxLength(20) phone?: string;
  @IsOptional() @Matches(/^#[0-9a-fA-F]{6}$/) color?: string;
  @IsOptional() @IsBoolean() active?: boolean;
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(28)
  @ValidateNested({ each: true })
  @Type(() => WorkingHoursDto)
  workingHours?: WorkingHoursDto[];
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ProfessionalServiceDto)
  services?: ProfessionalServiceDto[];
}

export class TimeOffDto {
  @IsOptional() @IsInt() professionalId?: number | null;
  @IsDateString() startsAt: string;
  @IsDateString() endsAt: string;
  @IsOptional() @IsString() @MaxLength(120) reason?: string;
}

export class CreateAppointmentDto {
  @IsString() customerPhone: string;
  @IsOptional() @IsString() @MaxLength(80) customerName?: string;
  @IsInt() serviceId: number;
  @IsInt() professionalId: number;
  @IsDateString() startsAt: string;
  @IsOptional() @IsString() @MaxLength(500) notes?: string;
}

export class AppointmentStatusDto {
  @IsIn(['CONFIRMED', 'COMPLETED', 'NO_SHOW', 'CANCELLED']) status: 'CONFIRMED' | 'COMPLETED' | 'NO_SHOW' | 'CANCELLED';
}

export class RescheduleDto {
  @IsInt() professionalId: number;
  @IsDateString() startsAt: string;
}

export class CustomerDto {
  @IsOptional() @IsString() @MaxLength(80) name?: string;
  @IsOptional() @IsString() @MaxLength(2000) notes?: string;
  @IsOptional() @IsBoolean() blocked?: boolean;
}

export class SendMessageDto {
  @IsString() @MinLength(1) @MaxLength(1000) text: string;
}

export class CreateStaffDto {
  @IsString() @MinLength(2) @MaxLength(80) name: string;
  @IsEmail() email: string;
  @IsString() @MinLength(8) @MaxLength(72) password: string;
}

export class UpdateStaffDto {
  @IsBoolean() active: boolean;
}
