import {
  IsBoolean,
  IsEnum,
  IsNotEmpty,
  IsOptional,
  IsString,
} from 'class-validator';
import { UnitType, UnitStatus } from '@prisma/client';

export class CreateUnitDto {
  @IsOptional()
  @IsString()
  companyId?: string;

  @IsNotEmpty()
  @IsString()
  name!: string;

  @IsNotEmpty()
  @IsString()
  symbol!: string;

  @IsNotEmpty()
  @IsEnum(UnitType)
  unitType!: UnitType;

  @IsOptional()
  @IsBoolean()
  isBaseUnit?: boolean;

  @IsOptional()
  @IsEnum(UnitStatus)
  status?: UnitStatus;
}
