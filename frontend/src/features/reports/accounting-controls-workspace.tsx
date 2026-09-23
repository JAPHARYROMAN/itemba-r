'use client';
import { useMemo } from 'react';
import { Btn, Card, PageHeader, PageSpinner, StatusBadge } from '@/components/ui';
import { FormInput, FormSelect } from '@/components/aurora';
import { WorkspaceTable } from '@/components/ui/workspace-table';
import { WorkspaceSplit } from '@/components/workspace/workspace-split';
import { WorkspaceLink } from '@/components/workspace/workspace-navigation';
import { useWorkspaceState } from '@/components/workspace/workspace-session';
import { useWorkspaceChoices } from '@/hooks/use-workspace-choices';
import { useAuth } from '@/hooks/use-auth';
import {
  AccountingDraftBoundary,
  useAccountingEditor,
  useAccountingRefresh,
  useAccountingStateKey,
} from './accounting-drafts';
import { controlOptions } from './accounting-control-choices';
import { ControlDetail } from './accounting-control-detail';
import {
  choiceLabel,
  controlDefinitions,
  humanLabel,
  recordLabel,
  type ControlChoice,
  type ControlKind,
  type ControlRecord,
} from './accounting-controls-types';
import '@/components/workspace/workspace.css';
import './accounting-controls.css';

