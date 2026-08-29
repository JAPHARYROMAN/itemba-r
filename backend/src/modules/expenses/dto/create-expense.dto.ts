import {
  IsBoolean,
  IsDateString,
  IsDefined,
  IsEnum,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  Min,
  ValidateIf,
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
   * Skipped entirely (optional) when the expense is not taxable. Partial
   * updates validate the effective post-edit pair in the service, and
   * approve() re-asserts it from the locked row.
   */
  @ValidateIf((dto: CreateExpenseDto) => dto.isTaxable === true || dto.taxAmount != null)
  @IsDefined({
    message:
      'taxAmount is required for a taxable expense (the recoverable input VAT included in the gross; use 0 for an exempt/zero-rated expense)',
  })
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
