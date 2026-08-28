import {
  DataIsolationIssueSeverity,
  DataIsolationIssueType,
  DataIsolationRunType,
} from '@prisma/client';
import { IsEnum, IsInt, IsObject, IsOptional, IsString, Min } from 'class-validator';

export class CreateDataIsolationTestDto {
  @IsEnum(DataIsolationRunType)
  runType!: DataIsolationRunType;

  @IsOptional()
  @IsInt()
  @Min(0)
  totalChecks?: number;
}

export class CompleteDataIsolationTestDto {
  @IsOptional()
  @IsInt()
  @Min(0)
  failedChecks?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  passedChecks?: number;

  @IsOptional()
  @IsObject()
  resultSummary?: Record<string, unknown>;
}

export class AddDataIsolationIssueDto {
  @IsEnum(DataIsolationIssueType)
  issueType!: DataIsolationIssueType;

  @IsEnum(DataIsolationIssueSeverity)
  severity!: DataIsolationIssueSeverity;

  @IsOptional()
  @IsString()
  entityType?: string;

  @IsOptional()
  @IsString()
  endpoint?: string;

  @IsString()
  description!: string;
}