export function AccountingControlsWorkspace({ kind }: { kind: ControlKind }) {
  return (
    <AccountingDraftBoundary>
      <ControlRegister key={kind} kind={kind} />
    </AccountingDraftBoundary>
  );
}
function ControlRegister({ kind }: { kind: ControlKind }) {
  const { hasPermission, user } = useAuth(),
    definition = controlDefinitions[kind],
    open = useAccountingEditor();
  const key = useAccountingStateKey(kind);
  const [companyId, setCompany] = useWorkspaceState(`${key}.company`, user?.companyId || '');
  const [status, setStatus] = useWorkspaceState(`${key}.status`, '');
  const [query, setQuery] = useWorkspaceState(`${key}.query`, '');
  const [requestedPage, setPage] = useWorkspaceState(`${key}.page`, 1);
  const [selected, setSelected] = useWorkspaceState<string | null>(`${key}.selected`, null);
  const canList = hasPermission(`${definition.permission}.list`),
    canView = hasPermission(`${definition.permission}.view`);
  // Complete reads preserve honest status filtering on legacy endpoints without server-side status support.
  const records = useWorkspaceChoices<ControlRecord>(
    `/${kind}`,
    { companyId: companyId || undefined },
    canList,
  );
  const companies = useWorkspaceChoices<ControlChoice>(
    '/companies',
    {},
    canList && hasPermission('companies.view'),
  );
  useAccountingRefresh(records.retry);
  const companyRows = companies.rows.length
    ? companies.rows
    : user?.companyId
      ? [{ id: user.companyId, name: 'Assigned company' }]
      : [];
  const filtered = useMemo(
    () =>
      records.rows.filter(
        (row) =>
          (!status || row.status === status) &&
          (!query.trim() ||
            [
              recordLabel(kind, row),
              row.description,
              row.sourceType,
              row.sourceId,
              row.reason,
              row.reviewNotes,
              row.fixedAssetId,
              row.moduleName,
            ].some((value) => value?.toLowerCase().includes(query.trim().toLowerCase()))),
      ),
    [records.rows, status, query, kind],
  );
  const pages = Math.max(1, Math.ceil(filtered.length / 25)),
    page = Math.min(requestedPage, pages);
  const filter = (change: () => void) => {
    change();
    setPage(1);
    setSelected(null);
  };
  return (
    <div className="business-workspace accounting-controls">
      <PageHeader title={definition.title} subtitle={definition.subtitle} />
      <nav className="accounting-control-nav" aria-label="Accounting controls">
        <WorkspaceLink href="/reports?view=accounting">Accounting overview</WorkspaceLink>
        {(Object.keys(controlDefinitions) as ControlKind[])
          .filter((k) => hasPermission(`${controlDefinitions[k].permission}.list`))
          .map((k) => (
            <WorkspaceLink
              key={k}
              href={`/accounting-engine/${k}`}
              aria-current={k === kind ? 'page' : undefined}
            >
              {controlDefinitions[k].title}
            </WorkspaceLink>
          ))}
      </nav>
      <Card className="accounting-control-filters">
        <FormInput
          label="Search register"
          type="search"
          value={query}
          placeholder="Reference, description or source"
          onChange={(e) => filter(() => setQuery(e.target.value))}
        />
        <FormSelect
          label="Company"
          value={companyId}
          options={[
            { value: '', label: 'All accessible companies' },
            ...controlOptions(companyRows, companyId),
          ]}
          onChange={(e) => filter(() => setCompany(e.target.value))}
        />
        <FormSelect
          label="Status"
          value={status}
          options={[
            { value: '', label: 'All statuses' },
            ...definition.statuses.map((value) => ({ value, label: humanLabel(value) })),
          ]}
          onChange={(e) => filter(() => setStatus(e.target.value))}
        />
        <Btn
          variant="secondary"
          onClick={() => {
            records.retry();
            companies.retry();
          }}
        >
          Refresh register
        </Btn>
        {hasPermission(`${definition.permission}.create`) && (
          <Btn onClick={() => open({ kind: 'control-create', control: kind, companyId })}>
            New {definition.singular}
          </Btn>
        )}
      </Card>
      {companies.error && (
        <div role="alert" className="workspace-notice">
          <p>Company names are unavailable: {companies.error}</p>
          <Btn variant="secondary" onClick={companies.retry}>
            Retry companies
          </Btn>
        </div>
      )}
      {!canList ? (
        <p role="alert" className="workspace-notice">
          Your role cannot list {definition.title.toLowerCase()}.
        </p>
      ) : (
        <WorkspaceSplit selectedKey={canView ? selected : null} onClose={() => setSelected(null)}>
          <Card>
            {records.loading ? (
              <PageSpinner label={`Loading ${definition.title.toLowerCase()}`} />
            ) : records.error ? (
              <div role="alert" className="workspace-notice">
                <p>{records.error}</p>
                <Btn variant="secondary" onClick={records.retry}>
                  Retry register
                </Btn>
              </div>
            ) : (
              <>
                <WorkspaceTable label={`${definition.title} register`}>
                  <thead>
                    <tr>
                      <th>Reference</th>
                      <th>Company</th>
                      <th>
                        {kind === 'posting-runs'
                          ? 'Source'
                          : kind === 'depreciation'
                            ? 'Method'
                            : kind === 'accounting-locks'
                              ? 'Scope'
                              : 'Details'}
                      </th>
                      <th>Status</th>
                      <th>Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filtered.slice((page - 1) * 25, page * 25).map((row) => (
                      <tr key={row.id} aria-selected={row.id === selected}>
                        <td>
                          <strong>{recordLabel(kind, row)}</strong>
                          <div>{row.createdAt?.slice(0, 10)}</div>
                        </td>
                        <td>
                          {companyRows.find((c) => c.id === row.companyId)
                            ? choiceLabel(companyRows.find((c) => c.id === row.companyId)!)
                            : row.companyId}
                        </td>
                        <td>
                          {kind === 'posting-runs'
                            ? humanLabel(row.sourceType)
                            : kind === 'depreciation'
                              ? humanLabel(row.depreciationMethod)
                              : kind === 'accounting-locks'
                                ? `${humanLabel(row.lockType)} · ${row.moduleName || 'All modules'}`
                                : row.description || row.reviewNotes || 'Review period details'}
                        </td>
                        <td>
                          <StatusBadge status={row.status} />
                        </td>
                        <td>
                          {canView ? (
                            <Btn
                              variant="ghost"
                              aria-label={`Review ${recordLabel(kind, row)}`}
                              onClick={() => setSelected(row.id)}
                            >
                              Review
                            </Btn>
                          ) : (
                            'View permission required'
                          )}
                        </td>
                      </tr>
                    ))}
                    {!filtered.length && (
                      <tr>
                        <td colSpan={5}>
                          <p className="accounting-control-empty">
                            No records match these filters.
                          </p>
                        </td>
                      </tr>
                    )}
                  </tbody>
                </WorkspaceTable>
                <nav className="accounting-control-pagination" aria-label="Register pages">
                  <Btn variant="secondary" disabled={page === 1} onClick={() => setPage(page - 1)}>
                    Previous page
                  </Btn>
                  <span>
                    {filtered.length} records · Page {page} of {pages}
                  </span>
                  <Btn
                    variant="secondary"
                    disabled={page === pages}
                    onClick={() => setPage(page + 1)}
                  >
                    Next page
                  </Btn>
                </nav>
              </>
            )}
          </Card>
          <Card>
            {selected && canView ? (
              <ControlDetail key={selected} kind={kind} id={selected} companyId={companyId} />
            ) : (
              <p className="accounting-control-empty">
                Select a record to review its details and available actions.
              </p>
            )}
          </Card>
        </WorkspaceSplit>
      )}
    </div>
  );
}
