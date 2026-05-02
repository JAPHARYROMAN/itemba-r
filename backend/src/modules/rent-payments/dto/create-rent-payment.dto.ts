import { IsString, IsOptional, IsEnum, IsNumber, IsDateString } from 'class-validator';
import { Type } from 'class-transformer';
import { PaymentMethodGeneral } from '@prisma/client';

export class CreateRentPaymentDto {
  @IsString() rentPaymentNumber!: string;
  @IsString() companyId!: string;
  @IsString() rentInvoiceId!: string;
  @IsString() tenantId!: string;
  @IsDateString() paymentDate!: string;
  @IsNumber() @Type(() => Number) amount!: number;
  @IsString() currency!: string;
  @IsEnum(PaymentMethodGeneral) paymentMethod!: PaymentMethodGeneral;
  @IsString() receivedById!: string;
  @IsString() @IsOptional() cashAccountId?: string;
  @IsString() @IsOptional() reference?: string;
  @IsString() @IsOptional() notes?: string;
  /**
   * Optional client-supplied idempotency token. If two requests with the same
   * key arrive on the same company, the second short-circuits to the first
   * payment instead of double-charging.
   */
  @IsString() @IsOptional() idempotencyKey?: string;
}
