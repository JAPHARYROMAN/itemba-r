import { IsString, IsOptional, IsEnum, IsDateString } from 'class-validator';
import { TaxRegistrationType, TaxRegistrationStatus } from '@prisma/client';

export class CreateCompanyTaxRegistrationDto {
  @IsString() registrationCode!: string;
  @IsString() companyId!: string;
  @IsOptional() @IsString() authorityId?: string;
  @IsOptional() @IsEnum(TaxRegistrationType) registrationType?: TaxRegistrationType;
  @IsString() registrationNumber!: string;
  @IsOptional() @IsString() registeredName?: string;
  @IsOptional() @IsDateString() registrationDate?: string;
  @IsOptional() @IsDateString() effectiveFrom?: string;
  @IsOptional() @IsDateString() effectiveTo?: string;
  @IsOptional() @IsEnum(TaxRegistrationStatus) status?: TaxRegistrationStatus;
  @IsOptional() @IsString() documentId?: string;
  @IsOptional() @IsString() notes?: string;
}
