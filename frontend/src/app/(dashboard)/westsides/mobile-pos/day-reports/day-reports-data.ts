/**
 * Pure data helpers for the office-side Mobile POS day-report register.
 *
 * The phone closes its day with `POST /mobile-pos-lite/day-reports`
 * (spec-history-reports §1.3) and the office reads the resulting records with
 * `GET /mobile-pos-lite/day-reports` (§1.5). Everything on the record except
 * `declaredHeld*` is recomputed server-side from SalesOrder rows, so this file
 * never derives a figure the server did not send — it only coerces, formats,
 * and filters what arrived.
 *
 * Coercion is deliberately tolerant. `grossTotal` / `itemsSoldQuantity` /
 * `declaredHeldAmount` are Prisma `Decimal` columns and `byMethod` / `items`
 * are `Json`, so a serialiser change upstream can turn a number into a string
 * or a nested ref into the flat snapshot columns the table actually stores
 * (`terminalCode`, `branchName`, `repName`). Both shapes are accepted here so
 * the register degrades to "missing label" rather than to a blank screen.
 *
 * The one thing this file DOES derive is which rows a total may add — see
 * `annotateSupersession` below, and read it before touching any figure the
 * register puts in front of an accountant.
 */

import type { TablePdfRequest } from '@/lib/export-download';

/** A named reference as the office list renders it (terminal / branch / rep). */
export interface DayReportRef {
  id: string;
  name: string;
  code?: string;
}

/** One payment-method row of the server-computed breakdown. */
export interface DayReportMethodLine {
  paymentMethod: string;
  /** The terminal's own configured label; CREDIT has no configured row. */
  label: string | null;
  count: number;
  amount: number;
}

/** One product row of the server-computed item breakdown (capped at 50). */
export interface DayReportItemLine {
  productId: string;
  name: string;
  quantity: number;
  amount: number;
}

/** A submitted end-of-day report, as the office reads it. */
export interface MobilePosDayReport {
  id: string;
  /** Calendar date the rep closed, `YYYY-MM-DD`. */
  businessDate: string;
  reference: string;
  submittedAt: string;
  terminal: DayReportRef;
  branch: DayReportRef;
  rep: DayReportRef;
  salesCount: number;
  grossTotal: number;
  itemsSoldQuantity: number;
  byMethod: DayReportMethodLine[];
  items: DayReportItemLine[];
  itemsTruncated: boolean;
  /** Declared by the PHONE — sales still in its outbox, NOT in `grossTotal`. */
  declaredHeldCount: number;
  declaredHeldAmount: number;
}

/**
 * The office list endpoint caps at 100 rows (spec §1.5) and has no page
 * parameter, so the register tells the reader when the cap has bitten instead
 * of silently showing a partial answer as if it were the whole one.
 */
export const DAY_REPORT_WINDOW_LIMIT = 100;

/** Client-side narrowing the endpoint's query contract does not carry. */
export interface DayReportFilters {
  companyId?: string;
  branchId?: string;
  repId?: string;
}

const record = (value: unknown): Record<string, unknown> =>
  value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};

/** Coerce a wire value (number, Decimal string, null) to a finite number. */
export function toNum(value: unknown): number {
  if (value === null || value === undefined || value === '') return 0;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function toText(value: unknown): string {
  return typeof value === 'string'
    ? value
    : value === null || value === undefined
      ? ''
      : String(value);
}

/**
 * Read a business date as the calendar day it names, never as an instant.
 * `new Date('2026-08-14')` is UTC midnight and slips a day west of Greenwich;
 * the parts are taken as written so the office reads the day the rep closed.
 */
export function parseBusinessDate(value: string): Date | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(toText(value));
  if (!match) return null;
  const parsed = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

/** `2026-08-14` → `14 Aug 2026`; anything unparseable falls back to an em dash. */
export function formatBusinessDate(value: string): string {
  const parsed = parseBusinessDate(value);
  if (!parsed) return '—';
  return parsed.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
}

/** Submission instants are real instants, so they render in the reader's zone. */
export function formatDateTime(value: string | null | undefined): string {
  if (!value) return '—';
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime())
    ? '—'
    : parsed.toLocaleString('en-GB', {
        day: '2-digit',
        month: 'short',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      });
}

