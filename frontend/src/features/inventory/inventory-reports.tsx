'use client';
import { useEffect, useRef, useState } from 'react';
import {
  Btn,
  EmptyState,
  FormSelect,
  PageHeader,
  PageSpinner,
  PermissionDeniedState,
} from '@/components/ui';
import { RecordBrowser } from '@/components/workspace/record-browser';
import { useWorkspaceState } from '@/components/workspace/workspace-session';
import { StockValuationView } from './stock-valuation-view';
import { printWorkspace } from '@/components/workspace/print-workspace';
import {
  DEFAULT_VALUATION,
  VALUATION_NOTE,
  normalizeValuationOptions,
  valuationRows,
  valuationTable,
  valuationSummary,
  valuationFilterLabel,
} from './stock-valuation-format';
import { useAuth } from '@/hooks/use-auth';
import { useWorkspaceResource } from '@/hooks/use-workspace-resource';
import { useWorkspaceChoices } from '@/hooks/use-workspace-choices';
import { downloadBinaryExport, downloadTablePdf, TABLE_PDF_MAX_ROWS } from '@/lib/export-download';
import { cellToString, downloadTextFile, rowsToCsv } from '@/lib/report-export';
import { useInventoryWorkspace } from './inventory-workspace-context';
import {
  INVENTORY_REPORTS,
  normalizeInventoryReport,
  reportColumns,
  reportHeading,
  reportIsPaged,
  reportMeasures,
  reportName,
  reportReview,
  reportValue,
  type ReportResult,
  type ReportRow,
} from './inventory-report-data';
import { loadInventoryReport } from './inventory-report-loader';
import './inventory-workspace.css';

