import { IsString, IsOptional, IsEnum, IsNumber, IsDateString } from 'class-validator';
import { TaxRateCalculationMethod, TaxRateStatus } from '@prisma/client';

export class CreateTaxRateDto {
  @IsString() taxTypeId!: string;
  @IsOptional() @IsString() companyId?: string;
  @IsString() rateName!: string;
  @IsNumber() rate!: number;
  @IsOptional() @IsEnum(TaxRateCalculationMethod) calculationMethod?: TaxRateCalculationMethod;
  @IsDateString() effectiveFrom!: string;
  @IsOptional() @IsDateString() effectiveTo?: string;
  @IsOptional() @IsEnum(TaxRateStatus) status?: TaxRateStatus;
  @IsString() createdById!: string;
  @IsOptional() @IsString() notes?: string;
}