/** Money is always TZS on this surface — the POS sells in one currency. */
export function formatMoney(value: unknown): string {
  return `TZS ${new Intl.NumberFormat('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(toNum(value))}`;
}

/** Quantities carry up to four decimals on the record; trailing zeros are noise. */
export function formatQuantity(value: unknown): string {
  return new Intl.NumberFormat('en-US', { maximumFractionDigits: 4 }).format(toNum(value));
}

/** `MOBILE_MONEY` → `Mobile money`, used only when the terminal set no label. */
export function humanizePaymentMethod(method: string): string {
  const cleaned = toText(method).replace(/_/g, ' ').trim();
  if (!cleaned) return 'Unknown';
  return cleaned.charAt(0).toUpperCase() + cleaned.slice(1).toLowerCase();
}

/** The terminal's configured label wins; CREDIT and friends fall back to the code. */
export function methodLabel(line: DayReportMethodLine): string {
  const configured = toText(line.label).trim();
  return configured || humanizePaymentMethod(line.paymentMethod);
}

function normalizeRef(
  nested: unknown,
  fallback: { id?: unknown; name?: unknown; code?: unknown },
): DayReportRef {
  const source = record(nested);
  const id = toText(source.id) || toText(fallback.id);
  const name = toText(source.name) || toText(fallback.name);
  const code = toText(source.code) || toText(fallback.code);
  return code ? { id, name, code } : { id, name };
}

function normalizeMethods(value: unknown): DayReportMethodLine[] {
  if (!Array.isArray(value)) return [];
  return value.map((entry) => {
    const line = record(entry);
    const label = toText(line.label).trim();
    return {
      paymentMethod: toText(line.paymentMethod),
      label: label || null,
      count: toNum(line.count),
      amount: toNum(line.amount),
    };
  });
}

function normalizeItems(value: unknown): DayReportItemLine[] {
  if (!Array.isArray(value)) return [];
  return value.map((entry) => {
    const line = record(entry);
    return {
      productId: toText(line.productId),
      name: toText(line.name),
      quantity: toNum(line.quantity),
      amount: toNum(line.amount),
    };
  });
}

/**
 * Coerce one wire row into the shape the register renders. Returns null for a
 * row with no id — an unidentifiable report cannot be opened or exported, and
 * dropping it is better than rendering a row that does nothing when clicked.
 */
export function normalizeDayReport(raw: unknown): MobilePosDayReport | null {
  const row = record(raw);
  const id = toText(row.id);
  if (!id) return null;

  const businessDate = toText(row.businessDate).slice(0, 10);
  const terminal = normalizeRef(row.terminal, {
    id: row.terminalId,
    name: row.terminalName,
    code: row.terminalCode,
  });

  return {
    id,
    businessDate,
    reference:
      toText(row.reference) ||
      // §1.3 derives the reference rather than storing it; a serialiser that
      // omits it should not leave the row without a human handle.
      (terminal.code && businessDate
        ? `${terminal.code}-${businessDate.replace(/-/g, '')}`
        : id.slice(0, 8)),
    submittedAt: toText(row.submittedAt),
    terminal,
    branch: normalizeRef(row.branch, { id: row.branchId, name: row.branchName }),
    rep: normalizeRef(row.rep, { id: row.repUserId, name: row.repName }),
    salesCount: toNum(row.salesCount),
    grossTotal: toNum(row.grossTotal),
    itemsSoldQuantity: toNum(row.itemsSoldQuantity),
    byMethod: normalizeMethods(row.byMethod),
    items: normalizeItems(row.items),
    itemsTruncated: row.itemsTruncated === true,
    declaredHeldCount: toNum(row.declaredHeldCount),
    declaredHeldAmount: toNum(row.declaredHeldAmount),
  };
}

/** Coerce a whole page of wire rows, dropping the unidentifiable ones. */
export function normalizeDayReports(raw: unknown[]): MobilePosDayReport[] {
  return raw
    .map(normalizeDayReport)
    .filter((report): report is MobilePosDayReport => report !== null);
}

/**
 * Apply the narrowing the endpoint's query contract does not carry.
 *
 * `GET /mobile-pos-lite/day-reports` accepts `terminalId`, `from` and `to`
 * (§1.5) — those are pushed down. Branch and rep are not on that contract, and
 * `forbidNonWhitelisted` is on globally, so sending them would 400 rather than
 * be ignored. They are therefore applied here, over the returned window, and
 * the page says so whenever the window is full.
 *
 * Company is matched through the terminal, because the record carries no
 * company of its own: `terminalCompany` maps terminal id → company id, built
 * from the terminal register. A terminal that is not in that map (revoked and
 * purged, say) is kept — hiding a real report to satisfy a lookup gap would
 * lose money from the accountant's view.
 */
