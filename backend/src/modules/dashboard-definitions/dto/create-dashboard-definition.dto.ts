import { IsString, IsOptional, IsEnum, IsObject, IsBoolean } from 'class-validator';
import { DashboardType } from '@prisma/client';

export class CreateDashboardDefinitionDto {
  @IsString()
  dashboardCode!: string;

  @IsString()
  name!: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsEnum(DashboardType)
  dashboardType!: DashboardType;

  @IsObject()
  layout!: Record<string, any>;

  @IsOptional()
  @IsBoolean()
  isSystemDashboard?: boolean;

  @IsOptional()
  @IsBoolean()
  isSensitive?: boolean;

  @IsOptional()
  @IsString()
  requiredPermission?: string;
}
