import { IsString, IsOptional, IsEnum, IsBoolean } from 'class-validator';
import { TaxCodeAppliesTo, TaxCodeStatus } from '@prisma/client';

export class CreateTaxCodeDto {
  @IsString() taxCode!: string;
  @IsOptional() @IsString() companyId?: string;
  @IsString() taxTypeId!: string;
  @IsOptional() @IsString() taxRateId?: string;
  @IsString() name!: string;
  @IsOptional() @IsString() description?: string;
  @IsOptional() @IsEnum(TaxCodeAppliesTo) appliesTo?: TaxCodeAppliesTo;
  @IsOptional() @IsString() accountId?: string;
  @IsOptional() @IsBoolean() isDefault?: boolean;
  @IsOptional() @IsEnum(TaxCodeStatus) status?: TaxCodeStatus;
}
