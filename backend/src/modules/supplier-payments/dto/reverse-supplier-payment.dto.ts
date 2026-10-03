import { IsOptional, IsString } from 'class-validator';

export class ReverseSupplierPaymentDto {
  /** Why the payment is being reversed (stored on the audit log + notes). */
  @IsOptional()
  @IsString()
  reason?: string;
}
