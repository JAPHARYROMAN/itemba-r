import {
  IsEnum,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  Min,
} from 'class-validator';
import { FuelShiftCollectionType } from '@prisma/client';

export class CreateFuelShiftCollectionDto {
  @IsNotEmpty()
  @IsString()
  fuelShiftId!: string;

  @IsNotEmpty()
  @IsString()
  companyId!: string;

  @IsNotEmpty()
  @IsString()
  branchId!: string;

  @IsNotEmpty()
  @IsEnum(FuelShiftCollectionType)
  collectionType!: FuelShiftCollectionType;

  @IsNotEmpty()
  @IsNumber()
  @Min(0.01)
  amount!: number;

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
