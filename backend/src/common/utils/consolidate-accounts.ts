import { Prisma } from '@prisma/client';
import { pagination } from './pagination';

type Money = Prisma.Decimal | string | number | null | undefined;
export interface AccountDocument<T> {
  record: T;
  id: string;
  companyId: string | null;
  ownerId?: string;
  company?: { name: string } | null;
  kind?: string;
  partyId?: string | null;
  partyName?: string | null;
  partyCode?: string | null;
  currency: string;
  amount: Money;
  paidAmount?: Money;
  outstandingAmount?: Money;
  issueDate?: Date | string | null;
  dueDate?: Date | string | null;
  inactive?: boolean;
}

/** Group the complete authorized result before paginating accounts. Never join different
 * party IDs by name, companies, currencies, or personal and business records. */
export function consolidateAccounts<T>(records: AccountDocument<T>[], now = new Date()) {
  const today = new Date(`${now.toISOString().slice(0, 10)}T00:00:00Z`);
  const decimal = (value: Money) => new Prisma.Decimal(value ?? 0);
  const date = (value?: Date | string | null) => (value ? new Date(value) : null);
  const groups = new Map<
    string,
    {
      accountKey: string;
      companyId: string | null;
      company: { name: string } | null;
      partyId: string | null;
      partyName: string;
      partyCode: string | null;
      currency: string;
      documentCount: number;
      openDocumentCount: number;
      overdueCount: number;
      amount: Prisma.Decimal;
      paidAmount: Prisma.Decimal;
      outstandingAmount: Prisma.Decimal;
      overdueAmount: Prisma.Decimal;
      oldestIssueDate: Date | null;
      lastIssueDate: Date | null;
      nextDueDate: Date | null;
      documents: T[];
    }
  >();
  for (const item of records) {
    const name = item.partyName?.trim().replace(/\s+/g, ' ') || 'Unspecified party';
    const identity = item.partyId
      ? ['linked', item.partyId]
      : item.partyName?.trim()
        ? ['unlinked', name.toLocaleLowerCase('en')]
        : ['record', item.id];
    const accountKey = JSON.stringify([
      item.companyId ?? ['personal', item.ownerId],
      item.kind ?? '',
      identity,
      item.currency,
    ]);
    let group = groups.get(accountKey);
    if (!group) {
      group = {
        accountKey,
        companyId: item.companyId,
        company: item.company ?? null,
        partyId: item.partyId ?? null,
        partyName: name,
        partyCode: item.partyCode ?? null,
        currency: item.currency,
        documentCount: 0,
        openDocumentCount: 0,
        overdueCount: 0,
        amount: decimal(0),
        paidAmount: decimal(0),
        outstandingAmount: decimal(0),
        overdueAmount: decimal(0),
        oldestIssueDate: null,
        lastIssueDate: null,
        nextDueDate: null,
        documents: [],
      };
      groups.set(accountKey, group);
    }
    group.documents.push(item.record);
    group.documentCount += 1;
    const issued = date(item.issueDate);
    if (issued && (!group.oldestIssueDate || issued < group.oldestIssueDate))
      group.oldestIssueDate = issued;
    if (issued && (!group.lastIssueDate || issued > group.lastIssueDate))
      group.lastIssueDate = issued;
    // Cancelled/void documents remain inspectable but contribute no monetary balance.
    if (item.inactive) continue;
    const outstanding = decimal(item.outstandingAmount);
    group.amount = group.amount.plus(decimal(item.amount));
    group.paidAmount = group.paidAmount.plus(decimal(item.paidAmount));
    group.outstandingAmount = group.outstandingAmount.plus(outstanding);
    if (outstanding.gt(0)) {
      group.openDocumentCount += 1;
      const due = date(item.dueDate);
      if (due && (!group.nextDueDate || due < group.nextDueDate)) group.nextDueDate = due;
      if (due && due < today) {
        group.overdueCount += 1;
        group.overdueAmount = group.overdueAmount.plus(outstanding);
      }
    }
  }
  return [...groups.values()]
    .sort(
      (a, b) =>
        b.outstandingAmount.comparedTo(a.outstandingAmount) ||
        a.partyName.localeCompare(b.partyName) ||
        a.accountKey.localeCompare(b.accountKey),
    )
    .map((group) => ({
      ...group,
      status: group.outstandingAmount.lte(0)
        ? 'PAID'
        : group.overdueAmount.gt(0)
          ? 'OVERDUE'
          : group.paidAmount.gt(0)
            ? 'PARTIALLY_PAID'
            : 'OPEN',
      amount: group.amount.toDecimalPlaces(2).toNumber(),
      paidAmount: group.paidAmount.toDecimalPlaces(2).toNumber(),
      outstandingAmount: group.outstandingAmount.toDecimalPlaces(2).toNumber(),
      overdueAmount: group.overdueAmount.toDecimalPlaces(2).toNumber(),
    }));
}

export function accountPage<T>(data: T[], query: { page?: number; limit?: number }) {
  const paging = pagination({ page: query.page ?? 1, limit: query.limit ?? 20 });
  return {
    data: data.slice(paging.skip, paging.skip + paging.limit),
    total: data.length,
    page: paging.page,
    limit: paging.limit,
    totalPages: Math.ceil(data.length / paging.limit),
  };
}
