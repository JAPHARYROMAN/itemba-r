import {
  IsArray,
  IsEnum,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  Min,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { FuelShiftCollectionType } from '@prisma/client';

export class NozzleReadingCloseItemDto {
  @IsNotEmpty()
  @IsString()
  nozzleReadingId!: string;

  @IsNotEmpty()
  @IsNumber()
  @Min(0)
  closingMeter!: number;
}

export class FuelShiftCloseCollectionDto {
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
  cashAccountId?: string;

  @IsOptional()
  @IsString()
  notes?: string;
}

export class CloseFuelShiftDto {
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => NozzleReadingCloseItemDto)
  nozzleReadings!: NozzleReadingCloseItemDto[];

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => FuelShiftCloseCollectionDto)
  collections?: FuelShiftCloseCollectionDto[];

  @IsOptional()
  @IsString()
  notes?: string;
}
