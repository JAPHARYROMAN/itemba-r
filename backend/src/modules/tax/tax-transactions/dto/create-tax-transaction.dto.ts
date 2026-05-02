import { IsString, IsOptional, IsEnum, IsNumber, IsDateString } from 'class-validator';
import { TaxTransactionSourceType, TaxTransactionDirection, TaxTransactionStatus } from '@prisma/client';

export class CreateTaxTransactionDto {
  @IsString() taxTransactionNumber!: string;
  @IsString() companyId!: string;
  @IsString() taxTypeId!: string;
  @IsOptional() @IsString() taxCodeId?: string;
  @IsOptional() @IsString() taxRateId?: string;
  @IsOptional() @IsEnum(TaxTransactionSourceType) sourceType?: TaxTransactionSourceType;
  @IsOptional() @IsString() sourceId?: string;
  @IsDateString() transactionDate!: string;
  @IsNumber() taxableAmount!: number;
  @IsNumber() taxAmount!: number;
  @IsOptional() @IsString() currency?: string;
  @IsOptional() @IsEnum(TaxTransactionDirection) direction?: TaxTransactionDirection;
  @IsOptional() @IsEnum(TaxTransactionStatus) status?: TaxTransactionStatus;
  @IsOptional() @IsString() journalEntryId?: string;
  @IsString() createdById!: string;
  @IsOptional() @IsString() notes?: string;
}