export default function InventoryReports() {
  const root = useRef<HTMLDivElement>(null);
  const workspace = useInventoryWorkspace();
  const { hasPermission, loading: authLoading } = useAuth();
  const available = INVENTORY_REPORTS.filter(
    (r) =>
      !authLoading &&
      hasPermission(
        r.source === 'operations' ? 'operations.reports.view' : 'westsides.reports.view',
      ),
  );
  const [selected, setSelected] = useState('stock-valuation');
  const report = available.find((r) => r.key === selected) || available[0];
  const isValuation = report?.key === 'stock-valuation';
  const [valuation, setValuation] = useWorkspaceState(
    'inventory.valuation.format',
    DEFAULT_VALUATION,
  );
  const valuationOptions = normalizeValuationOptions(valuation);
  const scope = workspace?.scope || { companyId: '', divisionId: '', branchId: '' };
  const key = JSON.stringify([report?.key, scope]);
  const [paging, setPaging] = useState({ key: '', page: 1 });
  const page = paging.key === key ? paging.page : 1;
  const query = {
    ...scope,
    ...(report && reportIsPaged(report.key) ? { page, pageSize: 20 } : {}),
  };
  const result = useWorkspaceResource<unknown>(
    report?.endpoint || '',
    query,
    !!report && !!scope.companyId,
  );
  const companies = useWorkspaceChoices<{ id: string; name: string }>(
    '/companies',
    {},
    !!report && hasPermission('companies.read'),
  );
  const divisions = useWorkspaceChoices<{ id: string; name: string }>(
    '/divisions',
    { companyId: scope.companyId },
    !!report && !!scope.companyId && hasPermission('divisions.read'),
  );
  const branches = useWorkspaceChoices<{ id: string; name: string }>(
    '/branches',
    { companyId: scope.companyId },
    !!report && !!scope.companyId && hasPermission('branches.read'),
  );
  const scopeLabels = [
    companies.rows.find((r) => r.id === scope.companyId)?.name || scope.companyId,
    scope.divisionId
      ? divisions.rows.find((r) => r.id === scope.divisionId)?.name || scope.divisionId
      : 'All divisions',
    scope.branchId
      ? branches.rows.find((r) => r.id === scope.branchId)?.name || scope.branchId
      : 'All branches',
  ];
  let data: ReportResult | null = null,
    invalid = '';
  if (result.data !== null) {
    try {
      data = normalizeInventoryReport(result.data);
    } catch (error) {
      invalid = error instanceof Error ? error.message : 'Unable to read report.';
    }
  }
  const matchingRows = isValuation
    ? valuationRows(data?.rows || [], valuationOptions)
    : data?.rows || [];
  const total = isValuation ? matchingRows.length : data?.total || 0;
  const hasData = !!data;
  useEffect(() => {
    if (hasData && page > Math.max(1, Math.ceil(total / 20)))
      setPaging({ key, page: Math.max(1, Math.ceil(total / 20)) });
  }, [key, total, page, hasData]);
  const [exporting, setExporting] = useState(false),
    [exportError, setExportError] = useState('');
  const exportRef = useRef<AbortController | null>(null);
  const exportKey = key + (isValuation ? JSON.stringify(valuationOptions) : '');
  useEffect(() => {
    exportRef.current?.abort();
    setExporting(false);
    setExportError('');
    return () => exportRef.current?.abort();
  }, [exportKey]);
  const refresh = () => {
    exportRef.current?.abort();
    setExporting(false);
    setExportError('');
    result.reload();
  };
  async function exportReport(format: 'csv' | 'pdf' | 'xlsx') {
    if (!report || !data || result.loading || result.error || exporting) return;
    const controller = new AbortController();
    exportRef.current = controller;
    setExporting(true);
    setExportError('');
    try {
      const complete = await loadInventoryReport(
        report,
        { ...scope },
        controller.signal,
        format !== 'csv' && !isValuation ? TABLE_PDF_MAX_ROWS : Infinity,
      );
      const exportRows = isValuation
        ? valuationRows(complete.rows, valuationOptions)
        : complete.rows;
      if (!exportRows.length) throw new Error('There are no rows to export. Refresh the report.');
      if (format !== 'csv' && exportRows.length > TABLE_PDF_MAX_ROWS)
        throw new Error(
          'Document exports support up to 5,000 matching rows. Narrow the filters or use CSV.',
        );
      const columns = reportColumns(exportRows, report);
      const review = exportRows.some((row) => reportReview(row) !== '—');
      const stockTable = isValuation ? valuationTable(exportRows, valuationOptions) : null;
      const headers = stockTable?.columns || [
        ...columns.map(reportHeading),
        ...(review ? ['Review note'] : []),
      ];
      const matrix =
        stockTable?.rows ||
        exportRows.map((row) => [
          ...columns.map((column) => cellToString(row[column])),
          ...(review ? [reportReview(row)] : []),
        ]);
      controller.signal.throwIfAborted();
      if (format === 'csv') {
        const records = matrix.map((row) =>
          Object.fromEntries(headers.map((header, index) => [header, row[index]])),
        );
        const csv = rowsToCsv(records, headers);
        const metadata = rowsToCsv([
          { Field: 'Report', Value: report.title },
          { Field: 'Scope', Value: scopeLabels.join(' · ') },
          { Field: 'Rows', Value: String(exportRows.length) },
          ...(isValuation
            ? [
                { Field: 'Filters', Value: valuationFilterLabel(valuationOptions) },
                ...valuationSummary(exportRows, valuationOptions).map((item) => ({
                  Field: item.label,
                  Value: item.value,
                })),
                { Field: 'Basis', Value: VALUATION_NOTE },
              ]
            : []),
          { Field: 'Generated at', Value: complete.generatedAt || new Date().toISOString() },
          ...(complete.notice ? [{ Field: 'Note', Value: complete.notice }] : []),
        ]);
        downloadTextFile(
          report.key + '.csv',
          'text/csv;charset=utf-8',
          csv + '\r\n\r\n' + metadata,
        );
      } else {
        const document = {
          title: report.title,
          subtitle: scopeLabels.join(' · '),
          companyId: scope.companyId,
          columns: headers,
          rows: matrix,
          orientation: 'landscape' as const,
          ...(stockTable
            ? {
                numericColumns: stockTable.numericColumns,
                columnWeights: stockTable.columnWeights,
                stripedRows: true,
                summary: valuationSummary(exportRows, valuationOptions),
              }
            : {}),
          meta: [
            { label: 'Company', value: scopeLabels[0] },
            { label: 'Division', value: scopeLabels[1] },
            { label: 'Branch', value: scopeLabels[2] },
            { label: 'Rows', value: String(exportRows.length) },
            { label: 'Retrieved at', value: complete.generatedAt || new Date().toISOString() },
            ...(isValuation
              ? [{ label: 'Filters', value: valuationFilterLabel(valuationOptions) }]
              : []),
          ],
          note: [isValuation && VALUATION_NOTE, complete.notice].filter(Boolean).join(' '),
          baseName: report.key,
        };
        if (format === 'pdf') await downloadTablePdf(document, controller.signal);
        else
          await downloadBinaryExport(
            '/generated-documents/table-export',
            { ...document, format: 'xlsx' },
            report.key + '.xlsx',
            controller.signal,
          );
      }
    } catch (error) {
      if (!controller.signal.aborted)
        setExportError(error instanceof Error ? error.message : 'Unable to export report.');
    } finally {
      if (!controller.signal.aborted) setExporting(false);
    }
  }
  if (authLoading) return <PageSpinner label="Loading report access" />;
  if (!report)
    return (
      <PermissionDeniedState description="Your role does not include inventory report access." />
    );
  const measures = reportMeasures(report.key);
  const columns = reportColumns(data?.rows || [], report);
  const rows = reportIsPaged(report.key)
    ? data?.rows || []
    : (data?.rows || []).slice((page - 1) * 20, page * 20);
  const records: (ReportRow & { id: string })[] = rows.map((row, index) => ({
    ...row,
    id: String((page - 1) * 20 + index),
  }));
  const disabled = exporting || result.loading || !!result.error || !!invalid || !total;
  return (
    <div className="business-workspace inventory-overview inventory-reports" ref={root}>
      <PageHeader
        title="Inventory reports"
        subtitle="Review stock, movements and losses in one place."
      />
      <div className="inventory-report-toolbar">
        <FormSelect
          label="Inventory report"
          value={report.key}
          onChange={(event) => setSelected(event.target.value)}
        >
          {available.map((item) => (
            <option key={item.key} value={item.key}>
              {item.title}
            </option>
          ))}
        </FormSelect>
        <div className="inventory-actions">
          <Btn variant="ghost" disabled={!scope.companyId || result.loading} onClick={refresh}>
            Refresh report
          </Btn>
          <Btn variant="secondary" disabled={disabled} onClick={() => void exportReport('csv')}>
            Export CSV
          </Btn>
          <Btn variant="secondary" disabled={disabled} onClick={() => void exportReport('pdf')}>
            Export PDF
          </Btn>
          {isValuation && (
            <Btn variant="secondary" disabled={disabled} onClick={() => void exportReport('xlsx')}>
              Export Excel
            </Btn>
          )}
          {isValuation && (
            <Btn
              variant="secondary"
              disabled={disabled}
              onClick={() => printWorkspace(root.current)}
            >
              Print stock valuation
            </Btn>
          )}
        </div>
      </div>
      <div className="inventory-section-heading">
        <div>
          <h2>{report.title}</h2>
          <p>{report.description}</p>
        </div>
      </div>
      {!scope.companyId ? (
        <EmptyState
          title="Select a company to run reports"
          description="Choose a company above. Division and branch can remain unselected to include all of its stock."
        />
      ) : (
        <>
          <p className="inventory-register-note">
            {scopeLabels.join(' · ')}. Quantities are shown in each row’s unit; monetary values are
            in TZS.
          </p>
          {data?.notice && (
            <p role="note" className="workspace-notice">
              {data.notice}
            </p>
          )}
          {exporting && (
            <p role="status" className="inventory-register-note">
              Preparing the complete report…
            </p>
          )}
          {exportError && (
            <p role="alert" className="workspace-notice">
              {exportError}
            </p>
          )}
          {isValuation ? (
            result.loading ? (
              <PageSpinner label="Loading stock valuation" />
            ) : result.error || invalid ? (
              <div role="alert" className="workspace-notice">
                <p>{result.error || invalid}</p>
                <Btn onClick={refresh}>Try again</Btn>
              </div>
            ) : (
              <StockValuationView
                rows={data?.rows || []}
                options={valuationOptions}
                onChange={setValuation}
                companyId={scope.companyId}
                companyName={scopeLabels[0]}
                scopeLabel={scopeLabels.join(' · ')}
              />
            )
          ) : (
            <div
              className="inventory-report-results"
              style={
                {
                  '--report-first-label': JSON.stringify(reportHeading(measures[0])),
                  '--report-second-label': JSON.stringify(reportHeading(measures[1])),
                } as React.CSSProperties
              }
            >
              <RecordBrowser<ReportRow & { id: string }>
                key={key + ':' + page}
                title={report.title}
                records={records}
                name={reportName}
                reference={(row) =>
                  [row.productCode, row.branch, row.unit].filter(Boolean).join(' · ')
                }
                status={(row) =>
                  String(
                    row.status ||
                      row.stockStatus ||
                      row.readinessStatus ||
                      row.movementType ||
                      'REPORTED',
                  )
                }
                fields={measures.map((column) => ({
                  label: reportHeading(column),
                  value: (row) =>
                    reportValue(column, row[column]) +
                    (/quantity/i.test(column) && row.unit ? ' ' + row.unit : ''),
                }))}
                details={[
                  ...columns
                    .filter((column) => !measures.includes(column))
                    .map((column) => ({
                      label: reportHeading(column),
                      value: (row: (typeof records)[number]) => reportValue(column, row[column]),
                    })),
                  { label: 'Review note', value: reportReview },
                ]}
                loading={result.loading}
                error={result.error || invalid}
                onRetry={refresh}
                empty="No records match the selected inventory scope."
                page={page}
                total={total}
                pageSize={20}
                onPage={(next) => setPaging({ key, page: next })}
              />
            </div>
          )}
        </>
      )}
    </div>
  );
}
