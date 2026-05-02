import { IsDateString, IsEnum, IsNotEmpty, IsOptional, IsString } from 'class-validator';
import { OshaRegistrationStatus, OshaRegistrationType, OshaRiskClassification } from '@prisma/client';

export class CreateOshaRegistrationDto {
  @IsNotEmpty()
  @IsString()
  companyId!: string;

  @IsNotEmpty()
  @IsString()
  branchId!: string;

  @IsNotEmpty()
  @IsString()
  certificateNumber!: string;

  @IsOptional()
  @IsEnum(OshaRegistrationType)
  registrationType?: OshaRegistrationType;

  @IsOptional()
  @IsDateString()
  issuedAt?: string;

  @IsNotEmpty()
  @IsDateString()
  expiresAt!: string;

  @IsOptional()
  @IsString()
  inspectorName?: string;

  @IsOptional()
  @IsString()
  inspectorContact?: string;

  @IsOptional()
  @IsEnum(OshaRiskClassification)
  riskClassification?: OshaRiskClassification;

  @IsOptional()
  @IsEnum(OshaRegistrationStatus)
  status?: OshaRegistrationStatus;

  @IsOptional()
  @IsString()
  documentId?: string;

  @IsOptional()
  @IsString()
  notes?: string;
}
