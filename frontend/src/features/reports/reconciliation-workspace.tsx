'use client';
import { useEffect, useState } from 'react';
import { Btn, Card, PageHeader, PageSpinner, StatCard, StatusBadge } from '@/components/ui';
import { FormSelect } from '@/components/aurora';
import { WorkspaceTable } from '@/components/ui/workspace-table';
import { WorkspaceSplit } from '@/components/workspace/workspace-split';
import { WorkspaceLink } from '@/components/workspace/workspace-navigation';
import { useWorkspaceState } from '@/components/workspace/workspace-session';
import { useWorkspaceRecords } from '@/hooks/use-workspace-records';
import { useWorkspaceChoices } from '@/hooks/use-workspace-choices';
import { useWorkspaceResource } from '@/hooks/use-workspace-resource';
import { useAuth } from '@/hooks/use-auth';
import { money as formatMoney } from '@/features/invoice-desk/types';
import {
  AccountingDraftBoundary,
  useAccountingEditor,
  useAccountingRefresh,
  useAccountingStateKey,
} from './accounting-drafts';
import { StatementChecks } from './statement-import';
import { useMatchingResult } from './reconciliation-events';
import {
  reconciliationVersion,
  type CashAccountChoice,
  type CompanyChoice,
  type MatchingResult,
  type Reconciliation,
} from './reconciliation-types';
import '@/components/workspace/workspace.css';
import './reconciliation-workspace.css';
const money = (value: string | number, currency: string) => formatMoney(String(value), currency);

