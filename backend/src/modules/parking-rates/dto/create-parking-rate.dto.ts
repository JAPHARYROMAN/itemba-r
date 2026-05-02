import { IsString, IsOptional, IsEnum, IsNumber, IsDateString } from 'class-validator';
import { Type } from 'class-transformer';
import { ParkingRateType, ParkingRateStatus } from '@prisma/client';

export class CreateParkingRateDto {
  @IsString() rateCode!: string;
  @IsString() companyId!: string;
  @IsString() facilityId!: string;
  @IsString() rateName!: string;
  @IsEnum(ParkingRateType) rateType!: ParkingRateType;
  @IsNumber() @Type(() => Number) amount!: number;
  @IsString() currency!: string;
  @IsDateString() effectiveFrom!: string;
  @IsEnum(ParkingRateStatus) @IsOptional() status?: ParkingRateStatus;
  @IsString() @IsOptional() zoneId?: string;
  @IsDateString() @IsOptional() effectiveTo?: string;
  @IsString() createdById!: string;
  @IsString() @IsOptional() approvedById?: string;
  @IsString() @IsOptional() notes?: string;
}
