import {
  IsBoolean,
  IsDateString,
  IsEnum,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  Min,
} from 'class-validator';
import { CurrencyCode } from '@prisma/client';

export class CreateExpenseDto {
  @IsNotEmpty()
  @IsString()
  companyId!: string;

  @IsOptional()
  @IsString()
  divisionId?: string;

  @IsOptional()
  @IsString()
  branchId?: string;

  @IsNotEmpty()
  @IsString()
  expenseCategoryId!: string;

  @IsOptional()
  @IsString()
  cashAccountId?: string;

  @IsOptional()
  @IsString()
  vendorName?: string;

  @IsNotEmpty()
  @IsNumber()
  amount!: number;

  /** Whether the expense carries recoverable input VAT (split at approval). */
  @IsOptional()
  @IsBoolean()
  isTaxable?: boolean;

  /**
   * Recoverable input VAT INCLUDED in `amount` (tax-inclusive gross). Must be
   * strictly less than `amount`; only split to TAX_VAT_RECEIVABLE when
   * `isTaxable` is true and the value is greater than zero.
   */
  @IsOptional()
  @IsNumber()
  @Min(0)
  taxAmount?: number;

  @IsOptional()
  @IsEnum(CurrencyCode)
  currency?: CurrencyCode;

  @IsNotEmpty()
  @IsDateString()
  expenseDate!: string;

  @IsNotEmpty()
  @IsString()
  description!: string;

  @IsOptional()
  @IsString()
  paymentMethod?: string;
}
