import {
  IsDateString,
  IsEnum,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
} from 'class-validator';
import { CurrencyCode, InterCompanyTxType } from '@prisma/client';

export class CreateIntercompanyTransactionDto {
  @IsNotEmpty()
  @IsString()
  fromCompanyId!: string;

  @IsNotEmpty()
  @IsString()
  toCompanyId!: string;

  @IsNotEmpty()
  @IsEnum(InterCompanyTxType)
  transactionType!: InterCompanyTxType;

  @IsNotEmpty()
  @IsNumber()
  amount!: number;

  @IsOptional()
  @IsEnum(CurrencyCode)
  currency?: CurrencyCode;

  @IsNotEmpty()
  @IsDateString()
  transactionDate!: string;

  @IsNotEmpty()
  @IsString()
  description!: string;
}
