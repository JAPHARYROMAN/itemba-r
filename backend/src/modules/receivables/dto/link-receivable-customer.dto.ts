import { IsOptional, IsUUID } from 'class-validator';

/**
 * Match an unlinked receivable (free-text customerName only) to a shared customer
 * profile. Names are never proof of identity: the caller chooses the customer.
 */
export class LinkReceivableCustomerDto {
  @IsUUID()
  customerId!: string;

  /** Client idempotency key; a repeat with the same key returns the same result. */
  @IsOptional()
  @IsUUID()
  requestId?: string;
}
