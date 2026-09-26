'use client';
import { useCallback, useRef } from 'react';
import { Btn, Card, FormDateField, PageHeader, PageSpinner } from '@/components/ui';
import { FormSelect } from '@/components/aurora';
import {
  WorkspaceLink,
  useWorkspaceSearchParams,
} from '@/components/workspace/workspace-navigation';
import { useWorkspaceState } from '@/components/workspace/workspace-session';
import { useUnsavedWorkScopeId } from '@/components/workspace/unsaved-work-provider';
import { useWorkspaceResource } from '@/hooks/use-workspace-resource';
import { useWorkspaceChoices } from '@/hooks/use-workspace-choices';
import { useAuth } from '@/hooks/use-auth';
import { pickPrimaryTable } from '@/lib/report-export';
import { StockValuationView } from '@/features/inventory/stock-valuation-view';
import { normalizeValuationOptions } from '@/features/inventory/stock-valuation-format';
import { AccountingDraftBoundary } from './accounting-drafts';
import { ReportEvidence, ReportResults } from './report-results';
import { ReportExports } from './report-exports';
import { ReportSavedViews } from './report-saved-views';
import { useReportExecution } from './use-report-execution';
import { reportLabel, runnableReport, safeReportLink } from './report-viewer-utils';
import type {
  CatalogEntry,
  ReportCatalog,
  ReportFilters,
  ReportPresentation,
  SavedReportView,
} from './report-viewer-types';
import '@/components/workspace/workspace.css';
import './report-viewer.css';

