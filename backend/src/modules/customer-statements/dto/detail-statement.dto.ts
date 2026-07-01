import { IsDateString, IsOptional, IsString } from 'class-validator';

/**
 * Query params for the professional statement-of-account detail endpoint
 * (GET /customer-statements/detail). Company + customer scoped over a date
 * range. `dateFrom` bounds the opening-balance cut (everything strictly before
 * it rolls into openingBalance); `dateTo` bounds the last movement shown and is
 * also the as-of date the aging buckets are computed against.
 */
export class DetailStatementQueryDto {
  @IsString()
  companyId!: string;

  @IsString()
  customerId!: string;

  @IsDateString()
  dateFrom!: string;

  @IsDateString()
  dateTo!: string;

  /** Presentation currency label only (data is single-currency per company). */
  @IsOptional()
  @IsString()
  currency?: string;
}
