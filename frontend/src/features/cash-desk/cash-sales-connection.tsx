'use client';

import { useDeferredValue, useEffect, useRef, useState } from 'react';
import { Btn } from '@/components/ui';
import { WorkspaceLink as Link } from '@/components/workspace/workspace-navigation';
import { useLinkedDeskChanges, notifyDeskSaved } from '@/components/workspace/linked-desk-changes';
import { useWorkspaceResource } from '@/hooks/use-workspace-resource';
import { useAuth } from '@/hooks/use-auth';
import { RecordSalesOrderPaymentModal } from '@/app/(dashboard)/operations/_components/record-sales-order-payment-modal';
import { money, dateLabel, type Scope } from './types';

type OutstandingSale = {
  id: string;
  companyId: string;
  divisionId: string | null;
  branchId: string | null;
  customerName: string;
  receivableNumber: string;
  salesOrderNumber: string | null;
  saleId: string | null;
  currency: string;
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
      amount: string;
      currency: string;
      account: string | null;
      saleId: string | null;
      kind: string;
    }[];
  };
};

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
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const deferredSearch = useDeferredValue(search);
  const [paying, setPaying] = useState<OutstandingSale | null>(null);
  const query = Object.fromEntries(Object.entries(scope).filter(([, value]) => value));
  const data = useWorkspaceResource<SalesConnection>(
    '/cash-desk/sales-connection',
    {
      ...query,
      date,
      page,
      search: deferredSearch,
    },
    allowed,
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
          {!data.loading && !data.error && info && (
            <>
              {tab === 'outstanding' && (
                <div className="cash-collection-list">
                  {info.outstanding.rows.map((r) => (
                    <article key={r.id}>
                      <div>
                        <strong>{r.customerName}</strong>
                        <p>
                          {r.salesOrderNumber ?? r.receivableNumber} · {r.branch?.name ?? 'Company'}
                          {r.dueDate ? ` · Due ${dateLabel(r.dueDate)}` : ''}
                        </p>
                      </div>
                      <div>
                        <strong>{money(r.outstandingAmount, r.currency)} owed</strong>
                        <p>{money(r.paidAmount, r.currency)} received</p>
                      </div>
                      <div className="cash-collection-actions">
                        {r.saleId && (
                          <Link
                            className="desk-text-button"
                            href={`/sales-desk/sales/${encodeURIComponent(r.saleId)}`}
                          >
                            View sale
                          </Link>
                        )}
                        {hasPermission('receivables.manage') && (
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
              {tab !== 'accounts' && (
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
    </section>
  );
}
