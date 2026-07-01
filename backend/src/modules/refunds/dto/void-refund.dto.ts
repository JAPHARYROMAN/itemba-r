import { IsNotEmpty, IsString } from 'class-validator';

/**
 * Void a PAID refund. Posts a reversing journal entry and releases the credit
 * that the refund consumed. A reason is mandatory for the audit trail.
 */
export class VoidRefundDto {
  @IsNotEmpty()
  @IsString()
  reason!: string;
}
