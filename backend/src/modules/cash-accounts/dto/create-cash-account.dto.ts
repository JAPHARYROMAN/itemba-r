import {
  IsBoolean,
  IsEnum,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
} from 'class-validator';
import { CashAccountType, CurrencyCode } from '@prisma/client';

export class CreateCashAccountDto {
  @IsNotEmpty()
  @IsString()
  companyId!: string;

  /** Phase 1 — optional Branch scope. Null = company-wide cash; set for branch petty cash / till drawer. */
  @IsOptional()
  @IsString()
  branchId?: string;

  @IsOptional()
  @IsString()
  linkedBankAccountId?: string;

  @IsNotEmpty()
  @IsString()
  accountName!: string;

  @IsOptional()
  @IsEnum(CashAccountType)
  accountType?: CashAccountType;

  @IsOptional()
  @IsEnum(CurrencyCode)
  currency?: CurrencyCode;

  @IsOptional()
  @IsNumber()
  openingBalance?: number;

  @IsOptional()
  @IsNumber()
  currentBalance?: number;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  @IsOptional()
  @IsString()
  notes?: string;
}
