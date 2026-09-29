export const RECORDS_PERMISSIONS = ['records.view', 'record_book.view'];
export const RECORD_REPORTS = [
  'daily-sales',
  'receipt-methods',
  'expenses-by-category',
  'expenses-by-payee',
  'net-movement',
  'branch-comparison',
  'monthly-trend',
] as const;
export type RecordsReport = (typeof RECORD_REPORTS)[number];
export type RecordsRoute =
  | {
      kind:
        | 'overview'
        | 'notebook'
        | 'daily-summary'
        | 'daily-sales'
        | 'money-out'
        | 'categories'
        | 'trash';
    }
  | { kind: 'reports'; report: RecordsReport }
  | { kind: 'sale' | 'expense'; id: string }
  | { kind: 'unavailable' };

/** Records Book bookmarks retain their source identity inside the Records host. */
export function recordsHref(href: string): string {
  if (!/^\/record-book(?:[/?#]|$)/.test(href)) return href;
  const url = new URL(href, 'https://workspace.local');
  url.pathname =
    url.pathname === '/record-book'
      ? '/records/daily-summary'
      : url.pathname
          .replace(/^\/record-book\/expenses(?=\/|$)/, '/records/money-out')
          .replace(/^\/record-book/, '/records');
  return `${url.pathname}${url.search}${url.hash}`;
}

export function recordsRoute(path: string, params: Pick<URLSearchParams, 'get'>): RecordsRoute {
  const canonical = recordsHref(path);
  if (canonical === '/records') {
    const view = params.get('view');
    return {
      kind: params.get('record') || (view && view !== 'overview') ? 'notebook' : 'overview',
    };
  }
  if (canonical === '/records/notebook') return { kind: 'notebook' };
  if (canonical === '/records/reports') {
    const report = params.get('report');
    return {
      kind: 'reports',
      report: RECORD_REPORTS.includes(report as RecordsReport)
        ? (report as RecordsReport)
        : 'daily-sales',
    };
  }
  const detail = /^\/records\/(daily-sales|money-out)\/([^/]+)$/.exec(canonical);
  if (detail) {
    try {
      return {
        kind: detail[1] === 'daily-sales' ? 'sale' : 'expense',
        id: decodeURIComponent(detail[2]),
      };
    } catch {
      return { kind: 'unavailable' };
    }
  }
  const section = canonical.slice('/records/'.length);
  if (
    canonical.startsWith('/records/') &&
    ['daily-summary', 'daily-sales', 'money-out', 'categories', 'trash'].includes(section)
  )
    return {
      kind: section as 'daily-summary' | 'daily-sales' | 'money-out' | 'categories' | 'trash',
    };
  return { kind: 'unavailable' };
}
