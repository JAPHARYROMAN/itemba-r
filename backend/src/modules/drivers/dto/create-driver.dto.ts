import { IsString, IsOptional, IsEnum, IsDateString } from 'class-validator';
import { DriverStatus } from '@prisma/client';

export class CreateDriverDto {
  @IsString() driverCode!: string;
  @IsString() companyId!: string;
  @IsString() divisionId!: string;
  @IsString() @IsOptional() userId?: string;
  @IsString() @IsOptional() employeeId?: string;
  @IsString() fullName!: string;
  @IsString() @IsOptional() phone?: string;
  @IsString() @IsOptional() licenseNumber?: string;
  @IsString() @IsOptional() licenseClass?: string;
  @IsDateString() @IsOptional() licenseExpiryDate?: string;
  @IsEnum(DriverStatus) @IsOptional() status?: DriverStatus;
  @IsString() @IsOptional() assignedVehicleId?: string;
  @IsString() @IsOptional() emergencyContact?: string;
  @IsString() @IsOptional() notes?: string;
}
