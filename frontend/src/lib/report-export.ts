/**
 * Shared report-export utilities.
 *
 * One canonical implementation of "turn an arbitrary report response into a
 * downloadable table" so every report surface (the generic /reports/run runner,
 * the finance reports page, etc.) exports identically. CSV opens directly in
 * Excel/Sheets, so it doubles as the "export to Excel" path without a binary
 * .xlsx dependency or the print-engine permission coupling.
 */

export const isPrimitive = (v: unknown): v is string | number | boolean =>
  v === null ||
  v === undefined ||
  typeof v === 'string' ||
  typeof v === 'number' ||
  typeof v === 'boolean';

export const isPrimitiveOrDate = (v: unknown): boolean => {
  if (isPrimitive(v)) return true;
  if (v instanceof Date) return true;
  if (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}/.test(v)) return true;
  return false;
};

export const isFlatObject = (obj: unknown): obj is Record<string, unknown> => {
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return false;
  return Object.values(obj).every(
    (v) =>
      isPrimitiveOrDate(v) ||
      (typeof v === 'object' &&
        v !== null &&
        !Array.isArray(v) &&
        Object.values(v as Record<string, unknown>).every(isPrimitiveOrDate)),
  );
};

/**
 * Walk a response and pick the most informative table to render/export: the
 * top-level array field with the most rows whose elements are flat objects.
 * Falls back to the response itself if it's already an array of flat objects.
 */
export function pickPrimaryTable(data: unknown): {
  key: string | null;
  rows: Record<string, unknown>[];
} {
  if (Array.isArray(data) && data.length > 0 && isFlatObject(data[0])) {
    return { key: null, rows: data as Record<string, unknown>[] };
  }
  if (data && typeof data === 'object') {
    let best: { key: string; rows: Record<string, unknown>[] } | null = null;
    for (const [k, v] of Object.entries(data as Record<string, unknown>)) {
      if (Array.isArray(v) && v.length > 0 && isFlatObject(v[0])) {
        if (!best || v.length > best.rows.length)
          best = { key: k, rows: v as Record<string, unknown>[] };
      }
    }
    if (best) return best;
  }
  return { key: null, rows: [] };
}

/** Convert a single cell value to an export-safe string: finite numbers only, valid dates as ISO. */
export function cellToString(val: unknown): string {
  if (val === null || val === undefined) return '';
  if (val instanceof Date) return Number.isNaN(val.getTime()) ? '' : val.toISOString();
  if (typeof val === 'number') return Number.isFinite(val) ? String(val) : '';
  return String(val);
}

/** Format a date-ish value as YYYY-MM-DD, or '' when missing/invalid (never throws). */
export function formatDateOnly(value: unknown): string {
  if (!value) return '';
  const d = new Date(value as string | number | Date);
  return Number.isNaN(d.getTime()) ? '' : d.toISOString().slice(0, 10);
}

/** Flatten rows (including one level of nested objects as `parent.child`) into a column matrix. */
export function flattenForCsv(rows: Record<string, unknown>[]): {
  columns: string[];
  data: string[][];
} {
  const columnSet = new Set<string>();
  for (const r of rows) {
    for (const [k, v] of Object.entries(r)) {
      if (isPrimitiveOrDate(v)) {
        columnSet.add(k);
      } else if (v && typeof v === 'object' && !Array.isArray(v)) {
        for (const sk of Object.keys(v as Record<string, unknown>)) {
          columnSet.add(`${k}.${sk}`);
        }
      }
    }
  }
  const columns = Array.from(columnSet);
  const data = rows.map((r) =>
    columns.map((c) => {
      const dot = c.indexOf('.');
      let val: unknown;
      if (dot === -1) {
        val = r[c];
      } else {
        const head = c.slice(0, dot);
        const tail = c.slice(dot + 1);
        const parent = r[head] as Record<string, unknown> | undefined;
        val = parent?.[tail];
      }
      return cellToString(val);
    }),
  );
  return { columns, data };
}

export function toCsv(columns: string[], rows: string[][]): string {
  const escape = (s: string) => (/[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s);
  return [columns, ...rows].map((row) => row.map(escape).join(',')).join('\n');
}

/** Trigger a browser download of a string payload as a file. */
export function downloadTextFile(filename: string, mimeType: string, contents: string): void {
  const blob = new Blob([contents], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

/**
 * Turn an arbitrary report response into an ordered column/row string matrix
 * (auto-detecting its primary table). Returns null when there is no tabular
 * data. Shared by the CSV and table-PDF export paths so both render the same
 * table for the same response.
 */
export function reportToTable(data: unknown): { columns: string[]; rows: string[][] } | null {
  const primary = pickPrimaryTable(data);
  if (!primary.rows.length) return null;
  const { columns, data: rows } = flattenForCsv(primary.rows);
  return { columns, rows };
}

/**
 * Build a CSV string from an arbitrary report response (auto-detecting its
 * primary table). Returns an empty string when there is no tabular data.
 */
export function reportToCsv(data: unknown): string {
  const primary = pickPrimaryTable(data);
  if (!primary.rows.length) return '';
  const { columns, data: rows } = flattenForCsv(primary.rows);
  return toCsv(columns, rows);
}

/** Build CSV from explicit rows + ordered columns (when you already have a typed table). */
export function rowsToCsv(rows: Record<string, unknown>[], columns?: string[]): string {
  if (!rows.length) return '';
  if (columns && columns.length) {
    const matrix = rows.map((r) => columns.map((c) => cellToString(r[c])));
    return toCsv(columns, matrix);
  }
  const flat = flattenForCsv(rows);
  return toCsv(flat.columns, flat.data);
}

/** Download an arbitrary report response as a CSV file. Returns false if there was nothing to export. */
export function downloadReportCsv(data: unknown, baseName: string): boolean {
  const csv = reportToCsv(data);
  if (!csv) return false;
  const stamp = new Date().toISOString().slice(0, 10);
  downloadTextFile(`${baseName}-${stamp}.csv`, 'text/csv;charset=utf-8', csv);
  return true;
}

/** Download any value as pretty-printed JSON. */
export function downloadReportJson(data: unknown, baseName: string): void {
  const stamp = new Date().toISOString().slice(0, 10);
  downloadTextFile(`${baseName}-${stamp}.json`, 'application/json', JSON.stringify(data, null, 2));
}
