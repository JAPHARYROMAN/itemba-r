import { IsString, IsOptional, IsEnum, IsNumber, IsDateString } from 'class-validator';
import { Type } from 'class-transformer';
import { ParkingPaymentMethod } from '@prisma/client';

export class CreateParkingPaymentDto {
  @IsString() paymentNumber!: string;
  @IsString() companyId!: string;
  @IsString() parkingSessionId!: string;
  @IsDateString() paymentDate!: string;
  @IsNumber() @Type(() => Number) amount!: number;
  @IsString() currency!: string;
  @IsEnum(ParkingPaymentMethod) paymentMethod!: ParkingPaymentMethod;
  @IsString() receivedById!: string;
  @IsString() @IsOptional() cashAccountId?: string;
  @IsString() @IsOptional() reference?: string;
  @IsString() @IsOptional() notes?: string;
  @IsString() @IsOptional() idempotencyKey?: string;
}
