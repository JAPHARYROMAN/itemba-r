'use client';
import { useEffect, useLayoutEffect, useRef, useState, type RefObject } from 'react';
import { Btn, Card } from '@/components/ui';
import { FormSelect } from '@/components/aurora';
import { useAuth } from '@/hooks/use-auth';
import { useWorkspaceResource } from '@/hooks/use-workspace-resource';
import { backendPost } from '@/lib/api-client';
import { downloadTextFile, pickPrimaryTable, reportToTable, toCsv } from '@/lib/report-export';
import {
  VALUATION_NOTE,
  valuationRows,
  valuationTable,
  valuationSummary,
  valuationFilterLabel,
  type ValuationOptions,
} from '@/features/inventory/stock-valuation-format';
import { downloadBinaryExport, downloadTablePdf } from '@/lib/export-download';
import { printWorkspace } from '@/components/workspace/print-workspace';
import { reportError, summarizeResult } from './report-viewer-utils';
import type { CatalogEntry, ExportAuditHistory, ExportAuditResponse } from './report-viewer-types';
import type { ReportExecution } from './use-report-execution';

export function ReportExports({
  entry,
  result,
  source,
  scopeLabel,
  stockValuation,
}: {
  entry: CatalogEntry;
  result: ReportExecution;
  source: RefObject<HTMLDivElement | null>;
  scopeLabel: string;
  stockValuation?: ValuationOptions;
}) {
  const { hasPermission } = useAuth();
  const allowed = hasPermission(entry.permission);
  const live = useRef(allowed);
  useLayoutEffect(() => {
    live.current = allowed;
  });
  const pending = useRef<AbortController | null>(null);
  useEffect(
    () => () => {
      pending.current?.abort();
    },
    [],
  );
  const [format, setFormat] = useState('pdf'),
    [busy, setBusy] = useState(false),
    [message, setMessage] = useState(''),
    [error, setError] = useState('');
  const history = useWorkspaceResource<ExportAuditHistory>(
    `/reports/export-audit/${encodeURIComponent(entry.id)}`,
    { companyId: result.filters.companyId, limit: 8 },
    allowed,
  );
  async function exportResult(selected: string) {
    if (!live.current || pending.current) return;
    const controller = new AbortController();
    pending.current = controller;
    setBusy(true);
    setMessage('');
    setError('');
    try {
      const filename = `${entry.id}-${result.generatedAt.slice(0, 10)}`;
      const stockRows = stockValuation
        ? valuationRows(pickPrimaryTable(result.data).rows, stockValuation)
        : [];
      const stockTable = stockValuation ? valuationTable(stockRows, stockValuation) : null;
      const table = stockTable || reportToTable(result.data);
      const exportData =
        stockValuation && table
          ? table.rows.map((row) =>
              Object.fromEntries(table.columns.map((column, index) => [column, row[index]])),
            )
          : result.data;
      if (stockValuation && !stockRows.length)
        throw new Error('No stock matches these filters. Adjust the filters before exporting.');
      if (['csv', 'pdf', 'docx', 'xlsx', 'txt'].includes(selected) && !table)
        throw new Error('This result has no table to export. Use JSON or print the current view.');
      if (
        ['pdf', 'docx', 'xlsx', 'txt'].includes(selected) &&
        table &&
        (table.rows.length > 5000 || table.columns.length > 40)
      )
        throw new Error(
          'Document exports support up to 5,000 rows and 40 columns. Narrow the report or use CSV or JSON for the full result.',
        );
      if (selected === 'csv')
        downloadTextFile(
          `${filename}.csv`,
          'text/csv;charset=utf-8',
          toCsv(table!.columns, table!.rows),
        );
      else if (selected === 'json')
        downloadTextFile(
          `${filename}.json`,
          'application/json',
          JSON.stringify(exportData, null, 2),
        );
      else if (selected === 'copy') {
        if (!navigator.clipboard)
          throw new Error('Clipboard access is unavailable. Download JSON instead.');
        await navigator.clipboard.writeText(JSON.stringify(exportData, null, 2));
      } else if (selected === 'print') printWorkspace(source.current);
      else {
        const body = {
          title: entry.name,
          subtitle: scopeLabel,
          companyId: result.filters.companyId || undefined,
          columns: table!.columns,
          rows: table!.rows,
          baseName: entry.id,
          ...(stockValuation
            ? {
                orientation: 'landscape' as const,
                numericColumns: stockTable!.numericColumns,
                columnWeights: stockTable!.columnWeights,
                stripedRows: true,
                summary: valuationSummary(stockRows, stockValuation),
                meta: [
                  { label: 'Filters', value: valuationFilterLabel(stockValuation) },
                  { label: 'Retrieved at', value: result.generatedAt },
                  { label: 'Stock positions', value: String(stockRows.length) },
                ],
                note: VALUATION_NOTE,
              }
            : {}),
        };
        if (selected === 'pdf') await downloadTablePdf(body, controller.signal);
        else
          await downloadBinaryExport(
            '/generated-documents/table-export',
            {
              ...body,
              title: body.title.slice(0, 120),
              subtitle: body.subtitle.slice(0, 160),
              baseName: body.baseName.slice(0, 80),
              format: selected,
            },
            `${filename}.${selected}`,
            controller.signal,
          );
      }
      if (controller.signal.aborted || !live.current) return;
      const completed =
        selected === 'print'
          ? stockValuation
            ? 'Print dialog requested for all matching stock positions.'
            : 'Print dialog requested for the current visible page.'
          : selected === 'copy'
            ? 'Report JSON copied.'
            : 'Report export prepared.';
      setMessage(completed);
      const metrics = summarizeResult(exportData);
      try {
        await backendPost<ExportAuditResponse>(
          '/reports/export-audit',
          {
            reportId: entry.id,
            companyId: result.filters.companyId || undefined,
            format:
              selected === 'copy' ? 'JSON' : selected === 'print' ? 'PDF' : selected.toUpperCase(),
            runId: result.manifest?.runId,
            sourceUrl: result.sourceUrl,
            ...metrics,
            dataHash: stockValuation
              ? metrics.dataHash
              : result.manifest?.manifestHash || metrics.dataHash,
            sectionCount:
              metrics.objectSectionCount +
              (metrics.rowCount ? 1 : 0) +
              (metrics.scalarCount ? 1 : 0),
            parameters: {
              ...result.filters,
              action:
                selected === 'print'
                  ? stockValuation
                    ? 'PRINT_FILTERED_STOCK'
                    : 'PRINT_VISIBLE_PAGE'
                  : selected === 'copy'
                    ? 'COPY_JSON'
                    : 'DOWNLOAD',
              ...(stockValuation
                ? { stockValuation, sourceManifestHash: result.manifest?.manifestHash }
                : {}),
            },
          },
          { signal: controller.signal },
        );
        if (!controller.signal.aborted && live.current) {
          setMessage(`${completed} Export activity recorded.`);
          history.reload();
        }
      } catch (cause) {
        if (!controller.signal.aborted)
          setError(`${completed} Its activity record could not be saved: ${reportError(cause)}`);
      }
    } catch (cause) {
      if (!controller.signal.aborted) setError(reportError(cause));
    } finally {
      if (pending.current === controller) pending.current = null;
      if (!controller.signal.aborted) setBusy(false);
    }
  }
  return (
    <Card className="report-viewer-section report-no-print">
      <h3>Export and print</h3>
      <div className="report-actions">
        <FormSelect
          label="Export format"
          value={format}
          disabled={busy}
          options={[
            { value: 'pdf', label: 'PDF' },
            { value: 'docx', label: 'Word' },
            { value: 'xlsx', label: 'Excel' },
            { value: 'csv', label: 'CSV' },
            { value: 'txt', label: 'Text' },
            { value: 'json', label: 'JSON' },
          ]}
          onChange={(event) => setFormat(event.target.value)}
        />
        <Btn disabled={!allowed || busy} loading={busy} onClick={() => void exportResult(format)}>
          Export report
        </Btn>
        <Btn
          variant="secondary"
          disabled={!allowed || busy}
          onClick={() => void exportResult('print')}
        >
          {stockValuation ? 'Print stock valuation' : 'Print visible page'}
        </Btn>
        <Btn
          variant="secondary"
          disabled={!allowed || busy}
          onClick={() => void exportResult('copy')}
        >
          Copy JSON
        </Btn>
      </div>
      <p>
        {stockValuation ? (
          'Every format includes all matching stock positions and only the chosen columns. Printing includes all matching pages. '
        ) : (
          <>
            Table exports include all rows in the main result table, regardless of row search or
            pagination. JSON includes every section.{' '}
          </>
        )}
        Document exports use the selected company’s letterhead, with the configured group fallback.
      </p>
      {message && <p role="status">{message}</p>}
      {error && (
        <p role="alert" className="workspace-notice">
          {error}
        </p>
      )}
      <details className="report-disclosure">
        <summary>Recent export activity</summary>
        <div>
          <Btn variant="secondary" onClick={history.reload}>
            Refresh export activity
          </Btn>
          {history.loading ? (
            <p role="status">Loading export activity…</p>
          ) : history.error ? (
            <p role="alert">{history.error}</p>
          ) : history.data?.exports.length ? (
            <ul>
              {history.data.exports.map((row) => (
                <li key={row.id}>
                  <strong>{row.exportNumber}</strong> · {row.format} · {row.status}
                  <p>{row.completedAt || row.createdAt}</p>
                  {row.auditHash && <p>Record {row.auditHash}</p>}
                </li>
              ))}
            </ul>
          ) : (
            <p>No export activity was returned for this report and company.</p>
          )}
        </div>
      </details>
    </Card>
  );
}
