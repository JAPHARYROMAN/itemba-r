import {
  IsArray,
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
  // The service's normalizeAdjustmentLine enforces the cross-field rule that
  // one value from each pair is present and finite; class-validator cannot
  // express that JSON-schema union without downgrading the whole body to
  // `partial` discovery quality.
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
}

export class CreateStockAdjustmentDto {
  @IsNotEmpty() @IsString() companyId!: string;
  @IsOptional() @IsString() divisionId?: string;
  @IsNotEmpty() @IsString() branchId!: string;
  @IsNotEmpty() @IsString() reason!: string;
  @IsOptional() @IsString() notes?: string;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => StockAdjustmentLineDto)
  lines!: StockAdjustmentLineDto[];
}
