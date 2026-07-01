import { IsDateString, IsEnum, IsOptional, IsString } from 'class-validator';
import { CurrencyCode } from '@prisma/client';

export class GenerateSupplierStatementDto {
  @IsString()
  companyId!: string;

  @IsOptional()
  @IsString()
  supplierId?: string;

  @IsDateString()
  periodStart!: string;

  @IsDateString()
  periodEnd!: string;

  /**
   * Statement currency. A supplier statement is single-currency by design — a
   * balance summed across TZS/USD/etc. is meaningless. Defaults to TZS; only
   * payables in this currency are included in the run.
   */
  @IsOptional()
  @IsEnum(CurrencyCode)
  currency?: CurrencyCode;
}
