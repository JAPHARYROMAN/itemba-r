import { backendGet } from '@/lib/api-client';
import {
  normalizeInventoryReport,
  reportIsPaged,
  type ReportDefinition,
  type ReportResult,
} from './inventory-report-data';

/** Export reads every page; an interrupted or inconsistent read never yields a partial file. */
export async function loadInventoryReport(
  report: ReportDefinition,
  scope: Record<string, string>,
  signal: AbortSignal,
  maxRows = Infinity,
): Promise<ReportResult> {
  let page = 1;
  let complete: ReportResult | undefined;
  do {
    signal.throwIfAborted();
    const payload = await backendGet<unknown>(report.endpoint, {
      signal,
      query: { ...scope, ...(reportIsPaged(report.key) ? { page, pageSize: 1000 } : {}) },
    });
    signal.throwIfAborted();
    const next = normalizeInventoryReport(payload);
    if (next.total > maxRows)
      throw new Error('PDF supports up to 5,000 rows. Use CSV for the complete report.');
    if (!complete) complete = { ...next, rows: [...next.rows] };
    else {
      if (next.total !== complete.total)
        throw new Error('The report changed during export. Refresh and try again.');
      complete.rows.push(...next.rows);
    }
    if (
      complete.rows.length > complete.total ||
      (!next.rows.length && complete.rows.length < complete.total)
    )
      throw new Error('The report returned incomplete pages. Refresh and try again.');
    if (complete.rows.length === complete.total) return complete;
    if (!reportIsPaged(report.key)) throw new Error('The report response is incomplete.');
    page++;
  } while (true);
}
