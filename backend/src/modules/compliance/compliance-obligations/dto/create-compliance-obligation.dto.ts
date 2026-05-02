import { IsString, IsOptional, IsEnum, IsDateString } from 'class-validator';
import { ComplianceObligationType, ComplianceObligationRecurrence, CompliancePriority, ComplianceObligationStatus } from '@prisma/client';

export class CreateComplianceObligationDto {
  @IsString() obligationCode!: string;
  @IsString() companyId!: string;
  @IsOptional() @IsString() divisionId?: string;
  @IsOptional() @IsString() branchId?: string;
  @IsOptional() @IsString() licensedBusinessUnitId?: string;
  @IsOptional() @IsString() authorityId?: string;
  @IsOptional() @IsEnum(ComplianceObligationType) obligationType?: ComplianceObligationType;
  @IsString() title!: string;
  @IsOptional() @IsString() description?: string;
  @IsDateString() dueDate!: string;
  @IsOptional() @IsEnum(ComplianceObligationRecurrence) recurrence?: ComplianceObligationRecurrence;
  @IsOptional() @IsEnum(CompliancePriority) priority?: CompliancePriority;
  @IsOptional() @IsEnum(ComplianceObligationStatus) status?: ComplianceObligationStatus;
  @IsOptional() @IsString() responsibleUserId?: string;
  @IsOptional() @IsString() documentId?: string;
  @IsOptional() @IsString() notes?: string;
}
