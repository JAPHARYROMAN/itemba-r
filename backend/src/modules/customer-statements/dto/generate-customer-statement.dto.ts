import { CurrencyCode } from '@prisma/client';
import { IsDateString, IsEnum, IsOptional, IsString } from 'class-validator';

export class GenerateCustomerStatementDto {
  @IsString()
  companyId!: string;

  @IsOptional()
  @IsString()
  customerId?: string;

  @IsDateString()
  periodStart!: string;

  @IsDateString()
  periodEnd!: string;

  /**
   * Currency the statement is scoped to. A statement must not sum across
   * currencies, so the persisted run nets only movements in this currency.
   * Defaults to the base currency (TZS) when omitted.
   */
  @IsOptional()
  @IsEnum(CurrencyCode)
  currency?: CurrencyCode;
}
