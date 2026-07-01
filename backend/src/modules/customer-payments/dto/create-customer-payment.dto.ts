import { Type } from 'class-transformer';
import {
  ArrayNotEmpty,
  IsArray,
  IsDateString,
  IsEnum,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsPositive,
  IsString,
  ValidateNested,
} from 'class-validator';
import { CurrencyCode, PaymentMethodGeneral } from '@prisma/client';

/**
 * A single application of the payment against one open receivable. The service
 * validates the receivable belongs to the same company + customer, locks it
 * FOR UPDATE, and enforces `amount <= outstandingAmount`.
 */
export class PaymentAllocationInputDto {
  @IsNotEmpty()
  @IsString()
  receivableId!: string;

  /** Portion of the payment applied to this receivable. Must be > 0. */
  @IsNotEmpty()
  @IsNumber({ maxDecimalPlaces: 2 })
  @IsPositive()
  amount!: number;
}

/**
 * Record ONE customer payment and allocate it across MULTIPLE receivables.
 *
 * `sum(allocations) <= amount`. Any remainder (`amount - sum(allocations)`) is
 * held on the payment as `unappliedAmount` (advance / credit-on-account) and
 * posted to the customer-advances liability (or AR control if no advance
 * account is configured).
 */
export class CreateCustomerPaymentDto {
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
  customerId!: string;

  /** Total money received from the customer. Must be > 0. */
  @IsNotEmpty()
  @IsNumber({ maxDecimalPlaces: 2 })
  @IsPositive()
  amount!: number;

  @IsOptional()
  @IsEnum(PaymentMethodGeneral)
  method?: PaymentMethodGeneral;

  @IsNotEmpty()
  @IsDateString()
  paymentDate!: string;

  /** Cash / bank account the money lands in. Resolves the GL debit line. */
  @IsNotEmpty()
  @IsString()
  cashAccountId!: string;

  @IsOptional()
  @IsString()
  reference?: string;

  @IsOptional()
  @IsEnum(CurrencyCode)
  currency?: CurrencyCode;

  @IsOptional()
  @IsString()
  notes?: string;

  /** Receivable allocations. At least one is required. */
  @IsArray()
  @ArrayNotEmpty()
  @ValidateNested({ each: true })
  @Type(() => PaymentAllocationInputDto)
  allocations!: PaymentAllocationInputDto[];
}