export function ReconciliationWorkspace() {
  return (
    <AccountingDraftBoundary>
      <ReconciliationRegister />
    </AccountingDraftBoundary>
  );
}
function ReconciliationRegister() {
  const { hasPermission, user } = useAuth(),
    open = useAccountingEditor();
  const key = useAccountingStateKey('reconciliations');
  const [companyId, setCompanyId] = useWorkspaceState(`${key}.company`, user?.companyId || '');
  const [status, setStatus] = useWorkspaceState(`${key}.status`, '');
  const [page, setPage] = useWorkspaceState(`${key}.page`, 1);
  const [selected, setSelected] = useWorkspaceState<string | null>(`${key}.selected`, null);
  const canList = hasPermission('bank_reconciliations.list'),
    canView = hasPermission('bank_reconciliations.view');
  const rows = useWorkspaceRecords<Reconciliation>(
    '/bank-reconciliations',
    { companyId: companyId || undefined, status: status || undefined, page, limit: 25 },
    canList,
  );
  const companies = useWorkspaceChoices<CompanyChoice>(
    '/companies',
    {},
    canList && hasPermission('companies.view'),
  );
  const accounts = useWorkspaceChoices<CashAccountChoice>(
    '/cash-accounts',
    { companyId: companyId || undefined },
    canList && hasPermission('cash_accounts.view'),
  );
  const companyOptions = companies.rows.map((row) => ({ value: row.id, label: row.name }));
  if (companyId && !companyOptions.some((row) => row.value === companyId))
    companyOptions.push({
      value: companyId,
      label: companyId === user?.companyId ? 'Assigned company' : 'Current company — check access',
    });
  useAccountingRefresh(rows.reload);
  useEffect(() => {
    if (!rows.loading && !rows.error && page > 1 && !rows.rows.length)
      setPage(Math.max(1, Math.ceil(rows.total / 25)));
  }, [rows.loading, rows.error, rows.rows.length, rows.total, page, setPage]);
  return (
    <div className="business-workspace reconciliation-workspace">
      <PageHeader
        title="Bank Reconciliations"
        subtitle="Bring statement lines and ledger movements together."
      />
      <div className="reconciliation-links">
        <WorkspaceLink href="/reports?view=accounting">Accounting readiness →</WorkspaceLink>
        <WorkspaceLink href="/reports?view=accounting&tab=connections">
          Review account connections →
        </WorkspaceLink>
      </div>
      <Card className="reconciliation-filters">
        <FormSelect
          label="Company"
          value={companyId}
          options={[{ value: '', label: 'All accessible companies' }, ...companyOptions]}
          onChange={(event) => {
            setCompanyId(event.target.value);
            setPage(1);
            setSelected(null);
          }}
        />
        <FormSelect
          label="Status"
          value={status}
          options={[
            { value: '', label: 'All statuses' },
            ...['DRAFT', 'IN_PROGRESS', 'RECONCILED', 'APPROVED', 'CLOSED', 'CANCELLED'].map(
              (value) => ({ value, label: value.replaceAll('_', ' ') }),
            ),
          ]}
          onChange={(event) => {
            setStatus(event.target.value);
            setPage(1);
            setSelected(null);
          }}
        />
        <Btn
          variant="secondary"
          onClick={() => {
            void rows.reload();
            companies.retry();
            accounts.retry();
          }}
        >
          Refresh register
        </Btn>
        {hasPermission('bank_reconciliations.create') && (
          <Btn onClick={() => open({ kind: 'reconciliation-create', companyId })}>
            New reconciliation
          </Btn>
        )}
      </Card>
      {companies.error && (
        <p role="alert" className="workspace-notice">
          Company choices could not be loaded: {companies.error}
        </p>
      )}
      {accounts.error && (
        <p role="alert" className="workspace-notice">
          Cash account names could not be loaded: {accounts.error}
        </p>
      )}
      {!canList ? (
        <p role="alert" className="workspace-notice">
          Your role cannot list reconciliations.
        </p>
      ) : (
        <WorkspaceSplit selectedKey={canView ? selected : null} onClose={() => setSelected(null)}>
          <Card>
            {rows.loading ? (
              <PageSpinner label="Loading reconciliations" />
            ) : rows.error ? (
              <div role="alert" className="workspace-notice">
                <p>{rows.error}</p>
                <Btn variant="secondary" onClick={rows.reload}>
                  Retry reconciliations
                </Btn>
              </div>
            ) : (
              <>
                <WorkspaceTable label="Bank reconciliation register">
                  <thead>
                    <tr>
                      <th>Reconciliation</th>
                      <th>Cash account</th>
                      <th>Period</th>
                      <th>Difference</th>
                      <th>Status</th>
                      <th>Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.rows.map((row) => (
                      <tr key={row.id} aria-selected={selected === row.id}>
                        <td>
                          <strong>{row.reconciliationNumber}</strong>
                        </td>
                        <td>
                          {accounts.rows.find((account) => account.id === row.cashAccountId)
                            ?.accountName || 'Cash account details unavailable'}
                        </td>
                        <td>
                          {row.statementStartDate.slice(0, 10)} –{' '}
                          {row.statementEndDate.slice(0, 10)}
                        </td>
                        <td>{money(row.differenceAmount, row.currency)}</td>
                        <td>
                          <StatusBadge status={row.status} />
                        </td>
                        <td>
                          {canView ? (
                            <Btn
                              variant="ghost"
                              onClick={() => setSelected(row.id)}
                              aria-label={`Review ${row.reconciliationNumber}`}
                            >
                              Review
                            </Btn>
                          ) : (
                            'View permission required'
                          )}
                        </td>
                      </tr>
                    ))}
                    {!rows.rows.length && (
                      <tr>
                        <td colSpan={6}>No reconciliations match these filters.</td>
                      </tr>
                    )}
                  </tbody>
                </WorkspaceTable>
                <nav className="reconciliation-pagination" aria-label="Reconciliation pages">
                  <Btn
                    variant="secondary"
                    disabled={page <= 1}
                    onClick={() => setPage((value) => value - 1)}
                  >
                    Previous page
                  </Btn>
                  <span>
                    {rows.total} reconciliations · Page {page} of{' '}
                    {Math.max(1, Math.ceil(rows.total / 25))}
                  </span>
                  <Btn
                    variant="secondary"
                    disabled={page * 25 >= rows.total}
                    onClick={() => setPage((value) => value + 1)}
                  >
                    Next page
                  </Btn>
                </nav>
              </>
            )}
          </Card>
          <Card>
            {selected && canView ? (
              <ReconciliationDetail key={selected} id={selected} />
            ) : (
              <p className="workspace-notice">
                Select a reconciliation to review its statement and journal matches.
              </p>
            )}
          </Card>
        </WorkspaceSplit>
      )}
    </div>
  );
}
function ReconciliationDetail({ id }: { id: string }) {
  const { hasPermission } = useAuth(),
    open = useAccountingEditor();
  const detail = useWorkspaceResource<Reconciliation>(
    `/bank-reconciliations/${encodeURIComponent(id)}`,
    {},
    hasPermission('bank_reconciliations.view'),
  );
  const key = useAccountingStateKey(`reconciliation.${id}`);
  const [page, setPage] = useWorkspaceState(`${key}.linesPage`, 1);
  const [chosen, setChosen] = useWorkspaceState<Record<string, string>>(`${key}.chosenMatches`, {});
  const [matching, setMatching] = useState<MatchingResult | null>(null);
  useMatchingResult(id, setMatching);
  useAccountingRefresh(detail.reload);
  if (detail.loading) return <PageSpinner label="Loading reconciliation details" />;
  if (detail.error)
    return (
      <div role="alert" className="workspace-notice">
        <p>{detail.error}</p>
        <Btn variant="secondary" onClick={detail.reload}>
          Retry reconciliation
        </Btn>
      </div>
    );
  const row = detail.data;
  if (!row) return <p className="workspace-notice">The reconciliation is unavailable.</p>;
  const canUpdate = row.status === 'DRAFT' && hasPermission('bank_reconciliations.update');
  const lines = row.statementLines || [],
    pages = Math.max(1, Math.ceil(lines.length / 25)),
    currentPage = Math.min(page, pages);
  return (
    <div className="reconciliation-detail">
      <header>
        <div>
          <h2>{row.reconciliationNumber}</h2>
          <p>
            {row.statementStartDate.slice(0, 10)} – {row.statementEndDate.slice(0, 10)} ·{' '}
            {row.currency}
          </p>
        </div>
        <StatusBadge status={row.status} />
      </header>
      <div className="reconciliation-totals">
        <StatCard
          label="Statement close"
          value={money(row.statementClosingBalance, row.currency)}
        />
        <StatCard label="Reconciled balance" value={money(row.reconciledBalance, row.currency)} />
        <StatCard label="Difference" value={money(row.differenceAmount, row.currency)} />
        <StatCard label="Statement lines" value={lines.length} />
      </div>
      <StatementChecks id={id} revision={reconciliationVersion(row)} />
      <div className="reconciliation-form-actions">
        <Btn variant="secondary" onClick={detail.reload}>
          Refresh statement
        </Btn>
        {canUpdate && (
          <>
            <Btn variant="secondary" onClick={() => open({ kind: 'reconciliation-import', id })}>
              Import CSV
            </Btn>
            <Btn variant="secondary" onClick={() => open({ kind: 'reconciliation-line', id })}>
              Add line
            </Btn>
            <Btn
              onClick={() => open({ kind: 'reconciliation-action', id, action: 'run-matching' })}
            >
              Run matching
            </Btn>
          </>
        )}
        {row.status === 'DRAFT' && hasPermission('bank_reconciliations.approve') && (
          <Btn onClick={() => open({ kind: 'reconciliation-action', id, action: 'approve' })}>
            Review approval
          </Btn>
        )}
        {row.status === 'APPROVED' && hasPermission('bank_reconciliations.close') && (
          <Btn onClick={() => open({ kind: 'reconciliation-action', id, action: 'close' })}>
            Review closure
          </Btn>
        )}
      </div>
      {matching && (
        <p role="status" className="workspace-notice">
          {matching.summary.autoMatched} lines matched; {matching.summary.ambiguous} need a choice;{' '}
          {matching.summary.stillUnmatched} remain unmatched.
        </p>
      )}
      <h3>Statement lines</h3>
      {!lines.length && <p>No statement lines yet. Add a line or import a CSV for this period.</p>}
      <ul className="reconciliation-lines">
        {lines.slice((currentPage - 1) * 25, currentPage * 25).map((line) => {
          const candidates =
            matching?.perLine.find((value) => value.lineId === line.id)?.suggestions || [];
          const selected = candidates.find((candidate) => candidate.entityId === chosen[line.id]);
          const options = candidates.map((candidate) => ({
            value: candidate.entityId,
            label: `${candidate.date.slice(0, 10)} · ${money(candidate.amount, row.currency)} · ${candidate.description}`,
          }));
          if (chosen[line.id] && !selected)
            options.push({
              value: chosen[line.id],
              label: 'Previous choice — run matching to check availability',
            });
          return (
            <li key={line.id}>
              <header>
                <strong>{line.description}</strong>
                <StatusBadge status={line.matched ? 'MATCHED' : 'OPEN'} />
              </header>
              <p>
                {line.transactionDate.slice(0, 10)}
                {line.reference ? ` · ${line.reference}` : ''}
              </p>
              <p>
                Debit {money(line.debitAmount, row.currency)} · Credit{' '}
                {money(line.creditAmount, row.currency)}
              </p>
              {canUpdate && line.matched && (
                <Btn
                  variant="secondary"
                  onClick={() =>
                    open({ kind: 'reconciliation-action', id, action: 'unmatch', lineId: line.id })
                  }
                >
                  Review match removal
                </Btn>
              )}
              {canUpdate && !line.matched && (!!candidates.length || !!chosen[line.id]) && (
                <>
                  <FormSelect
                    label={`Journal match for ${line.description}`}
                    value={chosen[line.id] || ''}
                    placeholder="Review matching candidates"
                    options={options}
                    onChange={(event) =>
                      setChosen((values) => ({ ...values, [line.id]: event.target.value }))
                    }
                  />
                  <Btn
                    disabled={!selected}
                    onClick={() =>
                      open({
                        kind: 'reconciliation-action',
                        id,
                        action: 'match',
                        lineId: line.id,
                        journalEntryLineId: selected!.entityId,
                        candidateLabel: options.find((value) => value.value === selected!.entityId)
                          ?.label,
                      })
                    }
                  >
                    Review selected match
                  </Btn>
                </>
              )}
            </li>
          );
        })}
      </ul>
      {pages > 1 && (
        <nav className="reconciliation-pagination" aria-label="Statement line pages">
          <Btn
            variant="secondary"
            disabled={currentPage === 1}
            onClick={() => setPage(currentPage - 1)}
          >
            Previous lines
          </Btn>
          <span>
            Page {currentPage} of {pages}
          </span>
          <Btn
            variant="secondary"
            disabled={currentPage === pages}
            onClick={() => setPage(currentPage + 1)}
          >
            Next lines
          </Btn>
        </nav>
      )}
    </div>
  );
}
