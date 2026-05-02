import { IsOptional, IsString, IsDateString, IsEnum, IsDecimal } from 'class-validator';
import { CompanyStatus, CurrencyCode } from '@prisma/client';

export class UpsertCompanyProfileDto {
  @IsString() registeredName!: string;
  @IsOptional() @IsString() tradingName?: string;
  @IsString() brelaRegNumber!: string;
  @IsString() tin!: string;
  @IsOptional() @IsString() vrn?: string;
  @IsOptional() @IsString() businessLicenseNumber?: string;
  @IsOptional() @IsDateString() incorporationDate?: string;
  @IsString() registeredAddress!: string;
  @IsOptional() @IsString() postalAddress?: string;
  @IsOptional() @IsString() taxOffice?: string;
  @IsOptional() @IsString() natureOfBusiness?: string;
  @IsOptional() @IsDecimal() authorizedCapital?: string;
  @IsOptional() @IsEnum(CurrencyCode) currency?: CurrencyCode;
  @IsOptional() @IsEnum(CompanyStatus) status?: CompanyStatus;
  @IsOptional() @IsString() notes?: string;
}