export function filterDayReports(
  reports: MobilePosDayReport[],
  filters: DayReportFilters,
  terminalCompany: Map<string, string> = new Map(),
): MobilePosDayReport[] {
  const { companyId, branchId, repId } = filters;
  if (!companyId && !branchId && !repId) return reports;
  return reports.filter((report) => {
    if (branchId && report.branch.id !== branchId) return false;
    if (repId && report.rep.id !== repId) return false;
    if (companyId) {
      const owner = terminalCompany.get(report.terminal.id);
      if (owner !== undefined && owner !== companyId) return false;
    }
    return true;
  });
}

/** Sum of the method breakdown — used to show when it does not reconcile. */
export function methodBreakdownTotal(report: MobilePosDayReport): number {
  return report.byMethod.reduce((sum, line) => sum + line.amount, 0);
}

/* ─── Supersession: why a total may not simply add the rows ─────────────────── */

/**
 * THE SUPERSESSION RULE — the one derivation in this file, and the reason it
 * exists.
 *
 * A terminal-day may legitimately be closed more than once. The schema says so
 * in as many words ("a shift handover, or she sold more after closing") and
 * §1.6 deliberately declines a unique constraint on `(terminalId,
 * businessDate)` so it can happen. Every close RECOMPUTES the whole day
 * server-side over the same `orderDate` window (§1.3), so the 20:00 close does
 * not describe the evening — it describes the day, evening included, and fully
 * CONTAINS the 14:00 close.
 *
 * The rows are therefore successive SNAPSHOTS of one day, never additive slices
 * of it. Adding them presents a day whose real gross was 360,000 as 560,000 —
 * and prints that number into a PDF an accountant files, under a footer
 * promising every figure was recomputed on the server. True of each row, false
 * of the sum, which is the worst combination: it invites trust in the wrong
 * number.
 *
 * So: every figure the register totals counts each terminal-day ONCE, from its
 * newest close, and the earlier closes stay on the screen marked as superseded.
 * They are not hidden. That a day was closed twice is information an accountant
 * needs — it is the difference between a shift handover and a rep who kept
 * selling after ruling the line — and hiding it would trade one silent
 * distortion for another.
 *
 * **The identity of a terminal-day is (terminal, businessDate, rep)**, not
 * (terminal, businessDate). The report is `createdById`-scoped on the server
 * (§1.3), so two reps sharing one terminal across a shift change (§8-D case 8)
 * produce two DISJOINT reports for the same calendar day, and both must count.
 * A row missing any of the three parts is keyed by its own id and always
 * counted: hiding real money to satisfy a lookup gap is the worse error, the
 * same posture `filterDayReports` takes for an unmappable terminal.
 *
 * **The 100-row window cannot corrupt this.** `GET /day-reports` orders by
 * `submittedAt desc` and caps at 100 (§1.5), and a later close of a day always
 * carries a later `submittedAt` than the close it supersedes — so the cap can
 * only ever drop superseded rows, never the counted one. A truncated window may
 * therefore under-report how many closes a day had; it can never mistake an
 * earlier close for the day's truth.
 */
export function terminalDayKey(report: MobilePosDayReport): string {
  const terminalId = report.terminal.id;
  const repId = report.rep.id;
  if (!terminalId || !repId || !report.businessDate) return `row ${report.id}`;
  return `day ${terminalId} ${report.businessDate} ${repId}`;
}

/** Where one close sits among the closes of its terminal-day. */
export interface DayReportSupersession {
  /** This close's position within the terminal-day, oldest = 1. */
  closeNumber: number;
  /** How many closes this terminal-day has in the current view. */
  closeCount: number;
  /** True for the newest close — the only row any total adds. */
  counted: boolean;
  /** The close that replaced this one; null when this IS the newest. */
  supersededBy: { id: string; submittedAt: string } | null;
}

/** A report carrying its place in its terminal-day's close history. */
export interface AnnotatedDayReport extends MobilePosDayReport {
  supersession: DayReportSupersession;
}

