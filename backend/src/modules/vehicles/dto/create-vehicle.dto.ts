import { IsString, IsOptional, IsEnum, IsNumber, IsDateString } from 'class-validator';
import { VehicleType, VehicleFuelType, VehicleStatus } from '@prisma/client';

export class CreateVehicleDto {
  @IsString() vehicleCode!: string;
  @IsString() companyId!: string;
  @IsString() divisionId!: string;
  @IsString() @IsOptional() fixedAssetId?: string;
  @IsString() registrationNumber!: string;
  @IsEnum(VehicleType) vehicleType!: VehicleType;
  @IsString() @IsOptional() make?: string;
  @IsString() @IsOptional() model?: string;
  @IsNumber() @IsOptional() year?: number;
  @IsString() @IsOptional() capacityDescription?: string;
  @IsEnum(VehicleFuelType) @IsOptional() fuelType?: VehicleFuelType;
  @IsEnum(VehicleStatus) @IsOptional() status?: VehicleStatus;
  @IsNumber() @IsOptional() currentOdometer?: number;
  @IsDateString() @IsOptional() insuranceExpiryDate?: string;
  @IsDateString() @IsOptional() roadLicenseExpiryDate?: string;
  @IsDateString() @IsOptional() inspectionExpiryDate?: string;
  @IsString() @IsOptional() assignedDriverId?: string;
  @IsString() @IsOptional() notes?: string;
}
