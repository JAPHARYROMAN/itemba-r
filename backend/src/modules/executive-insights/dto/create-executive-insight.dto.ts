import { IsString, IsOptional, IsEnum, IsObject, IsDateString } from 'class-validator';
import { InsightType, InsightSeverity, InsightGeneratedBy } from '@prisma/client';

export class CreateExecutiveInsightDto {
  @IsOptional()
  @IsString()
  companyId?: string;

  @IsOptional()
  @IsString()
  divisionId?: string;

  @IsOptional()
  @IsString()
  branchId?: string;

  @IsOptional()
  @IsString()
  licensedBusinessUnitId?: string;

  @IsDateString()
  insightDate!: string;

  @IsEnum(InsightType)
  insightType!: InsightType;

  @IsString()
  title!: string;

  @IsString()
  summary!: string;

  @IsEnum(InsightSeverity)
  severity!: InsightSeverity;

  @IsOptional()
  @IsObject()
  sourceMetrics?: Record<string, any>;

  @IsOptional()
  @IsString()
  linkedEntityType?: string;

  @IsOptional()
  @IsString()
  linkedEntityId?: string;

  @IsOptional()
  @IsEnum(InsightGeneratedBy)
  generatedBy?: InsightGeneratedBy;
}
