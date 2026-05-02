import { IsString, IsOptional, IsEnum, IsDateString } from 'class-validator';
import { TaxFilingFrequency, TaxFilingPeriodStatus } from '@prisma/client';

export class CreateTaxFilingPeriodDto {
  @IsString() filingPeriodCode!: string;
  @IsString() companyId!: string;
  @IsString() taxTypeId!: string;
  @IsString() name!: string;
  @IsDateString() periodStart!: string;
  @IsDateString() periodEnd!: string;
  @IsOptional() @IsDateString() dueDate?: string;
  @IsOptional() @IsEnum(TaxFilingFrequency) filingFrequency?: TaxFilingFrequency;
  @IsOptional() @IsEnum(TaxFilingPeriodStatus) status?: TaxFilingPeriodStatus;
  @IsOptional() @IsString() notes?: string;
}
