import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsDateString,
  IsEnum,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  Min,
  ValidateNested,
} from 'class-validator';
import { CurrencyCode } from '@prisma/client';

/**
 * A single line on a credit note. `taxAmount` is the VAT (output) that is being
 * reversed for this line; `lineTotal` is the gross (net + tax). The service
 * recomputes net/tax/gross with Decimal math and never trusts client totals for
 * the ledger — the DTO values are validated and used to derive per-line amounts.
 */
export class CreateCreditNoteLineDto {
  @IsOptional()
  @IsString()
  productId?: string;

  @IsOptional()
  @IsString()
  unitId?: string;

  @IsNotEmpty()
  @IsString()
  description!: string;

  @IsNotEmpty()
  @IsNumber({ maxDecimalPlaces: 4 })
  @Min(0)
  quantity!: number;

  @IsNotEmpty()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  unitPrice!: number;

  /** VAT amount for this line (18% output tax being reversed). Defaults to 0. */
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  taxAmount?: number;

  /**
   * Physical-return restock opt-in. When > 0 this line is goods physically
   * returned to stock: issuing the credit note ALSO restocks this quantity
   * (a SALES_RETURN inventory movement) and posts the reversing
   * Dr Inventory / Cr COGS for its cost, in the same transaction as the
   * financial (AR/revenue/VAT) reversal. Omit / leave 0 for a pure price
   * adjustment or allowance (financial-only — no goods came back, no restock).
   * Requires productId. Must not exceed the line's credited quantity.
   */
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 4 })
  @Min(0)
  returnedQuantity?: number;

  /**
   * Optional per-unit cost the returned stock re-enters at (original COGS
   * basis). When omitted, issue() derives it from the linked sales-order line
   * (unitCostAtSale / cogsAmount) or the product's average / default cost, the
   * same cost basis a sale used — so the COGS reversal matches the original.
   */
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 4 })
  @Min(0)
  restockUnitCost?: number;
}

export class CreateCreditNoteDto {
  @IsNotEmpty()
  @IsString()
  companyId!: string;

  @IsOptional()
  @IsString()
  divisionId?: string;

  @IsOptional()
  @IsString()
  branchId?: string;

  @IsOptional()
  @IsString()
  customerId?: string;

  @IsOptional()
  @IsString()
  customerName?: string;

  /** Optional link to the sales order this credit note relates to. */
  @IsOptional()
  @IsString()
  salesOrderId?: string;

  /** Optional link to the receivable this credit note settles/offsets. */
  @IsOptional()
  @IsString()
  receivableId?: string;

  @IsOptional()
  @IsEnum(CurrencyCode)
  currency?: CurrencyCode;

  @IsNotEmpty()
  @IsDateString()
  issueDate!: string;

  @IsOptional()
  @IsString()
  reason?: string;

  @IsOptional()
  @IsString()
  notes?: string;

  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => CreateCreditNoteLineDto)
  lines!: CreateCreditNoteLineDto[];
}
