import { IsNotEmpty, IsOptional, IsString, IsUUID } from 'class-validator';
import { CurrencyCode } from '@prisma/client';
import { IsEnum } from 'class-validator';

export class RecordRepaymentDto {
  @IsUUID() requestId!: string;
  @IsUUID() cashDeskAccountId!: string;
  @IsOptional() @IsString() interestAccountId?: string;
  @IsOptional() @IsString() feeAccountId?: string;
  @IsOptional() @IsString() fees?: string;
  @IsNotEmpty() @IsString() repaymentDate!: string;
  @IsNotEmpty() @IsString() amount!: string;
  @IsOptional() @IsEnum(CurrencyCode) currency?: CurrencyCode;
  @IsOptional() @IsString() principal?: string;
  @IsOptional() @IsString() interest?: string;
  @IsOptional() @IsString() penalties?: string;
  @IsOptional() @IsString() remainingBalance?: string;
  @IsOptional() @IsString() paymentMethod?: string;
  @IsOptional() @IsString() referenceNumber?: string;
  @IsOptional() @IsString() notes?: string;
}
