import { createHash } from 'crypto';
import { Prisma } from '@prisma/client';

export interface DeskPostingSource {
  id: string;
  kind: 'sales' | 'purchases';
  companyId: string;
  divisionId: string;
  branchId: string;
  reference: string;
  currency: string;
  date: string;
  amount: string;
  partyId: string;
  voided: boolean;
}
export const sourceReference = (kind: DeskPostingSource['kind']) =>
  kind === 'sales' ? 'DeskSale' : 'DeskPurchase';
export const sourceFingerprint = (source: DeskPostingSource) =>
  createHash('sha256').update(JSON.stringify(source)).digest('hex');

export function postingStatus(
  source: DeskPostingSource,
  journals: Array<{
    id: string;
    status: string;
    description: string | null;
    totalDebit: Prisma.Decimal;
    totalCredit: Prisma.Decimal;
    transactionDate: Date;
    reversalOfId: string | null;
  }>,
) {
  const originals = journals.filter((j) => !j.reversalOfId);
  if (originals.length > 1) return 'Duplicate';
  const journal = originals[0];
  if (!journal) return source.voided ? 'Voided' : 'Unposted';
  if (journal.status !== 'POSTED') return 'Needs review';
  if (
    source.voided ||
    !journal.description?.endsWith(`[desk-source:${sourceFingerprint(source)}]`) ||
    !journal.totalDebit.eq(source.amount) ||
    !journal.totalCredit.eq(source.amount) ||
    journal.transactionDate.toISOString().slice(0, 10) !== source.date
  )
    return 'Changed';
  return 'Posted';
}
