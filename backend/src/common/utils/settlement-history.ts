import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';

type Amount = Prisma.Decimal | number | string;
const ZERO = new Prisma.Decimal(0);

export interface SettlementHistoryGap {
  documentId: string;
  reference: string;
  amount: string;
  reason: string;
}

export interface SettlementHistory {
  status: 'COMPLETE' | 'INCOMPLETE';
  recoveredLegacySettlements: number;
  unresolvedAmount: string;
  gaps: SettlementHistoryGap[];
}

export interface SettlementDocument {
  id: string;
  reference: string;
  paidAmount?: Amount;
  amount?: Amount;
  outstandingAmount?: Amount;
  status?: string;
  journalEntryId?: string | null;
  sourceType?: string | null;
  sourceId?: string | null;
}

export interface SettlementJournal {
  id: string;
  journalNumber: string;
  transactionDate: Date;
  description: string;
  referenceId: string | null;
  referenceType?: string | null;
  reversalOfId: string | null;
  status: string;
  lines: Array<{
    debit: Amount;
    credit: Amount;
    account: { accountSubType: string | null; accountCode: string };
  }>;
  reversedBy_?: SettlementJournal[];
}

export interface SettlementMovement {
  date: Date;
  type: 'ADJUSTMENT';
  reference: string;
  description: string;
  sourceId: string;
  debit: Prisma.Decimal;
  credit: Prisma.Decimal;
  balance: Prisma.Decimal;
}

export const reversalJournalSelection = {
  id: true,
  transactionDate: true,
  status: true,
  journalNumber: true,
} satisfies Prisma.JournalEntrySelect;

const journalSelection = {
  id: true,
  journalNumber: true,
  transactionDate: true,
  description: true,
  referenceId: true,
  referenceType: true,
  reversalOfId: true,
  status: true,
  lines: {
    select: {
      debit: true,
      credit: true,
      account: { select: { accountSubType: true, accountCode: true } },
    },
  },
} satisfies Prisma.JournalEntrySelect;

/**
 * Read existing journals, never create payment headers or infer payment dates.
 * Documents provide the company, party and currency boundary that legacy journal
 * headers did not carry. Reversed originals are retained for backdated periods.
 */
export async function loadSettlementJournals(
  db: PrismaService | Prisma.TransactionClient,
  kind: 'customer' | 'supplier',
  companyId: string,
  documents: SettlementDocument[],
): Promise<SettlementJournal[]> {
  const ids = documents.map((d) => d.id).filter(Boolean);
  const journalIds = documents.flatMap((d) => (d.journalEntryId ? [d.journalEntryId] : []));
  if (ids.length === 0 && journalIds.length === 0) return [];
  return db.journalEntry.findMany({
    where: {
      companyId,
      deletedAt: null,
      status: { in: ['POSTED', 'REVERSED'] },
      OR: [
        { referenceType: kind === 'customer' ? 'Receivable' : 'Payable', referenceId: { in: ids } },
        ...(journalIds.length ? [{ id: { in: journalIds } }] : []),
      ],
    },
    select: {
      ...journalSelection,
      reversedBy_: {
        where: { companyId, deletedAt: null, status: 'POSTED' },
        select: journalSelection,
      },
    },
  });
}

