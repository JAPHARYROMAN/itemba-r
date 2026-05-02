import { IsString, IsOptional, IsEnum, IsObject, IsBoolean } from 'class-validator';
import { ReportCategory } from '@prisma/client';

export class CreateReportDefinitionDto {
  @IsString()
  reportCode!: string;

  @IsString()
  name!: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsEnum(ReportCategory)
  reportCategory!: ReportCategory;

  @IsString()
  datasetKey!: string;

  @IsOptional()
  @IsObject()
  defaultFilters?: Record<string, any>;

  @IsOptional()
  @IsObject()
  defaultColumns?: Record<string, any>;

  @IsOptional()
  @IsObject()
  supportedFilters?: Record<string, any>;

  @IsOptional()
  @IsBoolean()
  isSystemReport?: boolean;

  @IsOptional()
  @IsBoolean()
  isSensitive?: boolean;

  @IsOptional()
  @IsString()
  requiredPermission?: string;
}
