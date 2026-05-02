import { IsString, IsOptional, IsEnum, IsDateString } from 'class-validator';
import { BusinessLicenseType, BusinessLicenseStatus } from '@prisma/client';

export class CreateBusinessLicenseDto {
  @IsString() licenseCode!: string;
  @IsString() companyId!: string;
  @IsEnum(BusinessLicenseType) licenseType!: BusinessLicenseType;
  @IsString() licenseNumber!: string;
  @IsEnum(BusinessLicenseStatus) @IsOptional() status?: BusinessLicenseStatus;
  @IsString() @IsOptional() divisionId?: string;
  @IsString() @IsOptional() licensedBusinessUnitId?: string;
  @IsString() @IsOptional() issuingAuthority?: string;
  @IsDateString() @IsOptional() issueDate?: string;
  @IsDateString() @IsOptional() expiryDate?: string;
  @IsDateString() @IsOptional() renewalDate?: string;
  @IsString() @IsOptional() documentId?: string;
  @IsString() @IsOptional() responsibleUserId?: string;
  @IsString() @IsOptional() notes?: string;
}
