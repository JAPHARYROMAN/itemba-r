import { backendGet } from '@/lib/api-client';
import { consolidateTransactions } from '@/lib/account-consolidation';
import type { OutstandingSale, SalesConnection } from './cash-sales-connection';

/** A customer account must include every page, even when its documents straddle pages. */
export async function loadSalesConnection(
  query: Record<string, string | number>,
  signal: AbortSignal,
): Promise<SalesConnection> {
  const first = await backendGet<SalesConnection>('/cash-desk/sales-connection', {
    query: { ...query, page: 1 },
    signal,
  });
  const outstanding: OutstandingSale[] = [];
  const receipts: SalesConnection['receipts']['rows'] = [];
  const seenOutstanding = new Set<string>();
  const seenReceipts = new Set<string>();
  const append = (result: SalesConnection) => {
    if (
      result.pageSize !== first.pageSize ||
      result.outstanding.total !== first.outstanding.total ||
      result.receipts.total !== first.receipts.total
    )
      throw new Error('Collections changed while loading. Refresh to recalculate accounts.');
    for (const row of result.outstanding.rows) {
      const key = `${row.source ?? 'RECEIVABLE'}:${row.id}`;
      if (seenOutstanding.has(key))
        throw new Error('Collections changed while loading. Refresh to recalculate accounts.');
      seenOutstanding.add(key);
      outstanding.push(row);
    }
    for (const row of result.receipts.rows) {
      if (seenReceipts.has(row.id))
        throw new Error('Collections changed while loading. Refresh to recalculate accounts.');
      seenReceipts.add(row.id);
      receipts.push(row);
    }
  };
  if (!Number.isInteger(first.pageSize) || first.pageSize < 1)
    throw new Error('Unable to read complete collections.');
  append(first);
  const pages = Math.ceil(Math.max(first.outstanding.total, first.receipts.total) / first.pageSize);
  for (let page = 2; page <= pages; page += 1) {
    signal.throwIfAborted();
    append(
      await backendGet<SalesConnection>('/cash-desk/sales-connection', {
        query: { ...query, page },
        signal,
      }),
    );
  }
  if (outstanding.length !== first.outstanding.total || receipts.length !== first.receipts.total)
    throw new Error('Unable to load every collection. Refresh to try again.');
  return {
    ...first,
    outstanding: { ...first.outstanding, rows: outstanding },
    receipts: { ...first.receipts, rows: receipts },
  };
}

export function outstandingAccounts(rows: OutstandingSale[]) {
  // Informal NoteBook debt keeps its own ledger and never inflates formal receivables.
  return [false, true].flatMap((notebook) =>
    consolidateTransactions(
      rows.filter((row) => (row.source === 'NOTEBOOK') === notebook),
      (row) => ({
        companyId: row.companyId,
        company: row.company,
        partyId: row.customerId,
        partyName: row.customerName,
        currency: row.currency,
        amount: row.amount,
        paidAmount: row.paidAmount,
        outstandingAmount: row.outstandingAmount,
        dueDate: row.dueDate,
      }),
    ).map((account) => ({
      ...account,
      accountKey: `${notebook ? 'notebook' : 'business'}:${account.accountKey}`,
      partyName: account.partyName + (notebook ? ' · NoteBook' : ''),
    })),
  );
}

export function receiptAccounts(rows: SalesConnection['receipts']['rows']) {
  return consolidateTransactions(rows, (row) => ({
    companyId: row.companyId,
    company: row.company,
    partyId: row.customerId,
    partyName: row.customer,
    currency: row.currency,
    amount: row.amount,
  }));
}
