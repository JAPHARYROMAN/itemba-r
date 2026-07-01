import { Prisma } from '@prisma/client';
import { CreditNoteStatus } from './credit-note-status.enum';

/**
 * ── Why this file exists ─────────────────────────────────────────────────────
 *
 * The `CreditNote` / `CreditNoteLine` Prisma **models** are owned by the schema
 * package (`database/prisma/schema.prisma`). At the time this module was written
 * the schema had the *relation fields* wired on Company/User/JournalEntry/
 * Customer/Receivable/SalesOrder but the model blocks + regenerated client were
 * not yet present on this branch.
 *
 * To keep this module fully typechecking and unit-testable *today* — without
 * editing files outside our package — we describe the minimal shape of the
 * credit-note delegates we use and expose a single `creditNoteDb()` accessor
 * that casts a Prisma client/transaction to that shape.
 *
 * Once the schema agent lands the models and regenerates `@prisma/client`, the
 * generated delegates are strictly richer than this shape, so `creditNoteDb()`
 * remains valid; it can be deleted and callers can use `db.creditNote` directly.
 *
 * The runtime call is exactly `db.creditNote.*` / `db.creditNoteLine.*`, so no
 * behaviour changes — this is a compile-time bridge only.
 */

export type CreditNoteRow = {
  id: string;
  creditNoteNumber: string;
  companyId: string;
  divisionId: string | null;
  branchId: string | null;
  customerId: string | null;
  customerName: string;
  salesOrderId: string | null;
  receivableId: string | null;
  reason: string | null;
  subtotal: Prisma.Decimal;
  taxAmount: Prisma.Decimal;
  totalAmount: Prisma.Decimal;
  appliedAmount: Prisma.Decimal;
  currency: string;
  issueDate: Date;
  status: CreditNoteStatus;
  notes: string | null;
  journalEntryId: string | null;
  createdById: string | null;
  deletedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
};

type FindArgs = {
  where?: Record<string, unknown>;
  include?: Record<string, unknown>;
  orderBy?: Record<string, unknown>;
  skip?: number;
  take?: number;
  select?: Record<string, unknown>;
};

type WriteArgs = {
  where?: Record<string, unknown>;
  data: Record<string, unknown>;
};

type CreateArgs = {
  data: Record<string, unknown>;
  include?: Record<string, unknown>;
};

/** Minimal delegate surface used by CreditNotesService. */
export interface CreditNoteDelegate {
  findFirst(args: FindArgs): Promise<any>;
  findMany(args: FindArgs): Promise<any[]>;
  count(args: { where?: Record<string, unknown> }): Promise<number>;
  create(args: CreateArgs): Promise<any>;
  update(args: WriteArgs): Promise<any>;
  updateMany(args: WriteArgs): Promise<{ count: number }>;
}

export interface CreditNoteLineDelegate {
  createMany(args: { data: Record<string, unknown>[] }): Promise<{ count: number }>;
}

export interface CreditNoteCapableClient {
  creditNote: CreditNoteDelegate;
  creditNoteLine: CreditNoteLineDelegate;
}

/**
 * Cast any Prisma client / transaction client to the credit-note-capable shape.
 * Runtime is unchanged — the delegates exist on the (regenerated) client.
 */
export function creditNoteDb(
  db: Prisma.TransactionClient | { creditNote?: unknown },
): CreditNoteCapableClient {
  return db as unknown as CreditNoteCapableClient;
}
