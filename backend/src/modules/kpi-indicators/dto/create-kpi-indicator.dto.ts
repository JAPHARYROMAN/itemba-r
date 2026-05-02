import { IsString, IsOptional, IsEnum, IsObject, IsBoolean } from 'class-validator';
import { KPICategory, KPICalculationType } from '@prisma/client';

export class CreateKpiIndicatorDto {
  @IsString()
  kpiCode!: string;

  @IsString()
  name!: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsEnum(KPICategory)
  kpiCategory!: KPICategory;

  @IsEnum(KPICalculationType)
  calculationType!: KPICalculationType;

  @IsOptional()
  @IsString()
  sourceEntity?: string;

  @IsOptional()
  @IsString()
  sourceField?: string;

  @IsOptional()
  @IsObject()
  formula?: Record<string, any>;

  @IsOptional()
  @IsString()
  unit?: string;

  @IsOptional()
  @IsString()
  currency?: string;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  @IsOptional()
  @IsBoolean()
  isSensitive?: boolean;

  @IsOptional()
  @IsString()
  requiredPermission?: string;
}
