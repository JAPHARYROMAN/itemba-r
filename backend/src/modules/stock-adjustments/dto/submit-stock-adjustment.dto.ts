import { IsISO8601, IsOptional } from 'class-validator';

export class SubmitStockAdjustmentDto {
  @IsOptional() @IsISO8601() expectedUpdatedAt?: string;
}
