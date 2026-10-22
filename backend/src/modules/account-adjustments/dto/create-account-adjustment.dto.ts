import { Transform, Type } from 'class-transformer';
import { AccountAdjustmentDirection } from '@prisma/client';
import {
  IsDateString,
  IsEnum,
  IsNumber,
  IsString,
  IsUUID,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';

export class CreateAccountAdjustmentDto {
  @IsUUID()
  requestId!: string;

  @IsEnum(AccountAdjustmentDirection)
  direction!: AccountAdjustmentDirection;

  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0.01)
  amount!: number;

  @IsDateString({ strict: true })
  transactionDate!: string;

  @IsUUID()
  offsetAccountId!: string;

  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @MinLength(3)
  @MaxLength(1000)
  reason!: string;
}
