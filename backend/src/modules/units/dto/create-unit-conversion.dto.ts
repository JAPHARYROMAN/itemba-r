import {
  IsBoolean,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  IsPositive,
} from 'class-validator';

export class CreateUnitConversionDto {
  @IsOptional()
  @IsString()
  companyId?: string;

  @IsNotEmpty()
  @IsString()
  fromUnitId!: string;

  @IsNotEmpty()
  @IsString()
  toUnitId!: string;

  @IsNotEmpty()
  @IsNumber()
  @IsPositive()
  conversionFactor!: number;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}
