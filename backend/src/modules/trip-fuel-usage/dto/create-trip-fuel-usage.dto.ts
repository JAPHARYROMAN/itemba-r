import { IsString, IsOptional, IsEnum, IsNumber, IsDateString } from 'class-validator';
import { FuelSource } from '@prisma/client';

export class CreateTripFuelUsageDto {
  @IsString() tripId!: string;
  @IsString() companyId!: string;
  @IsString() divisionId!: string;
  @IsString() vehicleId!: string;
  @IsEnum(FuelSource) @IsOptional() fuelSource?: FuelSource;
  @IsNumber() litres!: number;
  @IsNumber() @IsOptional() unitPrice?: number;
  @IsNumber() @IsOptional() totalCost?: number;
  @IsNumber() @IsOptional() odometerBefore?: number;
  @IsNumber() @IsOptional() odometerAfter?: number;
  @IsDateString() fuelDate!: string;
  @IsString() @IsOptional() supplierId?: string;
  @IsString() @IsOptional() notes?: string;
}
