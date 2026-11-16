import { TenantStatus } from '@prisma/client';
import { IsEmail, IsIn, IsInt, IsOptional, IsString, Matches, Min, MinLength } from 'class-validator';

export class CreateTenantDto {
  @IsString() name: string;
  @Matches(/^[a-z0-9-]+$/, { message: 'slug: solo minúsculas, números y guiones' }) slug: string;
  /** Número del local en formato internacional sin "+", ej. 593991234567 (Ecuador) */
  @Matches(/^[1-9]\d{7,14}$/, { message: 'whatsappNumber: formato internacional sin + (ej. 593991234567)' })
  whatsappNumber: string;
  @IsOptional() @IsString() waPhoneNumberId?: string;
  @IsOptional() @IsString() address?: string;
  @IsOptional() @IsInt() @Min(0) trialDays?: number;

  @IsString() ownerName: string;
  @IsEmail() ownerEmail: string;
  @MinLength(8) ownerPassword: string;
}

export class SetStatusDto {
  @IsIn(Object.values(TenantStatus)) status: TenantStatus;
}

export class RegisterPaymentDto {
  @IsString() planCode: string;
  @IsInt() @Min(1) months: number;
  @IsInt() @Min(0) amountCents: number;
  @IsString() method: string;
  @IsOptional() @IsString() reference?: string;
}
