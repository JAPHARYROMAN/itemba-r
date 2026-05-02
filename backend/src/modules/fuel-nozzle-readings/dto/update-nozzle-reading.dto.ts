import { IsEnum, IsNumber, IsOptional, IsString, Min } from 'class-validator';
import { FuelNozzleReadingStatus } from '@prisma/client';

export class UpdateNozzleReadingDto {
  @IsOptional()
  @IsNumber()
  @Min(0)
  closingMeter?: number;

  @IsOptional()
  @IsString()
  attendantId?: string;

  @IsOptional()
  @IsString()
  notes?: string;

  @IsOptional()
  @IsEnum(FuelNozzleReadingStatus)
  status?: FuelNozzleReadingStatus;
}
