'use client';
import { useState } from 'react';
import { useLinkedDeskChanges } from '@/components/workspace/linked-desk-changes';
import { Btn, FormDateField, FormSelect, WorkspaceTable } from '@/components/ui';
import { useAuth } from '@/hooks/use-auth';
import { useWorkspaceResource } from '@/hooks/use-workspace-resource';
import { useWorkspaceState } from '@/components/workspace/workspace-session';
import { WorkspaceLink as Link } from '@/components/workspace/workspace-navigation';
import { money, type Directory } from '@/features/invoice-desk/types';
import { downloadTextFile, toCsv } from '@/lib/report-export';
const reports = [
  { id: 'sales', name: 'Business sales', permission: 'sales.view' },
  { id: 'customers', name: 'Customer receivables', permission: 'receivables.view' },
  { id: 'suppliers', name: 'Supplier payables', permission: 'payables.view' },
  { id: 'expenses', name: 'Approved business expenses', permission: 'expenses.view' },
  { id: 'accounts', name: 'Business cash & bank accounts', permission: 'cash_accounts.view' },
] as const;
export const canReadBusinessReports = (has: (p: string) => boolean) =>
  reports.some((r) => has(r.permission));
type Row = {
  id: string;
  reference: string;
  party: string;
  date: string | null;
  currency: string;
  amount: string;
  paid: string;
  balance: string;
  status: string;
  href: string;
};
type Result = {
  kind: string;
  generatedAt: string;
  basis: string;
  rows: Row[];
  totals: { currency: string; amount: string; paid: string; balance: string; count: number }[];
};
export function BusinessReports() {
  const { hasPermission } = useAuth();
  const available = reports.filter((r) => hasPermission(r.permission));
  const [kind, setKind] = useWorkspaceState('business-reports.kind', 'sales');
  const selected = available.find((r) => r.id === kind) ?? available[0];
  const [filters, setFilters] = useWorkspaceState('business-reports.filters', {
    companyId: '',
    divisionId: '',
    branchId: '',
    from: '',
    to: '',
    currency: '',
  });
  const [page, setPage] = useState(1);
  const directory = useWorkspaceResource<Directory>(
    '/desk-reports/business/directory',
    {},
    !!selected,
  );
  const invalidDates =
    selected?.id !== 'accounts' && !!(filters.from && filters.to && filters.from > filters.to);
  const result = useWorkspaceResource<Result>(
    '/desk-reports/business',
    {
      ...Object.fromEntries(
        Object.entries(filters).filter(
          ([key, v]) => v && (selected?.id !== 'accounts' || !['from', 'to'].includes(key)),
        ),
      ),
      kind: selected?.id ?? '',
    },
    !!selected && !invalidDates,
  );
  useLinkedDeskChanges('reports', false, result.reload);
  const change = (key: keyof typeof filters, value: string) => {
    setPage(1);
    setFilters((f) => ({
      ...f,
      [key]: value,
      ...(key === 'companyId'
        ? { divisionId: '', branchId: '' }
        : key === 'divisionId'
          ? { branchId: '' }
          : {}),
    }));
  };
  if (!selected) return <p>Your role does not have access to business reports.</p>;
  const rows = result.data?.rows ?? [],
    current = Math.min(page, Math.max(1, Math.ceil(rows.length / 50)));
  function exportCsv() {
    if (!result.data) return;
    const cell = (v: string) => (/^[\s]*[=+\-@]/.test(v) ? `'${v}` : v);
    downloadTextFile(
      `business-${selected.id}.csv`,
      '\uFEFF' +
        toCsv(
          [
            'Reference',
            'Party',
            'Date',
            'Currency',
            'Amount',
            'Paid to date',
            'Current balance',
            'Status',
          ],
          rows.map((r) => [
            cell(r.reference),
            cell(r.party),
            r.date?.slice(0, 10) ?? '',
            r.currency,
            r.amount,
            r.paid,
            r.balance,
            r.status,
          ]),
        ),
      'text/csv;charset=utf-8',
    );
  }
  return (
    <section className="space-y-5">
      <header className="reports-heading">
        <h1>Connected business reports</h1>
        <p>
          Original sales, obligations, expenses and cash accounts, using your current organisation
          access.
        </p>
      </header>
      <div className="report-filter-grid">
        <FormSelect
          label="Report"
          value={selected.id}
          options={available.map((r) => ({ value: r.id, label: r.name }))}
          onChange={(e) => {
            setKind(e.target.value);
            setPage(1);
          }}
        />
        {(['companyId', 'divisionId', 'branchId'] as const).map((key, i) => {
          const choices =
            i === 0
              ? directory.data?.companies
              : i === 1
                ? directory.data?.divisions.filter(
                    (d) => !filters.companyId || d.companyId === filters.companyId,
                  )
                : directory.data?.branches.filter(
                    (b) =>
                      (!filters.companyId || b.companyId === filters.companyId) &&
                      (!filters.divisionId || b.divisionId === filters.divisionId),
                  );
          return (
            <FormSelect
              key={key}
              label={['Company', 'Division', 'Branch'][i]}
              value={filters[key]}
              options={[
                { value: '', label: 'All accessible' },
                ...(choices ?? []).map((c) => ({ value: c.id, label: c.name })),
              ]}
              onChange={(e) => change(key, e.target.value)}
            />
          );
        })}
        {selected.id !== 'accounts' && (
          <>
            <FormDateField
              label="Document date from"
              value={filters.from}
              onChange={(v) => change('from', v)}
            />
            <FormDateField
              label="Document date to"
              value={filters.to}
              onChange={(v) => change('to', v)}
            />
          </>
        )}
        <FormSelect
          label="Currency"
          value={filters.currency}
          options={['', 'TZS', 'KES', 'UGX', 'USD', 'EUR', 'GBP'].map((c) => ({
            value: c,
            label: c || 'All currencies, separately',
          }))}
          onChange={(e) => change('currency', e.target.value)}
        />
      </div>
      {directory.error && (
        <p role="alert">
          {directory.error} <Btn onClick={directory.reload}>Retry directory</Btn>
        </p>
      )}
      <div className="flex gap-3">
        <Btn onClick={result.reload}>Refresh</Btn>
        <Btn variant="secondary" onClick={exportCsv} disabled={!result.data || result.loading}>
          Export CSV
        </Btn>
      </div>
      <p className="workspace-notice">
        {result.data?.basis ??
          'Business records only. Direct registers and Records are reported separately. Balances and payments are current, not historical balances at the selected date.'}
      </p>
      {invalidDates ? (
        <p role="alert">Start date must precede end date.</p>
      ) : result.error ? (
        <p role="alert">{result.error}</p>
      ) : result.loading ? (
        <p role="status">Reading business records…</p>
      ) : (
        <>
          <div className="grid gap-3 sm:grid-cols-2">
            {result.data?.totals.map((t) => (
              <div className="rounded-xl border p-4" key={t.currency}>
                <strong>
                  {t.currency} · {t.count} records
                </strong>
                <p>Amount: {money(t.amount, t.currency)}</p>
                {selected.id !== 'accounts' && <p>Paid: {money(t.paid, t.currency)}</p>}
                <p>Balance: {money(t.balance, t.currency)}</p>
              </div>
            ))}
          </div>
          <WorkspaceTable label={selected.name}>
            <thead>
              <tr>
                <th>Reference / party</th>
                <th>Date</th>
                <th>Amount</th>
                <th>Paid</th>
                <th>Balance</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {rows.slice((current - 1) * 50, current * 50).map((r) => (
                <tr key={r.id}>
                  <td>
                    <Link href={r.href}>{r.reference}</Link>
                    <small className="block">{r.party}</small>
                  </td>
                  <td>{r.date?.slice(0, 10) ?? 'Current'}</td>
                  <td>{money(r.amount, r.currency)}</td>
                  <td>{money(r.paid, r.currency)}</td>
                  <td>{money(r.balance, r.currency)}</td>
                  <td>{r.status.replaceAll('_', ' ')}</td>
                </tr>
              ))}
              {!rows.length && (
                <tr>
                  <td colSpan={6}>No business records match this scope.</td>
                </tr>
              )}
            </tbody>
          </WorkspaceTable>
          <nav aria-label="Business report pages" className="flex gap-3">
            <Btn disabled={current === 1} onClick={() => setPage(current - 1)}>
              Previous
            </Btn>
            <span>
              Page {current} · {rows.length} records
            </span>
            <Btn disabled={current * 50 >= rows.length} onClick={() => setPage(current + 1)}>
              Next
            </Btn>
          </nav>
        </>
      )}
    </section>
  );
}
