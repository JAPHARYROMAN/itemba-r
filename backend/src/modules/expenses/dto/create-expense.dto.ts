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
   *
   * Cross-field rule: REQUIRED whenever `isTaxable` is true — flagging
   * recoverable VAT without assessing it would silently book the gross
   * posting and forfeit the claim (0 means "assessed exempt/zero-rated").
   *
   * The pairing rule is deliberately NOT a `@ValidateIf` conditional here: a
   * conditional validator marks the DTO-derived request schema `partial`,
   * which would evict ExpensesController.create/update from the msaidizi
   * strict-manifest inventory. The service owns the rule instead — create()
   * and update() reject a taxable payload with no assessed tax amount, and
   * approve() re-asserts the pair from the FOR UPDATE locked row, which stays
   * the authoritative guard against racing edits.
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
