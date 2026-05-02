import { IsString, IsOptional, IsEnum, IsDateString } from 'class-validator';
import { ComplianceDocStatusEnum } from '@prisma/client';

export class CreateComplianceDocumentStatusDto {
  @IsString() companyId!: string;
  @IsString() requirementId!: string;
  @IsOptional() @IsString() linkedEntityType?: string;
  @IsOptional() @IsString() linkedEntityId?: string;
  @IsOptional() @IsString() documentId?: string;
  @IsOptional() @IsEnum(ComplianceDocStatusEnum) status?: ComplianceDocStatusEnum;
  @IsOptional() @IsDateString() expiryDate?: string;
  @IsOptional() @IsDateString() renewalDate?: string;
  @IsOptional() @IsString() notes?: string;
}
