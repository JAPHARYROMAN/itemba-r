import {
  IsDateString,
  IsEnum,
  IsNotEmpty,
  IsOptional,
  IsString,
} from 'class-validator';
import { FuelShiftType } from '@prisma/client';

export class UpdateFuelShiftDto {
  @IsOptional()
  @IsEnum(FuelShiftType)
  shiftType?: FuelShiftType;

  @IsOptional()
  @IsDateString()
  shiftDate?: string;

  @IsOptional()
  @IsDateString()
  startTime?: string;

  @IsOptional()
  @IsString()
  notes?: string;
}

export class RejectFuelShiftDto {
  @IsNotEmpty()
  @IsString()
  reason!: string;
}
