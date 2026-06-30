import { IsNotEmpty, IsString, MaxLength } from 'class-validator';

export class RejectStockAdjustmentDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(1000)
  reason!: string;
}
