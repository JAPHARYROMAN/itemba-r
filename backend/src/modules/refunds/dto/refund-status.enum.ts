/**
 * Refund lifecycle.
 *
 * Mirrors the `RefundStatus` enum that the schema package owns on the `Refund`
 * model. Declared locally so this module keeps typechecking and validating
 * regardless of Prisma client regeneration order in the wave; once the
 * generated `RefundStatus` from `@prisma/client` is available the string
 * literals are identical.
 *
 *   DRAFT -> PAID (pay/post)   PAID -> VOID (void/reverse)
 */
export enum RefundStatus {
  DRAFT = 'DRAFT',
  PAID = 'PAID',
  VOID = 'VOID',
}
