import { IsString, IsOptional, IsEnum, IsBoolean } from 'class-validator';
import { ComplianceDocReqType, TaxCodeStatus } from '@prisma/client';

export class CreateComplianceDocumentRequirementDto {
  @IsString() requirementCode!: string;
  @IsOptional() @IsString() companyId?: string;
  @IsOptional() @IsString() divisionId?: string;
  @IsOptional() @IsString() licensedBusinessUnitId?: string;
  @IsOptional() @IsEnum(ComplianceDocReqType) requirementType?: ComplianceDocReqType;
  @IsString() title!: string;
  @IsOptional() @IsString() description?: string;
  @IsOptional() @IsString() documentCategory?: string;
  @IsOptional() @IsBoolean() required?: boolean;
  @IsOptional() @IsBoolean() expiryRequired?: boolean;
  @IsOptional() @IsBoolean() renewalRequired?: boolean;
  @IsOptional() @IsEnum(TaxCodeStatus) status?: TaxCodeStatus;
}