/** Recover only linked settlement/write-off/reversal evidence, not invoice creation. */
export function recoverSettlementHistory(args: {
  kind: 'customer' | 'supplier';
  documents: SettlementDocument[];
  journals: SettlementJournal[];
  modernJournalIds: Array<string | null | undefined>;
  completedAllocations: Array<{ documentId: string; amount: Amount }>;
}): { movements: SettlementMovement[]; history: SettlementHistory } {
  const { kind, documents, journals } = args;
  const byId = new Map(documents.filter((d) => d.id).map((d) => [d.id, d]));
  const byCreation = new Map(
    documents.filter((d) => d.journalEntryId).map((d) => [d.journalEntryId!, d]),
  );
  const excluded = new Set(args.modernJournalIds.filter(Boolean));
  const seen = new Set<string>();
  const recoveredPaid = new Map<string, Prisma.Decimal>();
  const movements: SettlementMovement[] = [];
  const gaps: SettlementHistoryGap[] = [];
  let recoveredLegacySettlements = 0;
  const prefix = kind === 'customer' ? 'Receivable' : 'Payable';
  const role = kind === 'customer' ? 'ar_control' : 'ap_control';
  const conventionalCodes = kind === 'customer' ? ['1100', '1110'] : ['2000', '2010', '2100'];

  for (const journal of journals) {
    const document = byId.get(journal.referenceId ?? '') ?? byCreation.get(journal.id);
    if (!document) continue;
    const isPayment = journal.description.startsWith(`${prefix} settlement `);
    const isWriteOff = journal.description.startsWith(`${prefix} write-off `);
    const isCreation = journal.id === document.journalEntryId;
    if (!isPayment && !isWriteOff && !isCreation) continue;
    const entries = [journal, ...(journal.reversedBy_ ?? [])];
    for (const entry of entries) {
      if (seen.has(entry.id) || excluded.has(entry.id)) continue;
      seen.add(entry.id);
      // Invoice creation is represented by its document line. A mixed-tender
      // sale can also contain a proved cash receipt in this very same journal.
      if (entry.id === journal.id && isCreation && !isPayment && !isWriteOff) {
        if (
          kind === 'customer' &&
          entry.referenceType === 'SalesOrder' &&
          (!document.sourceType || document.sourceType === 'SalesOrder') &&
          (!document.sourceId || document.sourceId === entry.referenceId)
        ) {
          const cashCodes = ['1000', '1010', '1020', '1021', '1030'];
          const cashLines = entry.lines.filter(
            (line) =>
              ['cash_on_hand', 'bank'].includes(line.account.accountSubType?.toLowerCase() ?? '') ||
              (!line.account.accountSubType && cashCodes.includes(line.account.accountCode)),
          );
          const arLines = entry.lines.filter(
            (line) =>
              line.account.accountSubType?.toLowerCase() === role ||
              (!line.account.accountSubType &&
                conventionalCodes.includes(line.account.accountCode)),
          );
          const cash = cashLines.reduce(
            (sum, line) => sum.plus(line.debit).minus(line.credit),
            ZERO,
          );
          const ar = arLines.reduce((sum, line) => sum.plus(line.debit).minus(line.credit), ZERO);
          if (cash.gt(0)) {
            const gross = new Prisma.Decimal(document.amount ?? 0);
            const proved =
              ar.gte(0) &&
              [...cashLines, ...arLines].every(
                (line) =>
                  new Prisma.Decimal(line.debit).gte(0) && new Prisma.Decimal(line.credit).isZero(),
              ) &&
              gross.minus(ar).minus(cash).abs().lte('0.01');
            if (proved) {
              recoveredPaid.set(document.id, (recoveredPaid.get(document.id) ?? ZERO).plus(cash));
              recoveredLegacySettlements++;
              movements.push({
                date: entry.transactionDate,
                type: 'ADJUSTMENT',
                reference: entry.journalNumber,
                description: `Initial sale receipt · ${document.reference} · journal ${entry.journalNumber}`,
                sourceId: entry.id,
                debit: ZERO,
                credit: cash,
                balance: ZERO,
              });
            } else {
              gaps.push({
                documentId: document.id,
                reference: document.reference,
                amount: cash.toFixed(2),
                reason: `Sale journal ${entry.journalNumber} does not reconcile gross amount with identified cash and AR`,
              });
            }
          }
        }
        continue;
      }
      const control = entry.lines.filter(
        (line) =>
          line.account.accountSubType?.toLowerCase() === role ||
          (!line.account.accountSubType && conventionalCodes.includes(line.account.accountCode)),
      );
      const delta = control.reduce(
        (sum, line) =>
          kind === 'customer'
            ? sum.plus(line.debit).minus(line.credit)
            : sum.plus(line.credit).minus(line.debit),
        ZERO,
      );
      if (control.length === 0) {
        gaps.push({
          documentId: document.id,
          reference: document.reference,
          amount: '0.00',
          reason: `Journal ${entry.journalNumber} has no identified ${role} line`,
        });
        continue;
      }
      if (delta.isZero()) continue;
      if (isPayment) {
        recoveredPaid.set(document.id, (recoveredPaid.get(document.id) ?? ZERO).minus(delta));
        if (entry.id === journal.id) recoveredLegacySettlements++;
      }
      movements.push({
        date: entry.transactionDate,
        type: 'ADJUSTMENT',
        reference: entry.journalNumber,
        description: `${
          entry.id !== journal.id ? 'Reversal' : isWriteOff ? 'Write-off' : 'Historical settlement'
        } · ${document.reference} · journal ${entry.journalNumber}`,
        sourceId: entry.id,
        debit: delta.gt(0) ? delta : ZERO,
        credit: delta.lt(0) ? delta.negated() : ZERO,
        balance: ZERO,
      });
    }
    if (journal.status === 'REVERSED' && (journal.reversedBy_?.length ?? 0) === 0) {
      gaps.push({
        documentId: document.id,
        reference: document.reference,
        amount: '0.00',
        reason: `Reversed journal ${journal.journalNumber} has no posted dated reversal`,
      });
    }
  }

  const allocated = new Map<string, Prisma.Decimal>();
  for (const allocation of args.completedAllocations) {
    allocated.set(
      allocation.documentId,
      (allocated.get(allocation.documentId) ?? ZERO).plus(allocation.amount),
    );
  }
  for (const document of documents) {
    if (document.paidAmount === undefined) continue;
    const residual = new Prisma.Decimal(document.paidAmount)
      .minus(allocated.get(document.id) ?? ZERO)
      .minus(recoveredPaid.get(document.id) ?? ZERO)
      .toDecimalPlaces(2);
    if (!residual.isZero()) {
      gaps.push({
        documentId: document.id,
        reference: document.reference,
        amount: residual.toFixed(2),
        reason: 'Cumulative paid amount does not reconcile with dated settlement evidence',
      });
    }
    if (
      document.status === 'WRITTEN_OFF' &&
      !journals.some(
        (j) => j.referenceId === document.id && j.description.startsWith(`${prefix} write-off `),
      )
    ) {
      gaps.push({
        documentId: document.id,
        reference: document.reference,
        amount: new Prisma.Decimal(document.amount ?? 0).minus(document.paidAmount).toFixed(2),
        reason: 'Written-off document has no dated write-off journal',
      });
    }
    if (
      document.status === 'CANCELLED' &&
      document.journalEntryId &&
      !movements.some((m) => m.description.startsWith(`Reversal · ${document.reference} ·`))
    ) {
      gaps.push({
        documentId: document.id,
        reference: document.reference,
        amount: new Prisma.Decimal(document.amount ?? 0).toFixed(2),
        reason: 'Cancelled document has no dated accounting reversal',
      });
    }
  }
  return {
    movements,
    history: {
      status: gaps.length ? 'INCOMPLETE' : 'COMPLETE',
      recoveredLegacySettlements,
      unresolvedAmount: gaps
        .reduce((sum, gap) => sum.plus(new Prisma.Decimal(gap.amount).abs()), ZERO)
        .toFixed(2),
      gaps,
    },
  };
}

/** Same movement set for summary, running lines and exports, including end-of-day. */
export function summarizeDatedMovements<
  T extends {
    date: Date;
    debit: Prisma.Decimal;
    credit: Prisma.Decimal;
  },
>(movements: T[], periodStart: Date, periodEnd: Date) {
  let openingBalance = ZERO;
  let totalDebits = ZERO;
  let totalCredits = ZERO;
  const inPeriod: T[] = [];
  for (const movement of movements) {
    if (movement.date > periodEnd) continue;
    if (movement.date < periodStart) {
      openingBalance = openingBalance.plus(movement.debit).minus(movement.credit);
    } else {
      inPeriod.push(movement);
      totalDebits = totalDebits.plus(movement.debit);
      totalCredits = totalCredits.plus(movement.credit);
    }
  }
  return {
    openingBalance,
    totalDebits,
    totalCredits,
    closingBalance: openingBalance.plus(totalDebits).minus(totalCredits),
    inPeriod,
  };
}
