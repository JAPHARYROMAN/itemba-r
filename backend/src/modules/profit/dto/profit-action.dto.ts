import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsDateString,
  IsInt,
  IsNumber,
  IsOptional,
  IsPositive,
  IsUUID,
  Max,
  Min,
  ValidateNested,
} from 'class-validator';

export class ValidateSaleLineDto {
  @IsUUID('all')
  productId!: string;

  @IsNumber()
  @IsPositive()
  quantity!: number;

  @IsNumber()
  @IsPositive()
  unitPrice!: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  discountAmount?: number | null;
}

export class ValidateSaleLinesDto {
  @IsUUID('all')
  companyId!: string;

  @IsOptional()
  @IsUUID('all')
  branchId?: string | null;

  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => ValidateSaleLineDto)
  lines!: ValidateSaleLineDto[];
}

export class FixProfitCostGapDto {
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @IsPositive()
  defaultPurchasePrice?: number | null;

  @IsOptional()
  @IsUUID('all')
  branchId?: string | null;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @IsPositive()
  averageCost?: number | null;
}

/** Exact, allow-listed envelope for the mutating historical-sales backfill. */
export class BackfillProfitSalesQueryDto {
  @IsOptional()
  @IsUUID('all')
  companyId?: string;

  @IsOptional()
  @IsUUID('all')
  divisionId?: string;

  @IsOptional()
  @IsUUID('all')
  branchId?: string;

  @IsOptional()
  @IsDateString()
  dateFrom?: string;

  @IsOptional()
  @IsDateString()
  dateTo?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(5000)
  limit?: number;
}
