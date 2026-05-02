import { IsString, IsOptional, IsEnum, IsNumber, IsDateString } from 'class-validator';
import { Type } from 'class-transformer';
import { ParkingSessionStatus, ParkingPaymentStatus } from '@prisma/client';

export class CreateParkingSessionDto {
  @IsString() sessionNumber!: string;
  @IsString() companyId!: string;
  @IsString() facilityId!: string;
  @IsString() truckNumber!: string;
  @IsString() currency!: string;
  @IsString() createdById!: string;
  @IsString() @IsOptional() zoneId?: string;
  @IsString() @IsOptional() customerId?: string;
  @IsString() @IsOptional() trailerNumber?: string;
  @IsString() @IsOptional() driverName?: string;
  @IsString() @IsOptional() driverPhone?: string;
  @IsString() @IsOptional() companyName?: string;
  @IsDateString() @IsOptional() entryTime?: string;
  @IsString() @IsOptional() rateId?: string;
  @IsNumber() @Type(() => Number) @IsOptional() discountAmount?: number;
  @IsEnum(ParkingSessionStatus) @IsOptional() status?: ParkingSessionStatus;
  @IsEnum(ParkingPaymentStatus) @IsOptional() paymentStatus?: ParkingPaymentStatus;
  @IsString() @IsOptional() notes?: string;
}
