import { IsString, IsOptional, IsEnum, IsNumber, IsDateString } from 'class-validator';
import { TaxReturnStatus } from '@prisma/client';

export class CreateTaxReturnDto {
  @IsString() taxReturnNumber!: string;
  @IsString() companyId!: string;
  @IsString() taxFilingPeriodId!: string;
  @IsString() taxTypeId!: string;
  @IsOptional() @IsNumber() grossAmount?: number;
  @IsOptional() @IsNumber() taxableAmount?: number;
  @IsOptional() @IsNumber() taxPayable?: number;
  @IsOptional() @IsNumber() taxRecoverable?: number;
  @IsOptional() @IsNumber() netTaxDue?: number;
  @IsOptional() @IsNumber() penalties?: number;
  @IsOptional() @IsNumber() interest?: number;
  @IsOptional() @IsNumber() totalDue?: number;
  @IsOptional() @IsNumber() amountPaid?: number;
  @IsOptional() @IsNumber() outstandingAmount?: number;
  @IsOptional() @IsString() currency?: string;
  @IsOptional() @IsEnum(TaxReturnStatus) status?: TaxReturnStatus;
  @IsOptional() @IsString() submissionReference?: string;
  @IsOptional() @IsString() paymentReference?: string;
  @IsOptional() @IsString() documentId?: string;
  @IsOptional() @IsString() notes?: string;
}
