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
  @IsNotEmpty() @IsNumber() systemQuantity!: number;
  @IsNotEmpty() @IsNumber() countedQuantity!: number;
  @IsNotEmpty() @IsString() unitId!: string;
  @IsOptional() @IsString() reason?: string;
}

export class CreateStockAdjustmentDto {
  @IsNotEmpty() @IsString() companyId!: string;
  @IsOptional() @IsString() divisionId?: string;
  @IsOptional() @IsString() branchId?: string;
  @IsNotEmpty() @IsString() inventoryLocationId!: string;
  @IsNotEmpty() @IsString() reason!: string;
  @IsOptional() @IsString() notes?: string;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => StockAdjustmentLineDto)
  lines!: StockAdjustmentLineDto[];
}