export function ReportViewer() {
  const { hasPermission, loading: authLoading } = useAuth();
  const canView = hasPermission('report_runs.create');
  const params = useWorkspaceSearchParams();
  const reportId = params.get('reportId') || '';
  const catalog = useWorkspaceResource<ReportCatalog>(
    '/reports/catalog',
    {},
    !authLoading && canView && !!reportId,
  );
  const entry = catalog.data?.entries.find((row) => row.id === reportId);
  const supplied: ReportFilters = {
    companyId: params.get('companyId') || '',
    divisionId: params.get('divisionId') || '',
    dateFrom: params.get('dateFrom') || '',
    dateTo: params.get('dateTo') || '',
    asOf: params.get('asOf') || '',
  };
  if (authLoading || !canView) {
    return (
      <div className="business-workspace report-viewer">
        <PageHeader title="Run report" subtitle={authLoading ? 'Loading' : 'Access Restricted'} />
      </div>
    );
  }
  return (
    <AccountingDraftBoundary>
      {!reportId ? (
        <Card className="report-viewer-section">
          <p>Choose a report from the library to get started.</p>
          <WorkspaceLink href="/reports/library">Browse report library</WorkspaceLink>
        </Card>
      ) : catalog.loading ? (
        <PageSpinner label="Loading report details" />
      ) : catalog.error ? (
        <div role="alert" className="workspace-notice">
          <p>{catalog.error}</p>
          <Btn onClick={catalog.reload}>Try again</Btn>
        </div>
      ) : !entry ? (
        <Card className="report-viewer-section">
          <p>This report is no longer in the library.</p>
          <WorkspaceLink href="/reports/library">Browse report library</WorkspaceLink>
        </Card>
      ) : (
        <ReportViewerContent
          key={JSON.stringify([reportId, supplied])}
          entry={entry}
          supplied={supplied}
        />
      )}
    </AccountingDraftBoundary>
  );
}
function ReportViewerContent({
  entry,
  supplied,
}: {
  entry: CatalogEntry;
  supplied: ReportFilters;
}) {
  const { hasPermission, user } = useAuth();
  const isValuation = entry.id === 'ops.stock-valuation';
  const key = `reports.viewer.${useUnsavedWorkScopeId() || 'main'}.${entry.id}.${JSON.stringify(supplied)}`;
  const [filters, setFilters] = useWorkspaceState<ReportFilters>(`${key}.filters`, {
    ...supplied,
    ...(isValuation ? { dateFrom: '', dateTo: '', asOf: '' } : {}),
    companyId: supplied.companyId || user?.companyId || '',
  });
  const [presentation, setPresentation] = useWorkspaceState<ReportPresentation>(
    `${key}.presentation`,
    { viewMode: 'table', metricColumns: null },
  );
  const [touched, setTouched] = useWorkspaceState(`${key}.touched`, false);
  const allowed = hasPermission(entry.permission);
  const companies = useWorkspaceChoices<{ id: string; name: string }>(
    '/companies',
    {},
    allowed && hasPermission('companies.view'),
  );
  const divisions = useWorkspaceChoices<{ id: string; name: string; companyId: string }>(
    '/divisions',
    { companyId: filters.companyId },
    allowed &&
      !!filters.companyId &&
      entry.scopes.includes('DIVISION') &&
      hasPermission('divisions.view'),
  );
  const companyOptions = companies.rows.map((row) => ({ value: row.id, label: row.name }));
  if (filters.companyId && !companyOptions.some((row) => row.value === filters.companyId))
    companyOptions.push({
      value: filters.companyId,
      label:
        filters.companyId === user?.companyId
          ? 'Assigned company'
          : 'Selected company — check access',
    });
  const divisionOptions = divisions.rows
    .filter((row) => row.companyId === filters.companyId)
    .map((row) => ({ value: row.id, label: row.name }));
  if (filters.divisionId && !divisionOptions.some((row) => row.value === filters.divisionId))
    divisionOptions.push({ value: filters.divisionId, label: 'Selected division — check access' });
  const execution = useReportExecution(entry, filters, allowed);
  const root = useRef<HTMLDivElement>(null);
  const change = (field: keyof ReportFilters, value: string) => {
    setTouched(true);
    setFilters((current) => ({
      ...current,
      [field]: value,
      ...(field === 'companyId' ? { divisionId: '' } : {}),
    }));
  };
  const applyView = useCallback(
    (view: SavedReportView) => {
      const values = view.filters || {};
      setFilters((current) => ({
        companyId:
          typeof values.companyId === 'string'
            ? values.companyId
            : view.companyId || current.companyId,
        divisionId: values.divisionId || '',
        dateFrom: isValuation ? '' : values.dateFrom || '',
        dateTo: isValuation ? '' : values.dateTo || '',
        asOf: isValuation ? '' : values.asOf || '',
      }));
      setPresentation({
        viewMode: view.chartConfig?.viewMode === 'chart' ? 'chart' : 'table',
        metricColumns:
          view.chartConfig?.metricColumns?.filter((value) => typeof value === 'string') ?? null,
        ...(isValuation
          ? { stockValuation: normalizeValuationOptions(view.chartConfig?.stockValuation) }
          : {}),
      });
      setTouched(true);
    },
    [setFilters, setPresentation, setTouched, isValuation],
  );
  const needsCompany = entry.scopes.includes('COMPANY') || entry.apiPath.includes('{companyId}');
  const needsDates =
    !isValuation &&
    ([
      'Statements',
      'Sales',
      'Group Cross-sector',
      'Audit',
      'Group',
      'Inventory',
      'Procurement',
    ].includes(entry.category) ||
      !!filters.dateFrom ||
      !!filters.dateTo);
  const companyLabel =
    companyOptions.find((row) => row.value === filters.companyId)?.label || 'Permitted group scope';
  const scopeLabel = [
    companyLabel,
    filters.divisionId
      ? divisionOptions.find((row) => row.value === filters.divisionId)?.label
      : '',
    filters.dateFrom || filters.dateTo
      ? `${filters.dateFrom || 'Any start date'} – ${filters.dateTo || 'Any end date'}`
      : '',
    filters.asOf ? `As of ${filters.asOf}` : '',
  ]
    .filter(Boolean)
    .join(' · ');
  return (
    <div className="business-workspace report-viewer" ref={root}>
      <PageHeader title={entry.name} subtitle={entry.description} />
      <nav className="report-links report-no-print" aria-label="Report navigation">
        <WorkspaceLink href="/reports/library">Report library</WorkspaceLink>
        <WorkspaceLink href="/reports">Reports home</WorkspaceLink>
        {safeReportLink(entry.frontendPath) && (
          <WorkspaceLink href={entry.frontendPath}>Business app</WorkspaceLink>
        )}
      </nav>
      {!allowed ? (
        <p role="alert" className="workspace-notice">
          Your current role cannot run this report.
        </p>
      ) : !runnableReport(entry) ? (
        <p className="workspace-notice">
          Open this report from its business app to choose a source record.
        </p>
      ) : (
        <>
          <Card className="report-viewer-section report-no-print">
            <h3>{isValuation ? 'Organisation scope' : 'Scope and period'}</h3>
            <div className="report-filter-grid">
              {needsCompany && (
                <FormSelect
                  label="Company"
                  value={filters.companyId}
                  options={[
                    {
                      value: '',
                      label: entry.apiPath.includes('{companyId}')
                        ? 'Choose company'
                        : 'Permitted group scope',
                    },
                    ...companyOptions,
                  ]}
                  disabled={!hasPermission('companies.view')}
                  onChange={(event) => change('companyId', event.target.value)}
                />
              )}
              {entry.scopes.includes('DIVISION') && filters.companyId && (
                <FormSelect
                  label="Division"
                  value={filters.divisionId}
                  options={[{ value: '', label: 'All permitted divisions' }, ...divisionOptions]}
                  disabled={!hasPermission('divisions.view')}
                  onChange={(event) => change('divisionId', event.target.value)}
                />
              )}
              {needsDates && (
                <>
                  <FormDateField
                    label="Date from"
                    value={filters.dateFrom}
                    onChange={(value) => change('dateFrom', value)}
                  />
                  <FormDateField
                    label="Date to"
                    value={filters.dateTo}
                    onChange={(value) => change('dateTo', value)}
                  />
                </>
              )}
              {(/balance-sheet/.test(entry.id) || !!filters.asOf) && (
                <FormDateField
                  label="As of"
                  value={filters.asOf}
                  onChange={(value) => change('asOf', value)}
                />
              )}
            </div>
            {(companies.loading || divisions.loading) && (
              <p role="status">Loading organisation choices…</p>
            )}
            {(companies.error || divisions.error) && (
              <div role="alert" className="workspace-notice">
                <p>{companies.error || divisions.error} Your current selections are retained.</p>
                <Btn
                  variant="secondary"
                  onClick={() => {
                    companies.retry();
                    divisions.retry();
                  }}
                >
                  Retry organisation choices
                </Btn>
              </div>
            )}
            <div className="report-actions">
              <Btn
                loading={execution.loading}
                onClick={() => {
                  setTouched(true);
                  void execution.run();
                }}
              >
                Run report
              </Btn>
              <p>
                {execution.changed
                  ? 'Filters changed. Run again to see results for these choices.'
                  : 'Choose filters, then run the report.'}
              </p>
            </div>
          </Card>
          <ReportSavedViews
            entry={entry}
            filters={filters}
            presentation={presentation}
            onApply={applyView}
            mayApplyDefault={!touched && !Object.values(supplied).some(Boolean)}
          />
          {execution.loading && (
            <PageSpinner label="Running report and loading supporting checks" />
          )}
          {execution.error && (
            <div role="alert" className="workspace-notice">
              <p>{execution.error}</p>
              <Btn onClick={() => void execution.run()}>Retry report</Btn>
            </div>
          )}
          {execution.result && (
            <>
              <header>
                <p>{scopeLabel}</p>
                <p>
                  Generated {new Date(execution.result.generatedAt).toLocaleString()} ·{' '}
                  {reportLabel(entry.securityClassification || 'Internal')}
                </p>
              </header>
              <ReportEvidence result={execution.result} />
              {isValuation ? (
                <StockValuationView
                  rows={pickPrimaryTable(execution.result.data).rows}
                  options={normalizeValuationOptions(presentation.stockValuation)}
                  companyId={execution.result.filters.companyId}
                  companyName={companyLabel}
                  scopeLabel={scopeLabel}
                  onChange={(stockValuation) => {
                    setTouched(true);
                    setPresentation({ ...presentation, stockValuation });
                  }}
                />
              ) : (
                <ReportResults
                  result={execution.result}
                  stateKey={key}
                  presentation={presentation}
                  setPresentation={(next) => {
                    setTouched(true);
                    setPresentation(next);
                  }}
                />
              )}
              <ReportExports
                key={
                  execution.result.generatedAt +
                  (isValuation ? JSON.stringify(presentation.stockValuation) : '')
                }
                entry={entry}
                result={execution.result}
                source={root}
                scopeLabel={scopeLabel}
                stockValuation={
                  isValuation ? normalizeValuationOptions(presentation.stockValuation) : undefined
                }
              />
            </>
          )}
        </>
      )}
    </div>
  );
}
