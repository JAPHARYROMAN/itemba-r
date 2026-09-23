import { flattenForCsv, isPrimitiveOrDate, pickPrimaryTable } from '@/lib/report-export';
import type { CatalogEntry, ReportFilters, ReportResultMetrics } from './report-viewer-types';
import { validStatementDate } from './reconciliation-types';
function stableClientHash(value: unknown): string {
  const json = JSON.stringify(value ?? null, (_, v) => {
    if (v && typeof v === 'object' && !Array.isArray(v)) {
      return Object.keys(v as Record<string, unknown>)
        .sort()
        .reduce(
          (acc, key) => {
            acc[key] = (v as Record<string, unknown>)[key];
            return acc;
          },
          {} as Record<string, unknown>,
        );
    }
    return v;
  });
  let hash = 2166136261;
  for (let i = 0; i < json.length; i += 1) {
    hash ^= json.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

export function summarizeResult(data: unknown): ReportResultMetrics {
  const primary = pickPrimaryTable(data);
  const columns = primary.rows.length ? flattenForCsv(primary.rows).columns : [];
  const scalars =
    data && typeof data === 'object' && !Array.isArray(data)
      ? Object.entries(data as Record<string, unknown>).filter(([, v]) => isPrimitiveOrDate(v))
      : [];
  const objectSections =
    data && typeof data === 'object' && !Array.isArray(data)
      ? Object.entries(data as Record<string, unknown>).filter(
          ([k, v]) =>
            !isPrimitiveOrDate(v) &&
            v !== null &&
            typeof v === 'object' &&
            !Array.isArray(v) &&
            k !== primary.key,
        )
      : [];
  return {
    rowCount: primary.rows.length,
    columnCount: columns.length,
    scalarCount: scalars.length,
    objectSectionCount: objectSections.length,
    primarySection: primary.key ?? 'Rows',
    dataHash: stableClientHash(data),
  };
}

export const reportLabel = (value: string) =>
  ({
    HR: 'HR and Payroll',
    RECORDS_BOOK: 'Records Book',
    FINANCIAL_STATEMENT: 'Financial',
    SELF_SERVICE: 'Custom',
  })[value] ||
  value
    .replaceAll('_', ' ')
    .toLowerCase()
    .replace(/^./, (c) => c.toUpperCase());
export const runnableReport = (entry: CatalogEntry) =>
  /^\/(?!\/)/.test(entry.apiPath) && !/\{(?!companyId\})/.test(entry.apiPath);
export function reportRequest(entry: CatalogEntry, filters: ReportFilters) {
  if (!runnableReport(entry) || /[\\#]/.test(entry.apiPath))
    throw new Error('Open this report in its business app.');
  for (const key of ['dateFrom', 'dateTo', 'asOf'] as const)
    if (filters[key] && !validStatementDate(filters[key]))
      throw new Error('Enter valid report dates.');
  if (filters.dateFrom && filters.dateTo && filters.dateFrom > filters.dateTo)
    throw new Error('The start date must be on or before the end date.');
  if (filters.divisionId && !filters.companyId)
    throw new Error('Choose a company before a division.');
  const embedded = entry.apiPath.includes('{companyId}');
  if (embedded && !filters.companyId) throw new Error('Choose a company to run this report.');
  const [base, search = ''] = entry.apiPath
    .replaceAll('{companyId}', encodeURIComponent(filters.companyId))
    .split('?');
  const query = Object.fromEntries(new URLSearchParams(search));
  for (const [key, value] of Object.entries(filters))
    if (value && !(embedded && key === 'companyId')) query[key] = value;
  return {
    path: base,
    query,
    sourceUrl: `/api/backend${base}${Object.keys(query).length ? '?' + new URLSearchParams(query) : ''}`,
  };
}
export const reportError = (cause: unknown) =>
  cause instanceof Error ? cause.message : 'This request could not be completed. Try again.';
export const safeReportLink = (href: string) =>
  /^\/(?!\/)/.test(href) && !/[\\\s]/.test(href) && !/%(?:2f|5c)/i.test(href.split('?')[0]);

/** Bound SVG work while preserving the first and last values of a long series. */
export function reportChartPoints(values: number[], limit = 200) {
  if (values.length <= limit) return values;
  return Array.from(
    { length: limit },
    (_, i) => values[Math.round((i * (values.length - 1)) / (limit - 1))],
  );
}
