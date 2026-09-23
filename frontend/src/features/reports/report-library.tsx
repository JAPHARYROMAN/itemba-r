'use client';
import { useMemo } from 'react';
import { Btn, Card, PageHeader, PageSpinner, StatusBadge } from '@/components/ui';
import { FormInput, FormSelect } from '@/components/aurora';
import { WorkspaceTable } from '@/components/ui/workspace-table';
import { WorkspaceSplit } from '@/components/workspace/workspace-split';
import { WorkspaceLink } from '@/components/workspace/workspace-navigation';
import { useWorkspaceState } from '@/components/workspace/workspace-session';
import { useUnsavedWorkScopeId } from '@/components/workspace/unsaved-work-provider';
import { useWorkspaceResource } from '@/hooks/use-workspace-resource';
import { useAuth } from '@/hooks/use-auth';
import { reportLabel, runnableReport, safeReportLink } from './report-viewer-utils';
import type { ReportCatalog } from './report-viewer-types';
import '@/components/workspace/workspace.css';
import './report-viewer.css';

export function ReportLibrary() {
  const { hasPermission } = useAuth();
  const key = `reports.library.${useUnsavedWorkScopeId() || 'main'}`;
  const [search, setSearch] = useWorkspaceState(`${key}.search`, '');
  const [sector, setSector] = useWorkspaceState(`${key}.sector`, '');
  const [type, setType] = useWorkspaceState(`${key}.type`, '');
  const [page, setPage] = useWorkspaceState(`${key}.page`, 1);
  const [selected, setSelected] = useWorkspaceState(`${key}.selected`, '');
  const catalog = useWorkspaceResource<ReportCatalog>('/reports/catalog');
  const entries = catalog.data?.entries;
  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase();
    return (entries || [])
      .filter(
        (row) =>
          (!sector || sector === row.sector) &&
          (!type || type === row.reportType) &&
          (!term ||
            [
              row.name,
              row.description,
              row.category,
              reportLabel(row.sector),
              row.owner,
              ...(row.tags || []),
              ...(row.businessQuestions || []),
            ].some((value) => value?.toLowerCase().includes(term))),
      )
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [entries, search, sector, type]);
  const pages = Math.max(1, Math.ceil(filtered.length / 25)),
    current = Math.min(page, pages);
  const detail = entries?.find((row) => row.id === selected);
  const choices = (key: 'sector' | 'reportType') =>
    [...new Set(entries?.map((row) => row[key] || '').filter(Boolean))]
      .sort()
      .map((value) => ({ value, label: reportLabel(value) }));
  return (
    <div className="business-workspace report-library">
      <PageHeader
        title="Report library"
        subtitle="Find the report you need, review its purpose and choose how to open it."
      />
      <nav className="report-links" aria-label="Reports sections">
        <WorkspaceLink href="/reports">Reports home</WorkspaceLink>
        {hasPermission('scheduled_reports.view') && (
          <WorkspaceLink href="/reports/scheduled">Scheduled reports</WorkspaceLink>
        )}
      </nav>
      <Card className="report-filter-grid">
        <FormInput
          label="Find a report"
          value={search}
          onChange={(e) => {
            setSearch(e.target.value);
            setPage(1);
          }}
          placeholder="Sales, customers, stock, payroll…"
        />
        <FormSelect
          label="Business area"
          value={sector}
          options={[{ value: '', label: 'All areas' }, ...choices('sector')]}
          onChange={(e) => {
            setSector(e.target.value);
            setPage(1);
          }}
        />
        <FormSelect
          label="Report type"
          value={type}
          options={[{ value: '', label: 'All types' }, ...choices('reportType')]}
          onChange={(e) => {
            setType(e.target.value);
            setPage(1);
          }}
        />
        <div className="report-actions">
          <Btn
            variant="secondary"
            onClick={() => {
              setSearch('');
              setSector('');
              setType('');
              setPage(1);
            }}
          >
            Clear filters
          </Btn>
          <Btn variant="secondary" onClick={catalog.reload}>
            Refresh library
          </Btn>
        </div>
      </Card>
      {catalog.loading ? (
        <PageSpinner label="Loading report library" />
      ) : catalog.error ? (
        <div role="alert" className="workspace-notice">
          <p>{catalog.error}</p>
          <Btn onClick={catalog.reload}>Retry library</Btn>
        </div>
      ) : (
        <WorkspaceSplit selectedKey={detail?.id} onClose={() => setSelected('')}>
          <Card>
            <WorkspaceTable label="Report library">
              <thead>
                <tr>
                  <th>Report</th>
                  <th>Area</th>
                  <th>Access</th>
                  <th>Action</th>
                </tr>
              </thead>
              <tbody>
                {filtered.slice((current - 1) * 25, current * 25).map((row) => (
                  <tr key={row.id} aria-selected={row.id === selected}>
                    <td>
                      <strong>{row.name}</strong>
                      <small>{row.category}</small>
                    </td>
                    <td>{reportLabel(row.sector)}</td>
                    <td>{hasPermission(row.permission) ? 'Available' : 'Permission required'}</td>
                    <td>
                      <Btn
                        variant="ghost"
                        aria-label={`Details for ${row.name}`}
                        onClick={() => setSelected(row.id)}
                      >
                        Details
                      </Btn>
                    </td>
                  </tr>
                ))}
                {!filtered.length && (
                  <tr>
                    <td colSpan={4}>No reports match these filters.</td>
                  </tr>
                )}
              </tbody>
            </WorkspaceTable>
            <nav className="report-pagination" aria-label="Report library pages">
              <Btn
                variant="secondary"
                disabled={current === 1}
                onClick={() => setPage(current - 1)}
              >
                Previous reports
              </Btn>
              <span>
                {filtered.length} reports · Page {current} of {pages}
              </span>
              <Btn
                variant="secondary"
                disabled={current === pages}
                onClick={() => setPage(current + 1)}
              >
                Next reports
              </Btn>
            </nav>
          </Card>
          <Card className="report-inspector">
            {detail ? (
              <>
                <header>
                  <span className="report-eyebrow">
                    {reportLabel(detail.sector)} · {reportLabel(detail.reportType || 'Report')}
                  </span>
                  <h2>{detail.name}</h2>
                  <p>{detail.description}</p>
                </header>
                <dl className="report-facts">
                  <div>
                    <dt>Scope</dt>
                    <dd>{detail.scopes.map(reportLabel).join(', ')}</dd>
                  </div>
                  <div>
                    <dt>Owner</dt>
                    <dd>{detail.owner || 'Not specified'}</dd>
                  </div>
                  <div>
                    <dt>Freshness</dt>
                    <dd>{detail.dataFreshness || 'Shown when the report runs'}</dd>
                  </div>
                  <div>
                    <dt>Classification</dt>
                    <dd>
                      {detail.securityClassification
                        ? reportLabel(detail.securityClassification)
                        : 'Not specified'}
                    </dd>
                  </div>
                </dl>
                {detail.lifecycleStatus && (
                  <div>
                    <StatusBadge status={detail.lifecycleStatus} />
                    <p className="report-caption">
                      Classification supplied by the report catalogue.
                    </p>
                  </div>
                )}
                {!!detail.businessQuestions?.length && (
                  <section>
                    <h3>Use this report to answer</h3>
                    <ul>
                      {detail.businessQuestions.map((question) => (
                        <li key={question}>{question}</li>
                      ))}
                    </ul>
                  </section>
                )}
                {hasPermission(detail.permission) ? (
                  <div className="report-links">
                    {runnableReport(detail) && (
                      <WorkspaceLink
                        className="report-primary-link"
                        href={`/reports/run?reportId=${encodeURIComponent(detail.id)}`}
                      >
                        Open report
                      </WorkspaceLink>
                    )}
                    {safeReportLink(detail.frontendPath) && (
                      <WorkspaceLink href={detail.frontendPath}>Open business app</WorkspaceLink>
                    )}
                  </div>
                ) : (
                  <p role="status" className="workspace-notice">
                    Your current role cannot run this report. The library shows its purpose and
                    availability.
                  </p>
                )}
              </>
            ) : (
              <p>Select a report to see its purpose, scope and available actions.</p>
            )}
          </Card>
        </WorkspaceSplit>
      )}
    </div>
  );
}
