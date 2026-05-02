import { IsString, IsOptional, IsEnum, IsNumber, IsDateString } from 'class-validator';
import { MaintenanceType, MaintenanceStatus } from '@prisma/client';

export class CreateVehicleMaintenanceDto {
  @IsString() companyId!: string;
  @IsString() divisionId!: string;
  @IsString() vehicleId!: string;
  @IsEnum(MaintenanceType) maintenanceType!: MaintenanceType;
  @IsDateString() maintenanceDate!: string;
  @IsNumber() @IsOptional() odometerReading?: number;
  @IsString() @IsOptional() supplierId?: string;
  @IsString() description!: string;
  @IsNumber() @IsOptional() costAmount?: number;
  @IsString() currency!: string;
  @IsEnum(MaintenanceStatus) @IsOptional() status?: MaintenanceStatus;
  @IsString() @IsOptional() expenseId?: string;
  @IsDateString() @IsOptional() nextServiceDate?: string;
  @IsNumber() @IsOptional() nextServiceOdometer?: number;
  @IsString() @IsOptional() notes?: string;
}
