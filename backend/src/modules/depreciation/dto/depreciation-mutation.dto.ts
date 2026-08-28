import { DepreciationMethod, DepreciationScheduleStatus } from '@prisma/client';
import {
  IsDateString,
  IsEnum,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
} from 'class-validator';

export class CreateDepreciationScheduleDto {
  @IsString()
  scheduleNumber!: string;

  @IsUUID()
  companyId!: string;

  @IsUUID()
  fixedAssetId!: string;

  @IsEnum(DepreciationMethod)
  depreciationMethod!: DepreciationMethod;

  @IsDateString()
  startDate!: string;

  @IsOptional()
  @IsDateString()
  endDate?: string;

  @IsOptional()
  @IsInt()
  usefulLifeMonths?: number;

  @IsOptional()
  @IsNumber()
  salvageValue?: number;

  @IsOptional()
  @IsNumber()
  depreciationRate?: number;

  @IsNumber()
  totalDepreciableAmount!: number;

  @IsOptional()
  @IsNumber()
  accumulatedDepreciation?: number;

  @IsOptional()
  @IsEnum(DepreciationScheduleStatus)
  status?: DepreciationScheduleStatus;
}

export class CreateDepreciationEntryDto {
  @IsUUID()
  companyId!: string;

  @IsUUID()
  fixedAssetId!: string;

  @IsDateString()
  depreciationDate!: string;

  @IsNumber()
  amount!: number;

  @IsNumber()
  accumulatedDepreciationAfter!: number;
}
