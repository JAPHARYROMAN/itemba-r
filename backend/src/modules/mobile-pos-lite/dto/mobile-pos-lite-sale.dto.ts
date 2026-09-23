import {
  ArrayMinSize,
  IsArray,
  IsIn,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { SalesPaymentMethod } from '@prisma/client';
import { MOBILE_POS_LITE_RECEIPT_METHODS } from './mobile-pos-terminal.dto';

/**
 * Why a rep sold at a price other than the list price
 * (POS_REMAKE_PLAN_2026-09-23.md section 5).
 */
export const MOBILE_POS_PRICE_REASONS = [
  'REGULAR_CUSTOMER',
  'BULK_OFFER',
  'DAMAGED',
  'OTHER',
] as const;
export type MobilePosPriceReason = (typeof MOBILE_POS_PRICE_REASONS)[number];

export class MobilePosLiteSaleLineDto {
  @IsUUID()
  productId!: string;

  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0.0001)
  @Max(1000000)
  quantity!: number;

  /**
   * VAT-inclusive price the rep charged, when it differs from the list price.
   * Omitted = the server's list price, exactly as before price editing.
   * The server checks the permission, the terminal limit and the below-cost
   * guard; it never trusts this beyond them.
   */
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(1)
  @Max(1000000000)
  unitPrice?: number;

  /** Required whenever unitPrice differs from the list price. */
  @IsOptional()
  @IsIn(MOBILE_POS_PRICE_REASONS)
  priceReason?: MobilePosPriceReason;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  priceNote?: string;
}

export class CreateMobilePosLiteSaleDto {
  @IsIn([...MOBILE_POS_LITE_RECEIPT_METHODS, SalesPaymentMethod.CREDIT])
  paymentMethod!: SalesPaymentMethod;

  @IsOptional()
  @IsUUID()
  customerId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  paymentReference?: string;

  @IsString()
  @MinLength(16)
  @MaxLength(64)
  idempotencyKey!: string;

  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => MobilePosLiteSaleLineDto)
  lines!: MobilePosLiteSaleLineDto[];
}
