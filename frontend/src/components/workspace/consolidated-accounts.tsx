'use client';

import { useId, useState, type ReactNode } from 'react';
import { Btn, Card, StatusBadge } from '@/components/ui';
import { WorkspaceTable } from '@/components/ui/workspace-table';
import { formatDate } from '@/lib/format';
import { formatAccountMoney } from '@/lib/account-consolidation';
import { RecordBrowser, type RecordField } from './record-browser';

export interface ConsolidatedAccount<T> {
  accountKey: string;
  partyId?: string | null;
  partyName: string;
  partyCode?: string | null;
  companyId: string | null;
  company?: { name: string } | null;
  currency: string;
  documentCount: number;
  openDocumentCount: number;
  amount: number | string;
  paidAmount: number | string;
  outstandingAmount: number | string;
  overdueAmount: number | string;
  nextDueDate?: string | null;
  status: string;
  documents: T[];
}

export function ConsolidationSwitch({
  value,
  onChange,
}: {
  value: boolean;
  onChange: (value: boolean) => void;
}) {
  return (
    <div className="flex gap-1" role="group" aria-label="Account view">
      <Btn
        size="xs"
        variant={value ? 'primary' : 'secondary'}
        aria-pressed={value}
        onClick={() => onChange(true)}
      >
        Consolidated accounts
      </Btn>
      <Btn
        size="xs"
        variant={!value ? 'primary' : 'secondary'}
        aria-pressed={!value}
        onClick={() => onChange(false)}
      >
        Individual transactions
      </Btn>
    </div>
  );
}

