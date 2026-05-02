import { IsString, IsOptional, IsObject, IsBoolean } from 'class-validator';

export class UpdateSavedReportViewDto {
  @IsOptional()
  @IsString()
  reportDefinitionId?: string;

  @IsOptional()
  @IsString()
  companyId?: string;

  @IsOptional()
  @IsString()
  name?: string;

  @IsOptional()
  @IsObject()
  filters?: Record<string, any>;

  @IsOptional()
  @IsObject()
  columns?: Record<string, any>;

  @IsOptional()
  @IsObject()
  sortConfig?: Record<string, any>;

  @IsOptional()
  @IsObject()
  chartConfig?: Record<string, any>;

  @IsOptional()
  @IsBoolean()
  isDefault?: boolean;

  @IsOptional()
  @IsBoolean()
  isShared?: boolean;
}
