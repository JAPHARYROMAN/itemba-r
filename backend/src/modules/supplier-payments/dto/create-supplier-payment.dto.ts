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
  IsUUID,
  ValidateNested,
} from 'class-validator';
import { CurrencyCode, PaymentMethodGeneral } from '@prisma/client';

/**
 * One application of the payment against one open payable. The service checks the
 * payable belongs to the same company and supplier, locks it FOR UPDATE, and enforces
 * `amount <= outstandingAmount`.
 */
export class SupplierPaymentAllocationInputDto {
  @IsNotEmpty()
  @IsString()
  payableId!: string;

  /** Portion of the payment applied to this payable. Must be > 0. */
  @IsNotEmpty()
  @IsNumber({ maxDecimalPlaces: 2 })
  @IsPositive()
  amount!: number;
}

/**
 * Record ONE supplier payment and allocate it across one or more payables.
 * Phase 1 requires `sum(allocations) === amount`: supplier prepayments (money paid
 * ahead of any payable) are not supported yet.
 */
export class CreateSupplierPaymentDto {
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
  supplierId!: string;

  /** Total money paid to the supplier. Must be > 0. */
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

  /** Cash / bank account the money leaves. Resolves the GL credit line. */
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

  /** Client idempotency key. A repeat with the same key returns the original payment. */
  @IsOptional()
  @IsUUID()
  requestId?: string;

  @IsArray()
  @ArrayNotEmpty()
  @ValidateNested({ each: true })
  @Type(() => SupplierPaymentAllocationInputDto)
  allocations!: SupplierPaymentAllocationInputDto[];
}
