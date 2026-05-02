import { IsDateString, IsNotEmpty, IsObject, IsOptional, IsString } from 'class-validator';

export class CommissionFilterDto {
  @IsNotEmpty()
  @IsString()
  companyId!: string;

  @IsOptional()
  @IsString()
  branchId?: string;

  @IsNotEmpty()
  @IsDateString()
  periodStart!: string;

  @IsNotEmpty()
  @IsDateString()
  periodEnd!: string;

  /**
   * Map of productId → TZS per litre. Products not in the map → no commission.
   */
  @IsObject()
  ratesByProductId!: Record<string, number>;
}
