import { IsOptional, IsString, MaxLength } from 'class-validator';

/**
 * Query for `GET /mobile-pos-lite/stock` (spec-inventory §1.1).
 *
 * `search` uses the same OR terms as the catalog search (barcode
 * equals-insensitive, productCode/sku/name contains-insensitive). A `?low=`
 * boolean was CUT from v1 (owner decision 2026-08-11, critique D4): the
 * Kidogo/Imeisha filter chips are client-side over the snapshot. Whoever
 * revives it must use the documented boolean-coercion pattern
 * `@Type(() => String) @Transform(({ value }) => value === 'true')` — the
 * plain pattern is clobbered by `enableImplicitConversion`.
 */
export class QueryMobilePosLiteStockDto {
  @IsOptional()
  @IsString()
  @MaxLength(120)
  search?: string;
}
