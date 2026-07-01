import { IsOptional, IsString } from 'class-validator';

export class ReverseCustomerPaymentDto {
  /** Why the payment is being reversed (stored on the audit log + notes). */
  @IsOptional()
  @IsString()
  reason?: string;
}
