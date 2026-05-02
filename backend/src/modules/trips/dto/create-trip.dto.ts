import { IsString, IsOptional, IsEnum, IsNumber, IsDateString } from 'class-validator';
import { TripStatus } from '@prisma/client';

export class CreateTripDto {
  @IsString() companyId!: string;
  @IsString() divisionId!: string;
  @IsString() @IsOptional() branchId?: string;
  @IsString() @IsOptional() customerId?: string;
  @IsString() @IsOptional() customerName?: string;
  @IsString() vehicleId!: string;
  @IsString() driverId!: string;
  @IsString() @IsOptional() routeId?: string;
  @IsString() origin!: string;
  @IsString() destination!: string;
  @IsString() @IsOptional() cargoDescription?: string;
  @IsNumber() @IsOptional() cargoWeight?: number;
  @IsString() @IsOptional() cargoUnitId?: string;
  @IsDateString() tripDate!: string;
  @IsDateString() @IsOptional() expectedReturnDate?: string;
  @IsNumber() @IsOptional() revenueAmount?: number;
  @IsString() currency!: string;
  @IsString() @IsOptional() notes?: string;
}
