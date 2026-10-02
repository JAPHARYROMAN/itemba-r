/**
 * Supplier payment lifecycle. The schema reuses the `CustomerPaymentStatus` Prisma
 * enum for the `SupplierPayment.status` column; the literals are identical.
 *
 *   COMPLETED -> REVERSED (reverse)
 */
export enum SupplierPaymentStatus {
  COMPLETED = 'COMPLETED',
  REVERSED = 'REVERSED',
}
