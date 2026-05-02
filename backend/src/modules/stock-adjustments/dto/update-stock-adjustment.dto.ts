import { IsArray, IsOptional, IsString, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';
import { StockAdjustmentLineDto } from './create-stock-adjustment.dto';

export class UpdateStockAdjustmentDto {
  @IsOptional() @IsString() inventoryLocationId?: string;
  @IsOptional() @IsString() reason?: string;
  @IsOptional() @IsString() notes?: string;

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => StockAdjustmentLineDto)
  lines?: StockAdjustmentLineDto[];
}
