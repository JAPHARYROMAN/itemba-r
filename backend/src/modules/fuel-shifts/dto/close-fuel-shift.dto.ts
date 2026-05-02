import {
  IsArray,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  Min,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';

export class NozzleReadingCloseItemDto {
  @IsNotEmpty()
  @IsString()
  nozzleReadingId!: string;

  @IsNotEmpty()
  @IsNumber()
  @Min(0)
  closingMeter!: number;
}

export class CloseFuelShiftDto {
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => NozzleReadingCloseItemDto)
  nozzleReadings!: NozzleReadingCloseItemDto[];

  @IsOptional()
  @IsString()
  notes?: string;
}
