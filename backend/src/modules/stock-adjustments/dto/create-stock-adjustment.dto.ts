import {
  IsArray,
  ArrayNotEmpty,
  IsInt,
  Min,
  MaxLength,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';

export class StockAdjustmentLineDto {
  @IsNotEmpty() @IsString() productId!: string;
  // Both canonical and legacy names remain typed in the closed DTO envelope.
  // The count is required by the service's cross-field rule. Book quantity is
  // captured on the server; a supplied canonical/legacy baseline is verified.
  @IsOptional()
  @IsNumber()
  systemQuantity?: number;
  @IsOptional()
  @IsNumber()
  countedQuantity?: number;
  @IsOptional()
  @IsNumber()
  systemQty?: number;
  @IsOptional()
  @IsNumber()
  countedQty?: number;
  @IsNotEmpty() @IsString() unitId!: string;
  @IsOptional() @IsNumber() unitCost?: number;
  @IsOptional() @IsString() reason?: string;
  @IsOptional() @IsInt() @Min(0) expectedRevision?: number;
}

export class CreateStockAdjustmentDto {
  @IsNotEmpty() @IsString() companyId!: string;
  @IsOptional() @IsString() divisionId?: string;
  @IsNotEmpty() @IsString() branchId!: string;
  @IsNotEmpty() @IsString() reason!: string;
  @IsOptional() @IsString() notes?: string;
  @IsOptional() @IsString() @IsNotEmpty() @MaxLength(120) idempotencyKey?: string;

  @IsArray()
  @ArrayNotEmpty()
  @ValidateNested({ each: true })
  @Type(() => StockAdjustmentLineDto)
  lines!: StockAdjustmentLineDto[];
}
