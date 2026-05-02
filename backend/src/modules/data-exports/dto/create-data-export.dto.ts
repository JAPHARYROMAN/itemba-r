import { IsString, IsOptional, IsEnum, IsObject } from 'class-validator';
import { DataExportType } from '@prisma/client';

export class CreateDataExportDto {
  @IsOptional() @IsString() companyId?: string;
  @IsOptional() @IsEnum(DataExportType) exportType?: DataExportType;
  @IsOptional() @IsObject() filters?: Record<string, unknown>;
  @IsOptional() @IsString() fileName?: string;
  @IsOptional() @IsString() notes?: string;
}
