import { IsDateString, IsOptional, IsString } from 'class-validator';

/**
 * Pay (post) a DRAFT refund. All financial values are fixed at creation; this
 * only optionally overrides the effective posting date and captures a note.
 */
export class PayRefundDto {
  /** Optional override of the GL posting / value date. Defaults to refundDate. */
  @IsOptional()
  @IsDateString()
  paymentDate?: string;

  @IsOptional()
  @IsString()
  notes?: string;
}
