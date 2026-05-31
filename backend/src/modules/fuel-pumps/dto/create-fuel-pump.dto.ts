import { IsDateString, IsEnum, IsNotEmpty, IsOptional, IsString } from 'class-validator';
import { FuelPumpStatus } from '@prisma/client';

export class CreateFuelPumpDto {
  @IsNotEmpty()
  @IsString()
  pumpCode!: string;

  @IsNotEmpty()
  @IsString()
  companyId!: string;

  @IsOptional()
  @IsString()
  divisionId?: string;

  @IsNotEmpty()
  @IsString()
  branchId!: string;

  @IsNotEmpty()
  @IsString()
  tankId!: string;

  @IsNotEmpty()
  @IsString()
  pumpName!: string;

  @IsOptional()
  @IsEnum(FuelPumpStatus)
  status?: FuelPumpStatus;

  @IsOptional()
  @IsDateString()
  installationDate?: string;

  @IsOptional()
  @IsString()
  notes?: string;
}
