import { IsString, IsOptional, IsEnum, IsObject } from 'class-validator';
import { DataQualityIssueType, DataQualityIssueSeverity } from '@prisma/client';

export class CreateDataQualityIssueDto {
  @IsOptional()
  @IsString()
  companyId?: string;

  @IsString()
  entityType!: string;

  @IsOptional()
  @IsString()
  entityId?: string;

  @IsEnum(DataQualityIssueType)
  issueType!: DataQualityIssueType;

  @IsString()
  title!: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsEnum(DataQualityIssueSeverity)
  severity!: DataQualityIssueSeverity;

  @IsOptional()
  @IsObject()
  metadata?: Record<string, any>;
}
