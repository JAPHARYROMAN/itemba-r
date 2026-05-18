import { Type } from 'class-transformer';
import { IsDateString, IsEnum, IsNumber, IsOptional, IsString } from 'class-validator';
import { BankReconciliationStatus } from '@prisma/client';
import { CompanyPagedQueryDto } from '../../../common/dto/pagination-query.dto';

export class QueryBankReconciliationDto extends CompanyPagedQueryDto {
  @IsOptional()
  @IsString()
  bankAccountId?: string;

  @IsOptional()
  @IsEnum(BankReconciliationStatus)
  status?: BankReconciliationStatus;
}

export class UpsertBankReconciliationDto {
  @IsOptional()
  @IsString()
  reconciliationNumber?: string;

  @IsOptional()
  @IsString()
  companyId?: string;

  @IsOptional()
  @IsString()
  cashAccountId?: string;

  @IsOptional()
  @IsString()
  bankAccountId?: string;

  @IsOptional()
  @IsDateString()
  statementStartDate?: string;

  @IsOptional()
  @IsDateString()
  statementEndDate?: string;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  statementOpeningBalance?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  statementClosingBalance?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  bookOpeningBalance?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  bookClosingBalance?: number;

  @IsOptional()
  @IsString()
  currency?: string;

  @IsOptional()
  @IsString()
  notes?: string;
}

export class CreateBankReconciliationDto {
  @IsString()
  reconciliationNumber!: string;

  @IsString()
  companyId!: string;

  @IsString()
  cashAccountId!: string;

  @IsOptional()
  @IsString()
  bankAccountId?: string;

  @IsDateString()
  statementStartDate!: string;

  @IsDateString()
  statementEndDate!: string;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  statementOpeningBalance?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  statementClosingBalance?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  bookOpeningBalance?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  bookClosingBalance?: number;

  @IsOptional()
  @IsString()
  currency?: string;

  @IsOptional()
  @IsString()
  notes?: string;
}

export class AddBankStatementLineDto {
  @IsDateString()
  transactionDate!: string;

  @IsString()
  description!: string;

  @IsOptional()
  @IsString()
  reference?: string;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  debitAmount?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  creditAmount?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  balance?: number;
}
