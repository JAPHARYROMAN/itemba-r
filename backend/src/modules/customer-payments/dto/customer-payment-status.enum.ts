/**
 * Customer payment lifecycle.
 *
 * Mirrors the `CustomerPaymentStatus` enum the schema package owns on the
 * `CustomerPayment` model. Declared locally so this module keeps typechecking
 * and validating regardless of Prisma-client regeneration order in the wave;
 * the string literals are identical to the generated enum.
 *
 *   COMPLETED -> REVERSED (reverse)
 */
export enum CustomerPaymentStatus {
  COMPLETED = 'COMPLETED',
  REVERSED = 'REVERSED',
}
