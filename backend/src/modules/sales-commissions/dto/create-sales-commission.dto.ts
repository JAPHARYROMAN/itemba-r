import { IsString, IsOptional, IsNumber, IsEnum, Min, Max } from 'class-validator';

export enum SalesCommissionBasisDto {
  GROSS = 'GROSS',
  NET = 'NET',
  FLAT = 'FLAT',
}

export class CreateSalesCommissionDto {
  @IsString()
  companyId!: string;

  @IsString()
  employeeId!: string;

  @IsString()
  salesOrderId!: string;

  @IsEnum(SalesCommissionBasisDto)
  basis!: SalesCommissionBasisDto;

  /** Decimal rate, e.g. 0.05 for 5%. Ignored when basis=FLAT. */
  @IsNumber()
  @Min(0)
  @Max(1)
  rate!: number;

  /**
   * Override amount. When omitted, the service computes amount from the
   * order's basis × rate. When provided, it's used verbatim — useful for
   * FLAT basis or manual overrides (manager discretion).
   */
  @IsOptional()
  @IsNumber()
  @Min(0)
  amount?: number;

  @IsOptional()
  @IsString()
  notes?: string;
}
