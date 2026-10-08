'use client';

import { Btn } from '@/components/ui';
import { PartyTransactionRegister } from '@/components/workspace/party-transaction-register';
import { formatAccountMoney, type TransactionSnapshot } from '@/lib/account-consolidation';
import type { Invoice, Loan, Movement } from './types';
import { dateLabel, expenseCategories, movementLabels } from './types';

type Query = Record<string, string | number>;
type Paging = { query: Query; revision: number; page: number; onPage: (page: number) => void };

export function cashMovementSnapshot(row: Movement): TransactionSnapshot {
  const companies = [
    ...new Map(row.entries.map(({ account }) => [account.companyId, account.company])).entries(),
  ].sort(([a], [b]) => a.localeCompare(b));
  const counterparty = row.supplier ?? row.customer;
  const account = row.entries[0]?.account;
  return {
    companyId: JSON.stringify(companies.map(([id]) => id)),
    company: { name: companies.map(([, company]) => company.name).join(' / ') },
    partyId: counterparty?.id
      ? JSON.stringify([row.supplier ? 'supplier' : 'customer', counterparty.id])
      : !row.payee && account && row.kind !== 'EXPENSE'
        ? JSON.stringify(['cash-account', account.id])
        : null,
    partyName: counterparty?.name ?? row.payee ?? (row.kind !== 'EXPENSE' ? account?.name : null),
    currency: row.currency,
    amount: row.amount,
    inactive: !!row.reversedAt || !!row.reversalOfId || row.kind === 'REVERSAL',
  };
}

export function CashMovementAccounts({
  endpoint = '/cash-desk/movements',
  title = 'Cash counterparty accounts',
  query,
  revision,
  page,
  onPage,
  onSelect,
}: Paging & { endpoint?: string; title?: string; onSelect: (row: Movement) => void }) {
  return (
    <PartyTransactionRegister<Movement>
      endpoint={endpoint}
      query={query}
      revision={revision}
      requestLimit={null}
      snapshot={cashMovementSnapshot}
      title={title}
      showSettlement={false}
      totalLabel="Recorded cash"
      page={page}
      onPage={onPage}
      pageSize={25}
      documentName={(row) => row.reference || row.description}
      documentDate={(row) => row.businessDate}
      documentStatus={(row) =>
        row.reversedAt || row.reversalOfId ? 'REVERSED' : (movementLabels[row.kind] ?? row.kind)
      }
      documentFields={[
        { label: 'Amount', value: (row) => formatAccountMoney(row.amount, row.currency) },
        { label: 'Description', value: (row) => row.description },
        {
          label: 'Counterparty',
          value: (row) => row.supplier?.name ?? row.customer?.name ?? row.payee ?? 'Unspecified',
        },
        {
          label: 'Cash accounts',
          value: (row) => row.entries.map((entry) => entry.account.name).join(', '),
        },
        {
          label: 'Category',
          value: (row) =>
            expenseCategories[row.expenseCategory ?? ''] ?? movementLabels[row.kind] ?? row.kind,
        },
        { label: 'Notes', value: (row) => row.expenseNotes ?? '' },
        { label: 'Recorded by', value: (row) => row.actorName },
        { label: 'Reversal reason', value: (row) => row.reversalReason ?? '' },
      ]}
      documentActions={(row) => (
        <Btn variant="secondary" onClick={() => onSelect(row)}>
          Open movement details
        </Btn>
      )}
    />
  );
}

const loanSnapshot = (row: Loan): TransactionSnapshot => ({
  companyId: row.lender.companyId,
  company: row.lender.company,
  partyId: row.borrower.companyId,
  partyName: row.borrower.company.name,
  currency: row.currency,
  amount: row.principal,
  outstandingAmount: row.outstanding,
  dueDate: row.dueDate,
  inactive: !!row.voidedAt,
});

export function CashLoanAccounts({
  query,
  revision,
  page,
  onPage,
  onRepay,
}: Paging & { onRepay?: (row: Loan) => void }) {
  return (
    <PartyTransactionRegister<Loan>
      endpoint="/cash-desk/loans"
      query={query}
      revision={revision}
      requestLimit={null}
      snapshot={loanSnapshot}
      title="Intercompany borrower accounts"
      showPaid={false}
      totalLabel="Principal"
      page={page}
      onPage={onPage}
      pageSize={25}
      documentName={(row) => row.description || row.id}
      documentDate={(row) => row.loanDate}
      documentStatus={(row) =>
        row.voidedAt ? 'REVERSED' : /^0(?:\.0+)?$/.test(row.outstanding) ? 'PAID' : 'OPEN'
      }
      documentFields={[
        { label: 'Principal', value: (row) => formatAccountMoney(row.principal, row.currency) },
        { label: 'Outstanding', value: (row) => formatAccountMoney(row.outstanding, row.currency) },
        { label: 'Lender', value: (row) => `${row.lender.company.name} · ${row.lender.name}` },
        {
          label: 'Borrower',
          value: (row) => `${row.borrower.company.name} · ${row.borrower.name}`,
        },
        { label: 'Description', value: (row) => row.description },
        { label: 'Due', value: (row) => (row.dueDate ? dateLabel(row.dueDate) : 'No due date') },
      ]}
      documentActions={(row) =>
        onRepay && !row.voidedAt && !/^0(?:\.0+)?$/.test(row.outstanding) ? (
          <Btn variant="secondary" onClick={() => onRepay(row)}>
            Record repayment
          </Btn>
        ) : null
      }
    />
  );
}

const invoiceSnapshot = (row: Invoice): TransactionSnapshot => ({
  companyId: row.companyId,
  company: row.company,
  partyId: row.supplier.canonicalSupplierId ?? row.supplier.id,
  partyName: row.supplier.name,
  currency: row.currency,
  amount: row.totalAmount,
  paidAmount: row.paidAmount,
  outstandingAmount: row.outstanding,
  dueDate: row.dueDate,
  inactive: !!row.voidedAt,
});

export function CashSupplierInvoiceAccounts({
  query,
  revision,
  page,
  onPage,
  onPay,
}: Paging & { onPay?: (row: Invoice) => void }) {
  return (
    <PartyTransactionRegister<Invoice>
      endpoint="/invoice-desk/invoices"
      query={query}
      revision={revision}
      requestLimit={null}
      snapshot={invoiceSnapshot}
      title="Supplier invoice accounts"
      page={page}
      onPage={onPage}
      pageSize={25}
      documentName={(row) => row.invoiceNumber}
      documentDate={(row) => row.invoiceDate}
      documentStatus={(row) => row.status}
      documentFields={[
        { label: 'Total', value: (row) => formatAccountMoney(row.totalAmount, row.currency) },
        { label: 'Paid', value: (row) => formatAccountMoney(row.paidAmount, row.currency) },
        { label: 'Outstanding', value: (row) => formatAccountMoney(row.outstanding, row.currency) },
        { label: 'Branch', value: (row) => row.branch.name },
        { label: 'Due', value: (row) => dateLabel(row.dueDate) },
        { label: 'Notes', value: (row) => row.notes ?? '' },
      ]}
      documentActions={(row) =>
        onPay && !row.voidedAt && !/^0(?:\.0+)?$/.test(row.outstanding) ? (
          <Btn variant="secondary" onClick={() => onPay(row)}>
            Record payment
          </Btn>
        ) : null
      }
    />
  );
}
