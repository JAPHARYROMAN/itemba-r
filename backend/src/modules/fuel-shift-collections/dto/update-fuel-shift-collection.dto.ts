import { IsEnum, IsNumber, IsOptional, IsString, Min } from 'class-validator';
import { FuelShiftCollectionType } from '@prisma/client';

export class UpdateFuelShiftCollectionDto {
  @IsOptional()
  @IsEnum(FuelShiftCollectionType)
  collectionType?: FuelShiftCollectionType;

  @IsOptional()
  @IsNumber()
  @Min(0.01)
  amount?: number;

  @IsOptional()
  @IsString()
  reference?: string;

  @IsOptional()
  @IsString()
  collectedById?: string;

  @IsOptional()
  @IsString()
  cashAccountId?: string;

  @IsOptional()
  @IsString()
  notes?: string;
}
