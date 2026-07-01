/**
 * Lifecycle states for a credit note.
 *
 * These string values mirror the `CreditNoteStatus` enum the schema owns in
 * `database/prisma/schema.prisma`. Kept as a module-local const enum so this
 * module compiles and unit-tests independently of Prisma client regeneration;
 * the string values are identical to the DB enum, so it is drop-in compatible
 * once `@prisma/client` exports `CreditNoteStatus` (swap the import then).
 *
 *   DRAFT  -> editable, not yet posted to the GL.
 *   ISSUED -> posted; a balanced reversing journal entry exists.
 *   VOID   -> issued then reversed; the GL impact has been unwound.
 */
export enum CreditNoteStatus {
  DRAFT = 'DRAFT',
  ISSUED = 'ISSUED',
  VOID = 'VOID',
}
