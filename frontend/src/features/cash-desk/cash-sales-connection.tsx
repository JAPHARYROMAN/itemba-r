'use client';

import { useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from 'react';
import { Btn } from '@/components/ui';
import { WorkspaceLink as Link } from '@/components/workspace/workspace-navigation';
import { useLinkedDeskChanges, notifyDeskSaved } from '@/components/workspace/linked-desk-changes';
import { useWorkspaceResource } from '@/hooks/use-workspace-resource';
import { useAuth } from '@/hooks/use-auth';
import { RecordSalesOrderPaymentModal } from '@/app/(dashboard)/operations/_components/record-sales-order-payment-modal';
import { money, dateLabel, type Scope } from './types';
import { PartyCard } from '@/features/party/party-card';
import {
  ConsolidatedAccounts,
  ConsolidationSwitch,
} from '@/components/workspace/consolidated-accounts';
import { formatAccountMoney } from '@/lib/account-consolidation';
import {
  loadSalesConnection,
  outstandingAccounts,
  receiptAccounts,
} from './cash-sales-consolidation';

export type OutstandingSale = {
  id: string;
  /** Party linkage (Phase 2): a receivable (default), a Sales Desk sale or a NoteBook debtor. */
  source?: 'RECEIVABLE' | 'SALES_DESK' | 'NOTEBOOK';
  customerId?: string | null;
  deskSaleId?: string | null;
  recordId?: string | null;
  saleNumber?: string | null;
  companyId: string;
  company?: { name: string } | null;
  divisionId: string | null;
  branchId: string | null;
  customerName: string;
  receivableNumber: string;
  salesOrderNumber: string | null;
  saleId: string | null;
  currency: string;
  amount: string;
  outstandingAmount: string;
  paidAmount: string;
  dueDate: string | null;
  branch: { name: string } | null;
};
export type SalesConnection = {
  date: string;
  page: number;
  pageSize: number;
  accountsVisible: boolean;
  receiptsVisible: boolean;
  currencies: {
    currency: string;
    balance: string | null;
    outstanding: string;
    received: string | null;
    /** NoteBook debtors linked to a customer; informal, never part of `outstanding`. */
    notebook?: string | null;
  }[];
  accounts: {
    id: string;
    accountName: string;
    accountType: string;
    currency: string;
    currentBalance: string;
    isActive: boolean;
    company: { name: string };
    branch: { name: string } | null;
  }[];
  outstanding: { total: number; rows: OutstandingSale[] };
  receipts: {
    total: number;
    rows: {
      id: string;
      date: string;
      reference: string;
      customer: string;
      customerId?: string | null;
      companyId: string;
      company?: { name: string } | null;
      amount: string;
      currency: string;
      account: string | null;
      saleId: string | null;
      kind: string;
    }[];
  };
};

const sourceLabels = { RECEIVABLE: 'Receivable', SALES_DESK: 'Sales Desk', NOTEBOOK: 'NoteBook' };

export function CashSalesConnection({
  scope,
  date,
  revision,
  compact = false,
  onOpen,
}: {
  scope: Scope;
  date: string;
  revision: number;
  compact?: boolean;
  onOpen?: () => void;
}) {
  const { hasPermission } = useAuth();
  const allowed = ['cash_desk.view', 'sales.view', 'receivables.view'].every((p) =>
    hasPermission(p),
  );
  const [tab, setTab] = useState<'outstanding' | 'receipts' | 'accounts'>('outstanding');
  const [consolidated, setConsolidated] = useState(true);
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const deferredSearch = useDeferredValue(search);
  const [paying, setPaying] = useState<OutstandingSale | null>(null);
  const [peek, setPeek] = useState<string | null>(null);
  const query = Object.fromEntries(Object.entries(scope).filter(([, value]) => value));
  const scopeKey = JSON.stringify(query);
  const readAccounts = useCallback(
    (signal: AbortSignal) =>
      loadSalesConnection(
        {
          ...JSON.parse(scopeKey),
          date,
          search: deferredSearch,
        },
        signal,
      ),
    [scopeKey, date, deferredSearch],
  );
  const data = useWorkspaceResource<SalesConnection>(
    '/cash-desk/sales-connection',
    {
      ...query,
      date,
      page: consolidated ? 1 : page,
      search: deferredSearch,
    },
    allowed,
    !compact && consolidated ? readAccounts : undefined,
  );
  const { reload } = data;
  const previousRevision = useRef(revision);
  useEffect(() => {
    if (!paying && previousRevision.current !== revision) {
      previousRevision.current = revision;
      reload();
    }
  }, [revision, reload, paying]);
  useLinkedDeskChanges('cash-desk', !!paying, data.reload);
  const accounts = useMemo(() => {
    try {
      return {
        outstanding: outstandingAccounts(data.data?.outstanding.rows ?? []),
        receipts: receiptAccounts(data.data?.receipts.rows ?? []),
      };
    } catch (error) {
      return {
        outstanding: [],
        receipts: [],
        error: error instanceof Error ? error.message : 'Unable to consolidate collections.',
      };
    }
  }, [data.data]);
  if (!allowed) return null;
  const info = data.data;
  return (
    <section className="cash-sales-connection" aria-label="Sales Desk connection">
      <div className="cash-section-title">
        <div>
          <h2>Sales Desk collections</h2>
          <p>The same sales, receivables and receipt accounts as Sales Desk.</p>
        </div>
        {compact ? (
          <Btn variant="secondary" onClick={onOpen}>
            Open collections
          </Btn>
        ) : (
          <Link className="desk-text-button" href="/sales-desk?view=sales">
            Open Sales Desk →
          </Link>
        )}
      </div>
      {data.error ? (
        <p role="alert" className="desk-error">
          {data.error} <button onClick={data.reload}>Retry</button>
        </p>
      ) : data.loading ? (
        <p role="status">Loading sales collections…</p>
      ) : (
        <>
          <div className="cash-connected-totals">
            {info?.currencies.map((c) => (
              <div key={c.currency}>
                <strong>{c.currency}</strong>
                <dl>
                  <div>
                    <dt>Business account balances now</dt>
                    <dd>
                      {c.balance === null
                        ? 'Cash account access required'
                        : money(c.balance, c.currency)}
                    </dd>
                  </div>
                  <div>
                    <dt>Collected · {dateLabel(date)}</dt>
                    <dd>
                      {c.received === null
                        ? 'Customer payment access required'
                        : money(c.received, c.currency)}
                    </dd>
                  </div>
                  <div>
                    <dt>Customers still owe</dt>
                    <dd>{money(c.outstanding, c.currency)}</dd>
                  </div>
                  {c.notebook != null && (
                    <div>
                      <dt>NoteBook debtors (informal)</dt>
                      <dd>{money(c.notebook, c.currency)}</dd>
                    </div>
                  )}
                </dl>
              </div>
            ))}
            {info && !info.currencies.length && (
              <p>No business account balances or outstanding sales in this scope.</p>
            )}
          </div>
          <p className="cash-connection-note">
            Business account balances already include recorded collections. Do not enter them again
            as a manual daily sales total. The other Cash Desk sections hold Direct entries and
            their desk accounts.
          </p>
        </>
      )}
      {!compact && (
        <>
          <div className="cash-toolbar" role="group" aria-label="Sales collections view">
            {(['outstanding', 'receipts', 'accounts'] as const).map((value) => (
              <Btn
                key={value}
                variant={tab === value ? 'primary' : 'secondary'}
                aria-pressed={tab === value}
                onClick={() => {
                  setTab(value);
                  setPage(1);
                  setSearch('');
                }}
              >
                {
                  {
                    outstanding: 'Outstanding sales',
                    receipts: 'Collected payments',
                    accounts: 'Business accounts',
                  }[value]
                }
              </Btn>
            ))}
          </div>
          {tab === 'outstanding' && (
            <label className="cash-search">
              Search outstanding sales
              <input
                aria-label="Search outstanding sales"
                value={search}
                onChange={(e) => {
                  setSearch(e.target.value);
                  setPage(1);
                }}
                placeholder="Customer or sale number"
              />
            </label>
          )}
          {tab !== 'accounts' && (
            <ConsolidationSwitch
              value={consolidated}
              onChange={(value) => {
                setConsolidated(value);
                setPage(1);
              }}
            />
          )}
          {consolidated && !data.loading && !data.error && info && tab === 'outstanding' && (
            <ConsolidatedAccounts
              accounts={accounts.outstanding.slice((page - 1) * 25, page * 25)}
              title="Outstanding customer accounts"
              total={accounts.outstanding.length}
              page={page}
              pageSize={25}
              onPage={setPage}
              error={accounts.error}
              onRetry={data.reload}
              documentName={(row) =>
                row.salesOrderNumber ?? row.saleNumber ?? row.receivableNumber ?? row.id
              }
              documentDate={(row) => row.dueDate ?? ''}
              documentStatus={(row) => sourceLabels[row.source ?? 'RECEIVABLE']}
              documentFields={[
                { label: 'Customer', value: (row) => row.customerName },
                { label: 'Source', value: (row) => sourceLabels[row.source ?? 'RECEIVABLE'] },
                { label: 'Branch', value: (row) => row.branch?.name ?? 'Company' },
                {
                  label: 'Owed',
                  value: (row) => formatAccountMoney(row.outstandingAmount, row.currency),
                },
                {
                  label: 'Received',
                  value: (row) => formatAccountMoney(row.paidAmount, row.currency),
                },
                {
                  label: 'Due',
                  value: (row) => (row.dueDate ? dateLabel(row.dueDate) : 'No due date'),
                },
              ]}
              documentActions={(row) => (
                <>
                  {(row.saleId || row.deskSaleId) && (
                    <Link
                      className="desk-text-button"
                      href={`/sales-desk/sales/${encodeURIComponent(row.saleId ?? row.deskSaleId ?? '')}`}
                    >
                      View sale
                    </Link>
                  )}
                  {row.recordId && (
                    <Link
                      className="desk-text-button"
                      href={`/records?record=${encodeURIComponent(row.recordId)}`}
                    >
                      Open NoteBook
                    </Link>
                  )}
                  {row.customerId && hasPermission('customers.view') && (
                    <Btn variant="secondary" onClick={() => setPeek(row.customerId ?? null)}>
                      Peek customer
                    </Btn>
                  )}
                  {(row.source ?? 'RECEIVABLE') === 'RECEIVABLE' &&
                    hasPermission('receivables.manage') && (
                      <Btn
                        onClick={() => setPaying(row)}
                        aria-label={`Collect payment for ${row.salesOrderNumber ?? row.receivableNumber}`}
                      >
                        Collect payment
                      </Btn>
                    )}
                </>
              )}
            />
          )}
          {consolidated &&
            !data.loading &&
            !data.error &&
            info &&
            tab === 'receipts' &&
            info.receiptsVisible && (
              <ConsolidatedAccounts
                accounts={accounts.receipts.slice((page - 1) * 25, page * 25)}
                title="Collected customer accounts"
                showSettlement={false}
                totalLabel="Collected"
                total={accounts.receipts.length}
                page={page}
                pageSize={25}
                onPage={setPage}
                error={accounts.error}
                onRetry={data.reload}
                documentName={(row) => row.reference}
                documentDate={(row) => row.date}
                documentStatus={(row) => row.kind}
                documentFields={[
                  { label: 'Customer', value: (row) => row.customer },
                  { label: 'Amount', value: (row) => formatAccountMoney(row.amount, row.currency) },
                  {
                    label: 'Receipt account',
                    value: (row) => row.account ?? 'Receipt account not available in this history',
                  },
                  { label: 'Kind', value: (row) => row.kind },
                ]}
                documentActions={(row) =>
                  row.saleId ? (
                    <Link
                      className="desk-text-button"
                      href={`/sales-desk/sales/${encodeURIComponent(row.saleId)}`}
                    >
                      View sale
                    </Link>
                  ) : null
                }
              />
            )}
          {!data.loading && !data.error && info && (
            <>
              {tab === 'outstanding' && !consolidated && (
                <div className="cash-collection-list">
                  {info.outstanding.rows.map((r) => (
                    <article key={`${r.source ?? 'RECEIVABLE'}:${r.id}`}>
                      <div>
                        <strong>
                          {r.customerId && hasPermission('customers.view') ? (
                            <Link
                              href={`/sales-desk/customers/${encodeURIComponent(r.customerId)}`}
                            >
                              {r.customerName}
                            </Link>
                          ) : (
                            r.customerName
                          )}
                        </strong>
                        {r.customerId && hasPermission('customers.view') && (
                          <button
                            type="button"
                            className="cash-peek"
                            onClick={() => setPeek(r.customerId ?? null)}
                          >
                            Peek
                          </button>
                        )}
                        <p>
                          {sourceLabels[r.source ?? 'RECEIVABLE']} ·{' '}
                          {r.salesOrderNumber ?? r.saleNumber ?? r.receivableNumber} ·{' '}
                          {r.branch?.name ?? 'Company'}
                          {r.dueDate ? ` · Due ${dateLabel(r.dueDate)}` : ''}
                        </p>
                      </div>
                      <div>
                        <strong>{money(r.outstandingAmount, r.currency)} owed</strong>
                        <p>{money(r.paidAmount, r.currency)} received</p>
                      </div>
                      <div className="cash-collection-actions">
                        {(r.saleId || r.deskSaleId) && (
                          <Link
                            className="desk-text-button"
                            href={`/sales-desk/sales/${encodeURIComponent(r.saleId ?? r.deskSaleId ?? '')}`}
                          >
                            View sale
                          </Link>
                        )}
                        {r.recordId && (
                          <Link
                            className="desk-text-button"
                            href={`/records?record=${encodeURIComponent(r.recordId)}`}
                          >
                            Open NoteBook
                          </Link>
                        )}
                        {(r.source ?? 'RECEIVABLE') === 'RECEIVABLE' &&
                          hasPermission('receivables.manage') && (
                            <Btn
                              onClick={() => setPaying(r)}
                              aria-label={`Collect payment for ${r.salesOrderNumber ?? r.receivableNumber}`}
                            >
                              Collect payment
                            </Btn>
                          )}
                      </div>
                    </article>
                  ))}
                  {!info.outstanding.rows.length && <p>No outstanding sales match this view.</p>}
                </div>
              )}
              {tab === 'receipts' &&
                !consolidated &&
                (info.receiptsVisible ? (
                  <div className="cash-collection-list">
                    <p>
                      Posted cash sales and payments allocated to these sales on {dateLabel(date)}.
                      Reversed receipts are excluded. Earlier receipts may only identify their
                      posting reference.
                    </p>
                    {info.receipts.rows.map((r) => (
                      <article key={r.id}>
                        <div>
                          <strong>{r.customer}</strong>
                          <p>
                            {r.kind} · {r.reference}
                          </p>
                          <p>{r.account ?? 'Receipt account not available in this history'}</p>
                        </div>
                        <strong>{money(r.amount, r.currency)}</strong>
                        {r.saleId && (
                          <Link
                            className="desk-text-button"
                            href={`/sales-desk/sales/${encodeURIComponent(r.saleId)}`}
                          >
                            View sale
                          </Link>
                        )}
                      </article>
                    ))}
                    {!info.receipts.rows.length && <p>No posted sale collections for this date.</p>}
                  </div>
                ) : (
                  <p>
                    Customer payment viewing permission is required to see the complete receipt
                    history.
                  </p>
                ))}
              {tab === 'accounts' &&
                (info.accountsVisible ? (
                  <div className="cash-account-grid">
                    {info.accounts.map((a) => (
                      <article className="cash-account" key={a.id}>
                        <h3>{a.accountName}</h3>
                        <p>
                          {a.company.name} · {a.branch?.name ?? 'Company account'}
                        </p>
                        <p>
                          {a.accountType.replaceAll('_', ' ')}
                          {!a.isActive ? ' · Inactive' : ''}
                        </p>
                        <strong>{money(a.currentBalance, a.currency)}</strong>
                      </article>
                    ))}
                    {!info.accounts.length && <p>No business receipt accounts in this scope.</p>}
                  </div>
                ) : (
                  <p>
                    Cash account viewing permission is required to see business receipt accounts.
                  </p>
                ))}
              {tab === 'receipts' && consolidated && !info.receiptsVisible && (
                <p>
                  Customer payment viewing permission is required to see the complete receipt
                  history.
                </p>
              )}
              {tab !== 'accounts' && !consolidated && (
                <div className="cash-toolbar" aria-label="Collections pagination">
                  <Btn variant="secondary" disabled={page <= 1} onClick={() => setPage(page - 1)}>
                    Previous
                  </Btn>
                  <span>
                    Page {page} · {info[tab].total} records
                  </span>
                  <Btn
                    variant="secondary"
                    disabled={page * info.pageSize >= info[tab].total}
                    onClick={() => setPage(page + 1)}
                  >
                    Next
                  </Btn>
                </div>
              )}
            </>
          )}
        </>
      )}
      {paying && (
        <RecordSalesOrderPaymentModal
          receivableId={paying.id}
          companyId={paying.companyId}
          divisionId={paying.divisionId}
          branchId={paying.branchId}
          currency={paying.currency}
          outstanding={Number(paying.outstandingAmount)}
          orderLabel={paying.salesOrderNumber ?? paying.receivableNumber}
          onClose={() => setPaying(null)}
          onSaved={() => {
            setPaying(null);
            data.reload();
            notifyDeskSaved('cash-desk');
          }}
        />
      )}
      {peek && <PartyCard kind="customer" partyId={peek} onClose={() => setPeek(null)} />}
    </section>
  );
}
