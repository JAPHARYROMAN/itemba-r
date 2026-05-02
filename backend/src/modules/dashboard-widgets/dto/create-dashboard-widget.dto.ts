import { IsString, IsOptional, IsEnum, IsObject, IsBoolean } from 'class-validator';
import { WidgetType, WidgetDataSourceType } from '@prisma/client';

export class CreateDashboardWidgetDto {
  @IsString()
  widgetCode!: string;

  @IsString()
  title!: string;

  @IsEnum(WidgetType)
  widgetType!: WidgetType;

  @IsEnum(WidgetDataSourceType)
  dataSourceType!: WidgetDataSourceType;

  @IsOptional()
  @IsString()
  dataSourceKey?: string;

  @IsOptional()
  @IsString()
  kpiIndicatorId?: string;

  @IsOptional()
  @IsString()
  reportDefinitionId?: string;

  @IsOptional()
  @IsObject()
  config?: Record<string, any>;

  @IsOptional()
  @IsObject()
  position?: Record<string, any>;

  @IsOptional()
  @IsBoolean()
  isSensitive?: boolean;

  @IsOptional()
  @IsString()
  requiredPermission?: string;
}
