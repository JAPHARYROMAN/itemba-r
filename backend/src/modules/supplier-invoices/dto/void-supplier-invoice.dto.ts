import { IsOptional, IsString, MaxLength } from 'class-validator';

export class VoidSupplierInvoiceDto {
  /**
   * Optional operator note explaining why the approved invoice is being voided
   * (e.g. "entered against wrong PO", "disputed & rejected"). Recorded on the
   * reversing journal entry's reversalReason and in the audit log.
   */
  @IsOptional()
  @IsString()
  @MaxLength(500)
  reason?: string;
}
