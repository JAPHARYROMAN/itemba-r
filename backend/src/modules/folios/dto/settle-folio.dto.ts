import { IsEnum, IsOptional, IsString } from 'class-validator';
import { SalesPaymentMethod } from '@prisma/client';

export class SettleFolioDto {
  @IsEnum(SalesPaymentMethod)
  paymentMethod!: SalesPaymentMethod;

  /** Required when paymentMethod !== CREDIT. */
  @IsOptional()
  @IsString()
  cashAccountId?: string;

  @IsOptional()
  @IsString()
  paymentReference?: string;
}