/**
 * Submission instant as a sortable number. An unreadable timestamp must never
 * win the newest-close race against a readable one, but it is still counted
 * when it is the day's only close.
 */
function submittedAtMs(report: MobilePosDayReport): number {
  const parsed = Date.parse(report.submittedAt);
  return Number.isNaN(parsed) ? Number.NEGATIVE_INFINITY : parsed;
}

/**
 * Mark every row with its place in its terminal-day, preserving input order.
 *
 * Ties and unreadable timestamps fall back to array order, because the endpoint
 * returns `submittedAt: 'desc'` (§1.5) and array position is then the only
 * other evidence of which close came last.
 *
 * Annotating is idempotent and cheap, so every consumer that totals or exports
 * calls it itself rather than trusting a caller to have done it — a total that
 * can be handed un-deduplicated rows is the bug this rule exists to kill.
 */
export function annotateSupersession(reports: MobilePosDayReport[]): AnnotatedDayReport[] {
  const groups = new Map<string, number[]>();
  reports.forEach((report, index) => {
    const key = terminalDayKey(report);
    const bucket = groups.get(key);
    if (bucket) bucket.push(index);
    else groups.set(key, [index]);
  });

  const marks = new Array<DayReportSupersession>(reports.length);
  groups.forEach((indexes) => {
    const newestFirst = [...indexes].sort((a, b) => {
      const left = submittedAtMs(reports[a]);
      const right = submittedAtMs(reports[b]);
      // Equal (both unreadable included) keeps array order, which is the
      // endpoint's newest-first ordering.
      return left === right ? a - b : right - left;
    });
    const closeCount = newestFirst.length;
    const newest = reports[newestFirst[0]];
    newestFirst.forEach((index, position) => {
      marks[index] = {
        closeNumber: closeCount - position,
        closeCount,
        counted: position === 0,
        supersededBy: position === 0 ? null : { id: newest.id, submittedAt: newest.submittedAt },
      };
    });
  });

  return reports.map((report, index) => ({ ...report, supersession: marks[index] }));
}

/** The register's headline figures. Money never counts a terminal-day twice. */
export interface DayReportTotals {
  /** Rows in view, superseded closes included — a count of paperwork. */
  submissions: number;
  /** Terminal-days behind them, and the basis of every figure below. */
  terminalDays: number;
  /** Submissions a later close of the same terminal-day replaced. */
  superseded: number;
  salesCount: number;
  grossTotal: number;
  declaredHeldCount: number;
  declaredHeldAmount: number;
}

/**
 * Register totals over the rows in view, counting each terminal-day once.
 *
 * `declaredHeld*` deduplicates for the same reason the money does: the pair is
 * what the phone's outbox held AT THAT CLOSE, so a second close re-declares the
 * same outbox rather than reporting a second one.
 */
export function summarizeDayReports(reports: MobilePosDayReport[]): DayReportTotals {
  const totals: DayReportTotals = {
    submissions: 0,
    terminalDays: 0,
    superseded: 0,
    salesCount: 0,
    grossTotal: 0,
    declaredHeldCount: 0,
    declaredHeldAmount: 0,
  };
  for (const report of annotateSupersession(reports)) {
    totals.submissions += 1;
    if (!report.supersession.counted) {
      totals.superseded += 1;
      continue;
    }
    totals.terminalDays += 1;
    totals.salesCount += report.salesCount;
    totals.grossTotal += report.grossTotal;
    totals.declaredHeldCount += report.declaredHeldCount;
    totals.declaredHeldAmount += report.declaredHeldAmount;
  }
  return totals;
}

/**
 * How a row's place in its terminal-day reads on paper. Every close is listed —
 * the export is the register, not a filtered version of it — so each row has to
 * say for itself whether the summary added it.
 */
export function countedLabel(mark: DayReportSupersession): string {
  if (mark.closeCount === 1) return 'Yes';
  return mark.counted
    ? `Yes (close ${mark.closeNumber} of ${mark.closeCount})`
    : `Superseded (close ${mark.closeNumber} of ${mark.closeCount})`;
}

