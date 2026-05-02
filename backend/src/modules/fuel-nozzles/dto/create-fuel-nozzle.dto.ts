import {
  IsEnum,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  Min,
} from 'class-validator';
import { Type } from 'class-transformer';
import { FuelNozzleStatus } from '@prisma/client';

export class CreateFuelNozzleDto {
  @IsNotEmpty()
  @IsString()
  nozzleCode!: string;

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
  pumpId!: string;

  @IsNotEmpty()
  @IsString()
  tankId!: string;

  @IsNotEmpty()
  @IsString()
  productId!: string;

  @IsOptional()
  @IsString()
  nozzleName?: string;

  @IsOptional()
  @IsNumber()
  @Min(0)
  @Type(() => Number)
  currentMeterReading?: number;

  @IsOptional()
  @IsEnum(FuelNozzleStatus)
  status?: FuelNozzleStatus;

  @IsOptional()
  @IsString()
  notes?: string;
}
