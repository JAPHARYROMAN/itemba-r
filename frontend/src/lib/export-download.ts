/**
 * Shared binary-export download helpers.
 *
 * One canonical implementation of "POST a JSON payload to the backend proxy and
 * download the binary response" so every export surface (customer statements,
 * the generic table-PDF endpoint, etc.) behaves identically: server error
 * messages are surfaced, the Content-Disposition filename is honoured, and the
 * blob is downloaded via a transient object URL. These endpoints return binary
 * blobs (not JSON), so they cannot go through the JSON api-client helpers — we
 * raw-fetch the proxy directly. The global CsrfFetchProvider automatically
 * attaches the CSRF token to POST /api/backend requests, so no manual CSRF
 * handling is required here.
 */

import { reportToTable } from './report-export';

const BACKEND_PROXY = '/api/backend';

/** Extract the filename from a Content-Disposition header, or the fallback. */
export function filenameFromDisposition(header: string | null, fallback: string): string {
  const match = /filename="?([^"]+)"?/i.exec(header ?? '');
  return match?.[1] ?? fallback;
}

/**
 * Download a binary export (PDF / Excel) produced by a POST endpoint. The proxy
 * streams the file back with a Content-Disposition filename; we honour it when
 * present and fall back to the supplied name otherwise. Throws with the server
 * error message on a non-2xx so callers can surface it via showToast.
 */
export async function downloadBinaryExport(
  path: string,
  body: unknown,
  fallbackName: string,
): Promise<void> {
  const res = await fetch(`${BACKEND_PROXY}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    let message = `Export failed (${res.status})`;
    try {
      const j = await res.json();
      if (j?.message) message = Array.isArray(j.message) ? j.message.join(', ') : j.message;
    } catch {
      // Non-JSON error body — keep the status-based fallback message.
    }
    throw new Error(message);
  }
  const filename = filenameFromDisposition(res.headers.get('Content-Disposition'), fallbackName);
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

/** Row cap enforced by the backend table-pdf DTO. */
export const TABLE_PDF_MAX_ROWS = 5000;

/** Clamp a string to the backend DTO length cap, marking the cut with an ellipsis. */
function clamp(s: string, max: number): string {
  return s.length > max ? `${s.slice(0, max - 1)}…` : s;
}

/** Request body for POST /generated-documents/table-pdf (see backend DTO). */
export interface TablePdfRequest {
  /** Document heading (≤120 chars). */
  title: string;
  /** Optional sub-heading, e.g. the active filters (≤160 chars). */
  subtitle?: string;
  /** Company whose letterhead/logo brands the PDF (defaults server-side). */
  companyId?: string;
  /** Column headers (1–40). */
  columns: string[];
  /** Row matrix (≤5000 rows, each the same length as `columns`). */
  rows: string[][];
  /** Optional label/value pairs rendered in the meta grid (≤12). */
  meta?: Array<{ label: string; value: string }>;
  /** Indices of columns to right-align as numeric. */
  numericColumns?: number[];
  /** Base filename (no extension) for the generated PDF (≤80 chars). */
  baseName?: string;
}

/**
 * Download a branded table PDF from the generic backend table-pdf endpoint.
 * Rows and strings are clamped client-side to the backend DTO caps so oversized
 * inputs (long search subtitles, >5000-row reports) degrade gracefully instead
 * of failing validation with a 400.
 */
export async function downloadTablePdf(req: TablePdfRequest): Promise<void> {
  const truncated = req.rows.length > TABLE_PDF_MAX_ROWS;
  const meta = (req.meta ?? []).map((entry) => ({
    label: clamp(entry.label, 60),
    value: clamp(entry.value, 200),
  }));
  if (truncated) {
    if (meta.length >= 12) meta.length = 11;
    meta.push({
      label: 'Note',
      value: `Showing first ${TABLE_PDF_MAX_ROWS} of ${req.rows.length} rows — use CSV for the full data`,
    });
  }
  const body: TablePdfRequest = {
    ...req,
    title: clamp(req.title, 120),
    subtitle: req.subtitle === undefined ? undefined : clamp(req.subtitle, 160),
    rows: truncated ? req.rows.slice(0, TABLE_PDF_MAX_ROWS) : req.rows,
    meta: meta.length > 0 ? meta : undefined,
    baseName: req.baseName === undefined ? undefined : clamp(req.baseName, 80),
  };
  const stamp = new Date().toISOString().slice(0, 10);
  const stem = body.baseName || body.title || 'export';
  await downloadBinaryExport('/generated-documents/table-pdf', body, `${stem}-${stamp}.pdf`);
}

/**
 * Download an arbitrary report response as a branded table PDF (mirror of
 * downloadReportCsv). Returns false if there was nothing tabular to export.
 */
export async function downloadReportPdf(
  data: unknown,
  baseName: string,
  opts?: { title?: string; subtitle?: string; companyId?: string },
): Promise<boolean> {
  const table = reportToTable(data);
  if (!table) return false;
  await downloadTablePdf({
    title: opts?.title ?? baseName,
    subtitle: opts?.subtitle,
    companyId: opts?.companyId,
    columns: table.columns,
    rows: table.rows,
    baseName,
  });
  return true;
}
