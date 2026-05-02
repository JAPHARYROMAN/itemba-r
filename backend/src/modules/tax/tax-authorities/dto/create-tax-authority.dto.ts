import { IsString, IsOptional, IsEnum } from 'class-validator';
import { TaxAuthorityType, TaxAuthorityStatus } from '@prisma/client';

export class CreateTaxAuthorityDto {
  @IsString() authorityCode!: string;
  @IsString() name!: string;
  @IsString() country!: string;
  @IsOptional() @IsString() region?: string;
  @IsOptional() @IsEnum(TaxAuthorityType) authorityType?: TaxAuthorityType;
  @IsOptional() @IsString() website?: string;
  @IsOptional() @IsString() contactEmail?: string;
  @IsOptional() @IsString() contactPhone?: string;
  @IsOptional() @IsString() address?: string;
  @IsOptional() @IsEnum(TaxAuthorityStatus) status?: TaxAuthorityStatus;
}
