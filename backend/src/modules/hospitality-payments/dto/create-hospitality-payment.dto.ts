import { IsString, IsOptional, IsEnum, IsNumber, IsDateString } from 'class-validator';
import { Type } from 'class-transformer';
import { HospitalityPaymentMethod, HospitalityPaymentContextType } from '@prisma/client';

export class CreateHospitalityPaymentDto {
  @IsString() paymentNumber!: string;
  @IsString() companyId!: string;
  @IsDateString() paymentDate!: string;
  @IsNumber() @Type(() => Number) amount!: number;
  @IsString() currency!: string;
  @IsEnum(HospitalityPaymentMethod) paymentMethod!: HospitalityPaymentMethod;
  @IsString() receivedById!: string;
  @IsEnum(HospitalityPaymentContextType) @IsOptional() paymentContextType?: HospitalityPaymentContextType;
  @IsString() @IsOptional() paymentContextId?: string;
  @IsString() @IsOptional() roomBookingId?: string;
  @IsString() @IsOptional() restaurantOrderId?: string;
  @IsString() @IsOptional() cashAccountId?: string;
  @IsString() @IsOptional() reference?: string;
  @IsString() @IsOptional() guestId?: string;
  @IsString() @IsOptional() notes?: string;
  @IsString() @IsOptional() idempotencyKey?: string;
}
