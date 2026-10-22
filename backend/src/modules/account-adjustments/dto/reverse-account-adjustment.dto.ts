import { Transform } from 'class-transformer';
import { IsDateString, IsString, MaxLength, MinLength } from 'class-validator';

export class ReverseAccountAdjustmentDto {
  @IsDateString({ strict: true })
  transactionDate!: string;

  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @MinLength(3)
  @MaxLength(1000)
  reason!: string;
}