/** Account -> transaction -> existing record details and permission-bound actions. */
export function ConsolidatedAccounts<T extends { id: string }>({
  accounts,
  title,
  documentName,
  documentDate,
  documentStatus,
  documentFields = [],
  documentActions,
  loading = false,
  error,
  onRetry,
  page = 1,
  total = accounts.length,
  pageSize = 20,
  onPage,
  showSettlement = true,
  showPaid = true,
  showAging = true,
  totalLabel = 'Total',
}: {
  accounts: ConsolidatedAccount<T>[];
  title: string;
  documentName: (record: T) => string;
  documentDate: (record: T) => string;
  documentStatus: (record: T) => string;
  documentFields?: RecordField<T>[];
  documentActions?: (record: T) => ReactNode;
  loading?: boolean;
  error?: string;
  onRetry?: () => void;
  page?: number;
  total?: number;
  pageSize?: number;
  onPage?: (page: number) => void;
  showSettlement?: boolean;
  showPaid?: boolean;
  showAging?: boolean;
  totalLabel?: string;
}) {
  const [expanded, setExpanded] = useState<string | null>(null);
  const prefix = useId();
  return (
    <Card className="overflow-hidden">
      <div className="p-4 space-y-1">
        <strong>{title}</strong>
        <p className="text-sm" style={{ color: 'var(--aurora-text-muted)' }}>
          Select an account to see every matching transaction. Totals follow your filters and stay
          separate by company and currency.
        </p>
      </div>
      {loading ? (
        <p role="status" className="p-6">
          Loading consolidated accounts…
        </p>
      ) : error ? (
        <div role="alert" className="p-6">
          <p>{error}</p>
          {onRetry && (
            <Btn variant="secondary" onClick={onRetry}>
              Try again
            </Btn>
          )}
        </div>
      ) : accounts.length === 0 ? (
        <p className="p-6">No accounts match your filters.</p>
      ) : (
        <div className="overflow-x-auto">
          <WorkspaceTable className="w-full text-sm" aria-label={title}>
            <thead>
              <tr className="text-left">
                {[
                  'Account',
                  'Company',
                  'Transactions',
                  totalLabel,
                  ...(showSettlement
                    ? [
                        ...(showPaid ? ['Paid / settled'] : []),
                        'Outstanding',
                        ...(showAging ? ['Overdue', 'Next due'] : []),
                      ]
                    : []),
                ].map((label) => (
                  <th scope="col" className="px-4 py-3" key={label}>
                    {label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {accounts.map((account, index) => {
                const open = expanded === account.accountKey;
                const detailsId = `${prefix}-account-${index}`;
                return (
                  <AccountRows
                    key={account.accountKey}
                    account={account}
                    open={open}
                    detailsId={detailsId}
                    showSettlement={showSettlement}
                    showPaid={showPaid}
                    showAging={showAging}
                    onSelect={() => setExpanded(open ? null : account.accountKey)}
                  >
                    <RecordBrowser
                      title="Transactions"
                      records={account.documents}
                      stateKey={`consolidation.${title}.transaction`}
                      selectionScope={account.accountKey}
                      name={documentName}
                      reference={(record) => `ID: ${record.id}`}
                      status={documentStatus}
                      fields={[
                        { label: 'Date', value: (record) => formatDate(documentDate(record)) },
                        ...documentFields.slice(0, 1),
                      ]}
                      details={[
                        { label: 'Transaction ID', value: (record) => record.id },
                        ...documentFields,
                      ]}
                      actions={documentActions}
                    />
                  </AccountRows>
                );
              })}
            </tbody>
          </WorkspaceTable>
        </div>
      )}
      {onPage && total > pageSize && (
        <div className="flex items-center justify-between gap-3 p-4">
          <span>
            {total} accounts · Page {page} of {Math.max(1, Math.ceil(total / pageSize))}
          </span>
          <div className="flex gap-2">
            <Btn
              variant="secondary"
              disabled={page <= 1 || loading}
              onClick={() => onPage(page - 1)}
            >
              Previous
            </Btn>
            <Btn
              variant="secondary"
              disabled={page * pageSize >= total || loading}
              onClick={() => onPage(page + 1)}
            >
              Next
            </Btn>
          </div>
        </div>
      )}
    </Card>
  );
}

function AccountRows<T>({
  account,
  open,
  detailsId,
  onSelect,
  children,
  showSettlement,
  showPaid,
  showAging,
}: {
  account: ConsolidatedAccount<T>;
  open: boolean;
  detailsId: string;
  onSelect: () => void;
  children: ReactNode;
  showSettlement: boolean;
  showPaid: boolean;
  showAging: boolean;
}) {
  return (
    <>
      <tr>
        <td className="px-4 py-3">
          <button
            className="text-left font-semibold"
            aria-label={`View transactions for ${account.partyName}`}
            aria-expanded={open}
            aria-controls={detailsId}
            onClick={onSelect}
          >
            {account.partyName}
          </button>
          <div className="text-xs" style={{ color: 'var(--aurora-text-muted)' }}>
            {account.partyCode || (account.partyId ? 'Linked account' : 'Name-based account')} ·{' '}
            {account.currency}
          </div>
        </td>
        <td className="px-4 py-3">{account.company?.name || account.companyId || 'Private'}</td>
        <td className="px-4 py-3">
          {account.documentCount}{' '}
          {showSettlement && <small>({account.openDocumentCount} open)</small>}
        </td>
        {[
          account.amount,
          ...(showSettlement
            ? [
                ...(showPaid ? [account.paidAmount] : []),
                account.outstandingAmount,
                ...(showAging ? [account.overdueAmount] : []),
              ]
            : []),
        ].map((value, index) => (
          <td className="px-4 py-3 font-mono text-right" key={index}>
            {formatAccountMoney(value, account.currency)}
          </td>
        ))}
        {showSettlement && showAging && (
          <td className="px-4 py-3">
            {formatDate(account.nextDueDate)}
            <StatusBadge status={account.status} />
          </td>
        )}
      </tr>
      {open && (
        <tr id={detailsId}>
          <td
            colSpan={4 + (showSettlement ? Number(showPaid) + 1 + (showAging ? 2 : 0) : 0)}
            className="p-4"
          >
            {children}
          </td>
        </tr>
      )}
    </>
  );
}
