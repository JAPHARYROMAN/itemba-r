'use client';
import { useWorkspaceState } from '@/components/workspace/workspace-session';
import {
  AccountingDraftBoundary,
  useAccountingEditor,
  useAccountingRefresh,
  useAccountingStateKey,
} from './accounting-drafts';
import {
  movementLabel as label,
  type Connections,
  type Movement,
  type UnlinkedPayment,
} from './accounting-types';
import { WorkspaceLink as Link } from '@/components/workspace/workspace-navigation';
import { useAuth } from '@/hooks/use-auth';
import { Btn } from '@/components/ui';
import { useWorkspaceResource } from '@/hooks/use-workspace-resource';
import { money, type Directory } from '@/features/invoice-desk/types';
import { AnalysisFilterForm, useAnalysisFilters } from './analysis-filters';

export function CashAccounting({ connections }: { connections: boolean }) {
  return (
    <AccountingDraftBoundary>
      <CashAccountingWorkspace connections={connections} />
    </AccountingDraftBoundary>
  );
}
function CashAccountingWorkspace({ connections }: { connections: boolean }) {
  const { hasPermission } = useAuth(),
    { filters, query, apply } = useAnalysisFilters('accounting');
  const allowed = hasPermission('cash_desk.view') && hasPermission('journal_entries.view');
  const directory = useWorkspaceResource<Directory>('/cash-desk/directory', {}, allowed);
  return (
    <section className="accounting-readiness">
      <header className="reports-heading">
        <p className="reports-eyebrow">ITEMBA OS · ACCOUNTING</p>
        <h1>{connections ? 'Every account, connected.' : 'Follow the money.'}</h1>
        <p>
          {connections
            ? 'Connect each cash or bank account to its own place in the ledger.'
            : 'Review cash receipts, payments and transfers before they enter the books.'}
        </p>
      </header>
      <div className="accounting-links">
        <Link href="/cash-desk">Open Cash Desk →</Link>
        <Link href="/accounting-engine/bank-reconciliations">Reconcile statements →</Link>
        <Link href="/finance/journal-entries">Journal entries →</Link>
      </div>
      {!allowed ? (
        <p>Your role needs Cash Desk and journal access.</p>
      ) : (
        <>
          <details>
            <summary>Change period & organisation</summary>
            <AnalysisFilterForm
              key={JSON.stringify(filters)}
              value={filters}
              directory={directory.data}
              onApply={(v) => apply(v, connections ? 'connections' : 'cash')}
            />
          </details>
          {connections ? <AccountConnections query={query} /> : <CashMovements query={query} />}
        </>
      )}
    </section>
  );
}
function AccountConnections({ query }: { query: Record<string, string> }) {
  const { hasPermission } = useAuth();
  const resource = useWorkspaceResource<Connections>('/cash-connections/accounts', query);
  const open = useAccountingEditor();
  useAccountingRefresh(resource.reload);
  const canManage = hasPermission('cash_desk.manage') && hasPermission('cash_accounts.manage');
  const data = resource.data;
  return (
    <>
      <p className="accounting-note">
        Connections identify the same physical cash box or bank account. They do not move money,
        copy opening balances or post old records. Each bank account uses a separate asset ledger
        account. Saved connections cannot be reassigned here.
      </p>
      {resource.loading && <p role="status">Loading account connections…</p>}
      {resource.error && <p role="alert">{resource.error}</p>}
      <div>
        <Btn variant="secondary" onClick={resource.reload}>
          Refresh connections
        </Btn>
      </div>

      <div
        className="accounting-table"
        role="region"
        aria-label="Cash Desk account connections"
        tabIndex={0}
      >
        <table>
          <thead>
            <tr>
              <th>Cash Desk account</th>
              <th>Organisation</th>
              <th>Cash / bank account</th>
              <th>Ledger account</th>
              <th>Action</th>
            </tr>
          </thead>
          <tbody>
            {data?.desk.map((d) => {
              const bank = data.bank.find((b) => b.id === d.erpCashAccountId);
              return (
                <tr key={d.id}>
                  <td>
                    <strong>{d.name}</strong>
                    <br />
                    {d.currency}
                  </td>
                  <td>
                    {d.company.name}
                    <br />
                    {d.branch.name}
                  </td>
                  <td>
                    {bank?.accountName ||
                      (d.erpCashAccountId ? 'Unavailable account' : 'Not connected')}
                  </td>
                  <td>
                    {bank?.ledgerAccount
                      ? `${bank.ledgerAccount.accountCode} · ${bank.ledgerAccount.accountName}`
                      : 'Not connected'}
                  </td>
                  <td>
                    {!d.erpCashAccountId && (
                      <button
                        onClick={() =>
                          open({ kind: 'account-connection', accountKind: 'desk', id: d.id, query })
                        }
                      >
                        {canManage && d.canConnect ? 'Connect' : 'Review'} {d.name}
                      </button>
                    )}
                  </td>
                </tr>
              );
            })}
            {!resource.loading && !resource.error && !data?.desk.length && (
              <tr>
                <td colSpan={5}>
                  No Cash Desk accounts in this organisation.{' '}
                  <Link href="/cash-desk">Create an account in Cash Desk.</Link>
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      <h2 className="cash-connection-title">Bank and cash ledger mappings</h2>
      <p>
        These mappings also support statement reconciliation for accounts used outside Cash Desk.
      </p>
      <p className="accounting-note">
        Recorded balances come from cash account records. Ledger balances include all posted entries
        and reversals, across all dates. Differences need review against opening balances and
        movements recorded in each app; matching amounts alone do not confirm reconciliation.
      </p>
      <div
        className="accounting-table"
        role="region"
        aria-label="Bank and cash ledger mappings"
        tabIndex={0}
      >
        <table>
          <thead>
            <tr>
              <th>Cash / bank account</th>
              <th>Currency</th>
              <th>Ledger account</th>
              <th>Recorded balance</th>
              <th>Ledger balance · all dates</th>
              <th>Difference · recorded less ledger</th>
              <th>Action</th>
            </tr>
          </thead>
          <tbody>
            {data?.bank.map((b) => (
              <tr key={b.id}>
                <td>{b.accountName}</td>
                <td>{b.currency}</td>
                <td>
                  {b.ledgerAccount
                    ? `${b.ledgerAccount.accountCode} · ${b.ledgerAccount.accountName}`
                    : 'Not connected'}
                </td>
                <td>
                  {b.recordedBalance == null ? 'Unavailable' : money(b.recordedBalance, b.currency)}
                </td>
                <td>
                  {b.ledgerBalance == null ? 'Not connected' : money(b.ledgerBalance, b.currency)}
                </td>
                <td>
                  {b.balanceDifference == null ? (
                    'Choose a ledger to compare'
                  ) : (
                    <>
                      <span>{money(b.balanceDifference, b.currency)}</span>
                      {b.balanceDifference !== '0.00' && (
                        <>
                          <br />
                          <span className="posting-status">Review difference</span>
                        </>
                      )}
                    </>
                  )}
                </td>
                <td>
                  <button
                    onClick={() =>
                      open({ kind: 'account-connection', accountKind: 'bank', id: b.id, query })
                    }
                  >
                    {canManage && b.canConnect && !b.ledgerAccountId ? 'Map' : 'Review'}{' '}
                    {b.accountName}
                  </button>
                  {canManage && !b.canConnect && !b.ledgerAccountId && (
                    <p className="accounting-note">Company or branch write access required.</p>
                  )}
                </td>
              </tr>
            ))}
            {!resource.loading && !resource.error && !data?.bank.length && (
              <tr>
                <td colSpan={7}>
                  No active bank or cash accounts available.{' '}
                  <Link href="/finance/cash-accounts">Manage cash accounts.</Link>
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      {!canManage && (
        <p className="accounting-note">
          Your role can review connections. Cash Desk management and cash account management
          permissions are needed to save them.
        </p>
      )}
    </>
  );
}
function CashMovements({ query }: { query: Record<string, string> }) {
  const rows = useWorkspaceResource<Movement[]>('/cash-connections/movements', query),
    { hasPermission } = useAuth();
  const open = useAccountingEditor();
  const key = useAccountingStateKey('cash');
  const [search, setSearch] = useWorkspaceState(`${key}.search`, '');
  const [status, setStatus] = useWorkspaceState(`${key}.status`, '');
  useAccountingRefresh(rows.reload);
  const visible =
    rows.data?.filter(
      (r) =>
        (!status || r.status === status) &&
        `${r.description} ${r.reference} ${r.entries.map((e) => e.name).join(' ')}`
          .toLowerCase()
          .includes(search.toLowerCase()),
    ) ?? [];
  const pending =
    rows.data?.filter((r) => !['Posted', 'Reversed', 'Cancelled'].includes(r.status)).length || 0;
  return (
    <>
      <div className="accounting-summary">
        <div>
          <strong>
            {rows.loading
              ? 'Checking cash movements…'
              : rows.error
                ? 'Posting coverage unavailable'
                : `${pending} movements need attention`}
          </strong>
          <p>
            Recorded cash and posted accounting are shown separately until each movement has been
            reviewed.
          </p>
        </div>
        <button onClick={rows.reload}>Refresh cash postings</button>
      </div>
      <div className="accounting-toolbar">
        <label>
          Find movement
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Description, reference or account"
          />
        </label>
        <label>
          Status
          <select value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="">All statuses</option>
            {[
              'Unposted',
              'Posted',
              'Reversed',
              'Cancelled',
              'Account connection needed',
              'Loan connection pending',
              'Needs review',
            ].map((s) => (
              <option key={s}>{s}</option>
            ))}
          </select>
        </label>
      </div>

      {rows.error && <p role="alert">{rows.error}</p>}
      <div
        className="accounting-table"
        role="region"
        aria-label="Cash posting register"
        tabIndex={0}
      >
        <table>
          <thead>
            <tr>
              <th>Movement</th>
              <th>Cash account</th>
              <th>Date</th>
              <th>Amount</th>
              <th>Ledger status</th>
              <th>Action</th>
            </tr>
          </thead>
          <tbody>
            {visible.map((r) => (
              <tr key={r.id}>
                <td>
                  <strong>{label(r.kind)}</strong>
                  <br />
                  {r.description}
                  <br />
                  {r.reference}
                </td>
                <td>{r.entries.map((e) => e.name).join(' → ')}</td>
                <td>{r.date}</td>
                <td>{money(r.amount, r.currency)}</td>
                <td>{r.status}</td>
                <td>
                  <button onClick={() => open({ kind: 'cash-posting', id: r.id })}>Review</button>
                </td>
              </tr>
            ))}
            {!rows.loading && !rows.error && !visible.length && (
              <tr>
                <td colSpan={6}>No cash movements match this period and organisation.</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      <p className="accounting-note">
        Supplier and customer payments require their invoice to be posted first. Opening balances
        and daily cash sales must not duplicate existing ledger entries. Loans and intercompany
        movements remain pending. Payments recorded directly in Invoice Desk without a cash account
        need to be linked before they can enter this workflow.
      </p>
      {hasPermission('invoice_desk.view') && <UnlinkedPayments query={query} />}
    </>
  );
}
function UnlinkedPayments({ query }: { query: Record<string, string> }) {
  const { hasPermission } = useAuth();
  const rows = useWorkspaceResource<UnlinkedPayment[]>(
    '/cash-connections/unlinked-payments',
    query,
  );
  const open = useAccountingEditor();
  useAccountingRefresh(rows.reload);
  return (
    <>
      <h2 className="cash-connection-title">Invoice payments without a cash account</h2>
      <p>
        Link an existing payment to the account that paid it. This records its cash outflow while
        preserving the invoice’s paid amount.
      </p>
      {rows.loading && <p>Checking invoice payments…</p>}
      {rows.error && <p role="alert">{rows.error}</p>}
      {!rows.loading && !rows.error && !rows.data?.length && (
        <p>No unlinked invoice payments in this period.</p>
      )}
      {!!rows.data?.length && (
        <div
          className="accounting-table"
          role="region"
          aria-label="Unlinked invoice payments"
          tabIndex={0}
        >
          <table>
            <thead>
              <tr>
                <th>Invoice / supplier</th>
                <th>Payment date</th>
                <th>Amount</th>
                <th>Action</th>
              </tr>
            </thead>
            <tbody>
              {rows.data.map((p) => (
                <tr key={p.id}>
                  <td>
                    {p.invoice.invoiceNumber}
                    <br />
                    {p.invoice.supplier.name}
                  </td>
                  <td>{p.paymentDate.slice(0, 10)}</td>
                  <td>{money(p.amount, p.invoice.currency)}</td>
                  <td>
                    {hasPermission('cash_desk.record') &&
                      hasPermission('invoice_desk.payments') && (
                        <button
                          onClick={() =>
                            open({
                              kind: 'payment-link',
                              id: p.id,
                              query: {
                                ...query,
                                from: p.paymentDate.slice(0, 10),
                                to: p.paymentDate.slice(0, 10),
                                companyId: p.invoice.companyId,
                              },
                            })
                          }
                        >
                          Link cash account
                        </button>
                      )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
