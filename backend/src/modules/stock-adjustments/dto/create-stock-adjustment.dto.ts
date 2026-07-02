import {
  IsArray,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  ValidateIf,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';

export class StockAdjustmentLineDto {
  @IsNotEmpty() @IsString() productId!: string;
  @ValidateIf((line) => line.systemQty === undefined)
  @IsNotEmpty()
  @IsNumber()
  systemQuantity?: number;
  @ValidateIf((line) => line.countedQty === undefined)
  @IsNotEmpty()
  @IsNumber()
  countedQuantity?: number;
  @ValidateIf((line) => line.systemQuantity === undefined)
  @IsNotEmpty()
  @IsNumber()
  systemQty?: number;
  @ValidateIf((line) => line.countedQuantity === undefined)
  @IsNotEmpty()
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
