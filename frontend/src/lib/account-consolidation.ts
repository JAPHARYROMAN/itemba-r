import type { ConsolidatedAccount } from '@/components/workspace/consolidated-accounts';

type Money = string | number | null | undefined;
export interface TransactionSnapshot {
  companyId: string | null;
  company?: { name: string } | null;
  partyId?: string | null;
  partyName?: string | null;
  currency: string;
  amount: Money;
  paidAmount?: Money;
  outstandingAmount?: Money;
  dueDate?: string | null;
  inactive?: boolean;
}

interface BusinessTransaction {
  companyId?: string | null;
  company?: { name: string } | null;
  supplierId?: string | null;
  customerId?: string | null;
  supplier?: { id?: string; canonicalSupplierId?: string | null; name?: string | null } | null;
  customer?: { id?: string; canonicalCustomerId?: string | null; name?: string | null } | null;
  supplierName?: string | null;
  customerName?: string | null;
  creditorName?: string | null;
  lenderName?: string | null;
  vendorName?: string | null;
  currency: string;
  amount?: Money;
  totalAmount?: Money;
  principalAmount?: Money;
  paidAmount?: Money;
  amountPaid?: Money;
  outstandingAmount?: Money;
  outstandingBalance?: Money;
  outstanding?: Money;
  dueDate?: string | null;
  maturityDate?: string | null;
  voidedAt?: string | null;
  status: string;
}

export function businessTransactionSnapshot(record: BusinessTransaction): TransactionSnapshot {
  return {
    companyId: record.companyId ?? null,
    company: record.company,
    partyId:
      record.supplier?.canonicalSupplierId ??
      record.customer?.canonicalCustomerId ??
      record.supplierId ??
      record.customerId ??
      record.supplier?.id ??
      record.customer?.id,
    partyName:
      record.supplier?.name ??
      record.customer?.name ??
      record.supplierName ??
      record.customerName ??
      record.creditorName ??
      record.lenderName ??
      record.vendorName,
    currency: record.currency,
    amount: record.totalAmount ?? record.principalAmount ?? record.amount,
    paidAmount: record.paidAmount ?? record.amountPaid,
    outstandingAmount:
      record.outstandingAmount ??
      record.outstandingBalance ??
      record.outstanding ??
      (record.creditorName ? money(cents(record.amount) - cents(record.amountPaid)) : 0),
    dueDate: record.dueDate ?? record.maturityDate,
    inactive:
      !!record.voidedAt || ['CANCELLED', 'VOID', 'VOIDED', 'REJECTED'].includes(record.status),
  };
}

function cents(value: Money): bigint {
  const text = typeof value === 'number' ? value.toFixed(2) : String(value ?? '0');
  const match = /^(-?)(\d+)(?:\.(\d{1,2}))?$/.exec(text);
  if (!match) throw new Error('A transaction has an invalid monetary value.');
  const minor = BigInt(match[2]) * BigInt(100) + BigInt((match[3] ?? '').padEnd(2, '0'));
  return match[1] ? -minor : minor;
}

function money(value: bigint): string {
  const absolute = value < BigInt(0) ? -value : value;
  return `${value < BigInt(0) ? '-' : ''}${absolute / BigInt(100)}.${String(absolute % BigInt(100)).padStart(2, '0')}`;
}

export function formatAccountMoney(value: Money, currency: string): string {
  const [whole, fraction] = money(cents(value)).split('.');
  return `${currency} ${whole.replace(/\B(?=(\d{3})+(?!\d))/g, ',')}.${fraction}`;
}

/** Supplemental transaction registers retain their existing API and full-detail actions. */
export function consolidateTransactions<T extends { id: string }>(
  records: T[],
  snapshot: (record: T) => TransactionSnapshot,
): ConsolidatedAccount<T>[] {
  const today = new Date().toISOString().slice(0, 10);
  const accounts = new Map<
    string,
    {
      account: ConsolidatedAccount<T>;
      amount: bigint;
      paid: bigint;
      outstanding: bigint;
      overdue: bigint;
    }
  >();
  for (const record of records) {
    const row = snapshot(record);
    const partyName = row.partyName?.trim().replace(/\s+/g, ' ') || 'Unspecified party';
    const identity = row.partyId
      ? ['linked', row.partyId]
      : row.partyName?.trim()
        ? ['unlinked', partyName.toLocaleLowerCase('en')]
        : ['record', record.id];
    const accountKey = JSON.stringify([row.companyId, identity, row.currency]);
    let group = accounts.get(accountKey);
    if (!group) {
      group = {
        account: {
          accountKey,
          companyId: row.companyId,
          company: row.company,
          partyId: row.partyId,
          partyName,
          currency: row.currency,
          documentCount: 0,
          openDocumentCount: 0,
          amount: '0.00',
          paidAmount: '0.00',
          outstandingAmount: '0.00',
          overdueAmount: '0.00',
          status: 'PAID',
          documents: [],
        },
        amount: BigInt(0),
        paid: BigInt(0),
        outstanding: BigInt(0),
        overdue: BigInt(0),
      };
      accounts.set(accountKey, group);
    }
    group.account.documents.push(record);
    group.account.documentCount += 1;
    if (row.inactive) continue;
    group.amount += cents(row.amount);
    group.paid += cents(row.paidAmount);
    const outstanding = cents(row.outstandingAmount);
    group.outstanding += outstanding;
    if (outstanding > BigInt(0)) {
      group.account.openDocumentCount += 1;
      if (row.dueDate) {
        if (!group.account.nextDueDate || row.dueDate < group.account.nextDueDate)
          group.account.nextDueDate = row.dueDate;
        if (row.dueDate.slice(0, 10) < today) group.overdue += outstanding;
      }
    }
  }
  return [...accounts.values()]
    .sort((a, b) =>
      a.outstanding === b.outstanding
        ? a.account.partyName.localeCompare(b.account.partyName)
        : a.outstanding > b.outstanding
          ? -1
          : 1,
    )
    .map(({ account, amount, paid, outstanding, overdue }) => ({
      ...account,
      amount: money(amount),
      paidAmount: money(paid),
      outstandingAmount: money(outstanding),
      overdueAmount: money(overdue),
      status:
        outstanding <= BigInt(0)
          ? 'PAID'
          : overdue > BigInt(0)
            ? 'OVERDUE'
            : paid > BigInt(0)
              ? 'PARTIALLY_PAID'
              : 'OPEN',
    }));
}
