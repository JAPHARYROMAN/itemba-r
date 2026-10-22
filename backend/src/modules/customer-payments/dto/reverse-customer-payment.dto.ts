import { Transform } from 'class-transformer';
import { IsString, MaxLength, MinLength } from 'class-validator';

export class ReverseCustomerPaymentDto {
  /** Why the payment is being reversed (stored on the audit log + notes). */
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @MinLength(3)
  @MaxLength(500)
  reason!: string;
}
