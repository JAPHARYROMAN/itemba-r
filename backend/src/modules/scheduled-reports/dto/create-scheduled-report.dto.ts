import { IsString, IsOptional, IsEnum, IsObject } from 'class-validator';
import { ScheduleFrequency, ReportExportFormat } from '@prisma/client';

export class CreateScheduledReportDto {
  @IsString()
  scheduleCode!: string;

  @IsString()
  reportDefinitionId!: string;

  @IsOptional()
  @IsString()
  savedReportViewId?: string;

  @IsOptional()
  @IsString()
  companyId?: string;

  @IsString()
  name!: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsEnum(ScheduleFrequency)
  frequency!: ScheduleFrequency;

  @IsOptional()
  @IsObject()
  scheduleConfig?: Record<string, any>;

  @IsObject()
  recipients!: Record<string, any>;

  @IsEnum(ReportExportFormat)
  exportFormat!: ReportExportFormat;
}