/** One flat export row per report, shared by the CSV and table-PDF paths. */
export function buildDayReportExportRows(reports: MobilePosDayReport[]): Record<string, string>[] {
  return annotateSupersession(reports).map((report) => ({
    Date: formatBusinessDate(report.businessDate),
    Reference: report.reference,
    Rep: report.rep.name || '—',
    Terminal: report.terminal.code
      ? `${report.terminal.code} — ${report.terminal.name}`
      : report.terminal.name,
    Branch: report.branch.name || '—',
    Sales: String(report.salesCount),
    'Gross Total': formatMoney(report.grossTotal),
    'Items Sold': formatQuantity(report.itemsSoldQuantity),
    'Held Count': String(report.declaredHeldCount),
    'Held Amount': formatMoney(report.declaredHeldAmount),
    Submitted: formatDateTime(report.submittedAt),
    // Last on purpose: it is a note about the row, not one of its figures, and
    // appending keeps DAY_REPORT_EXPORT_NUMERIC_COLUMNS pointing where it did.
    Counted: countedLabel(report.supersession),
  }));
}

/** Column order for both exports — CSV and PDF must not drift apart. */
export const DAY_REPORT_EXPORT_COLUMNS = [
  'Date',
  'Reference',
  'Rep',
  'Terminal',
  'Branch',
  'Sales',
  'Gross Total',
  'Items Sold',
  'Held Count',
  'Held Amount',
  'Submitted',
  'Counted',
];

/** Indices of the right-aligned numeric columns in the export above. */
export const DAY_REPORT_EXPORT_NUMERIC_COLUMNS = [5, 6, 7, 8, 9];

/**
 * Why a later close replaces an earlier one, in one sentence. Shared verbatim
 * by the screen and both exports: a reader who meets the word "superseded" in
 * the PDF and on the page should meet the same explanation of it.
 */
export const SUPERSESSION_MECHANISM =
  'Every close recomputes the whole day on the server, so a later report contains the earlier one.';

/** The self-contained sentence the exported paper carries. */
export function supersededDisclosure(totals: DayReportTotals): string {
  return (
    `${totals.superseded} of the ${totals.submissions} submissions listed ` +
    `${totals.superseded === 1 ? 'was' : 'were'} superseded by a later close of the same ` +
    `terminal-day. ${SUPERSESSION_MECHANISM} The summary counts each terminal-day once, from ` +
    'its latest close, and the Counted column marks the rows it added.'
  );
}

/** The sentence both exports use when the endpoint's 100-row cap has bitten. */
export function windowFullDisclosure(): string {
  return (
    `Showing the ${DAY_REPORT_WINDOW_LIMIT} most recent submissions in this date range. ` +
    'Narrow the dates to reach older ones.'
  );
}

/**
 * The register export, built here rather than in the page so the paper an
 * accountant files carries the SAME figures the screen showed — one summary,
 * one deduplication, no second implementation to drift out of step.
 */
export function buildDayReportRegisterPdf(options: {
  reports: MobilePosDayReport[];
  subtitle?: string;
  companyId?: string;
  windowFull?: boolean;
}): TablePdfRequest {
  const { reports, subtitle, companyId, windowFull = false } = options;
  const rows = buildDayReportExportRows(reports);
  const totals = summarizeDayReports(reports);

  const notes: string[] = [];
  if (totals.superseded > 0) notes.push(supersededDisclosure(totals));
  if (windowFull) notes.push(windowFullDisclosure());

  return {
    title: 'Mobile POS Day Reports',
    subtitle: subtitle || undefined,
    companyId: companyId || undefined,
    columns: DAY_REPORT_EXPORT_COLUMNS,
    rows: rows.map((row) => DAY_REPORT_EXPORT_COLUMNS.map((column) => row[column] ?? '')),
    numericColumns: DAY_REPORT_EXPORT_NUMERIC_COLUMNS,
    stripedRows: true,
    orientation: 'landscape',
    summary: [
      { label: 'Terminal-days counted', value: String(totals.terminalDays) },
      {
        label: 'Submissions listed',
        value:
          totals.superseded > 0
            ? `${totals.submissions} (${totals.superseded} superseded)`
            : String(totals.submissions),
      },
      { label: 'Sales', value: String(totals.salesCount) },
      { label: 'Gross total', value: formatMoney(totals.grossTotal) },
      { label: 'Still on phones (declared)', value: formatMoney(totals.declaredHeldAmount) },
    ],
    note: notes.length > 0 ? notes.join(' ') : undefined,
    baseName: 'mobile-pos-day-reports',
  };
}

/**
 * The single-report PDF the drawer offers.
 *
 * Deliberately built from the generic `/generated-documents/table-pdf`
 * endpoint rather than `GET /mobile-pos-lite/day-reports/:id/pdf`: that route
 * is terminal-bound through `requireTerminal()` by design (§1.4) and there is
 * no office-side PDF route in v1. The office paper is therefore assembled from
 * the record the office already holds — the same numbers, by construction.
 *
 * An annotated report carries its place in the terminal-day's close history and
 * says so on the paper. A single superseded close, filed on its own, is exactly
 * the document that would otherwise be read as the day's truth.
 */
export function buildDayReportDetailPdf(
  report: MobilePosDayReport | AnnotatedDayReport,
): TablePdfRequest {
  const columns = ['Item', 'Quantity', 'Amount'];
  const rows = report.items.map((item) => [
    item.name || item.productId || '—',
    formatQuantity(item.quantity),
    formatMoney(item.amount),
  ]);

  const mark = 'supersession' in report ? report.supersession : null;
  const superseded = mark !== null && !mark.counted;

  const notes: string[] = [];
  // Leads, because it governs how every other figure on the page should be
  // read — and because `note` is clamped downstream, so it must not be last.
  if (mark && mark.closeCount > 1) {
    notes.push(
      superseded
        ? `SUPERSEDED — close ${mark.closeNumber} of ${mark.closeCount} for this terminal-day. A later close recomputed the whole day and contains these figures, so the register does not count this report.`
        : `Close ${mark.closeNumber} of ${mark.closeCount} for this terminal-day, and the one the register counts. The earlier closes cover the same day and are superseded by this one.`,
    );
  }
  if (report.itemsTruncated) {
    // `itemsTruncated` is set by the 50-entry cap OR by the 500-order bound the
    // item query carries (§1.3), and the second of those also bounds Items
    // Sold. Vouching only for the two figures that come from the unbounded
    // aggregate is the difference between a caveat and a false reassurance.
    notes.push(
      'The item breakdown below lists the highest-value items only; the sales count, gross total and items sold all come from unbounded aggregates over the whole day and are exact.',
    );
  }
  if (report.declaredHeldCount > 0) {
    notes.push(
      `${report.declaredHeldCount} sale(s) worth ${formatMoney(report.declaredHeldAmount)} were still on the phone at close. That figure is declared by the phone and is NOT included in the gross total.`,
    );
  }

  return {
    title: 'Mobile POS Day Report',
    subtitle: `${formatBusinessDate(report.businessDate)} · ${report.rep.name || 'Unknown rep'}`,
    status: superseded ? 'SUPERSEDED' : report.declaredHeldCount > 0 ? 'PARTIAL' : 'COMPLETED',
    baseName: `mobile-pos-day-report-${report.reference}`,
    columns,
    // A day with no sales still submits honestly (§8-D), so the table must
    // tolerate having nothing in it rather than exporting a broken document.
    rows: rows.length > 0 ? rows : [['No items sold', '0', formatMoney(0)]],
    numericColumns: [1, 2],
    sectionTitle: 'Items sold',
    meta: [
      { label: 'Business date', value: formatBusinessDate(report.businessDate) },
      { label: 'Reference', value: report.reference },
      {
        label: 'Terminal',
        value: report.terminal.code
          ? `${report.terminal.code} — ${report.terminal.name}`
          : report.terminal.name || '—',
      },
      { label: 'Branch', value: report.branch.name || '—' },
      { label: 'Sales rep', value: report.rep.name || '—' },
      { label: 'Submitted', value: formatDateTime(report.submittedAt) },
    ],
    summary: [
      { label: 'Sales', value: String(report.salesCount) },
      { label: 'Gross total', value: formatMoney(report.grossTotal) },
      { label: 'Items sold', value: formatQuantity(report.itemsSoldQuantity) },
      ...report.byMethod.map((line) => ({
        label: `${methodLabel(line)} (${line.count})`,
        value: formatMoney(line.amount),
      })),
      ...(report.declaredHeldCount > 0
        ? [
            {
              label: `Still on the phone (${report.declaredHeldCount}, declared)`,
              value: formatMoney(report.declaredHeldAmount),
            },
          ]
        : []),
    ],
    note: notes.length > 0 ? notes.join(' ') : undefined,
  };
}
