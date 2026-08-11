/**
 * Shared money / number / date formatting for the Itemba frontend.
 *
 * One locale everywhere: en-GB. TZS is the base currency and has no cents in
 * practice, so it renders as whole shillings ("TZS 1,234,567"); every other
 * currency keeps 2 decimal places ("USD 1,234.56").
 *
 * All helpers are dependency-free and safe on null / undefined / NaN input.
 */

const LOCALE = 'en-GB';

const WHOLE_FORMAT = new Intl.NumberFormat(LOCALE, { maximumFractionDigits: 0 });
const CENTS_FORMAT = new Intl.NumberFormat(LOCALE, {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

/** Coerce API money values (number | numeric string | null | undefined) to a finite number, else 0. */
function toNumber(value: number | string | null | undefined): number {
  if (value === null || value === undefined || value === '') return 0;
  const n = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(n) ? n : 0;
}

/** Normalise a currency code; empty / null / undefined falls back to TZS. */
function toCurrency(currency: string | null | undefined): string {
  return (currency ?? '').trim().toUpperCase() || 'TZS';
}

/**
 * Format a money amount with its currency code.
 *
 * TZS renders as whole shillings with thousands separators ("TZS 1,234,567");
 * any other currency keeps 2 decimals ("USD 1,234.56"). Null, undefined, and
 * non-numeric input render the zero form ("TZS 0" / "USD 0.00").
 */
export function formatMoney(
  value: number | string | null | undefined,
  currency: string = 'TZS',
): string {
  const code = toCurrency(currency);
  const amount = toNumber(value);
  if (code === 'TZS') return `TZS ${WHOLE_FORMAT.format(amount)}`;
  return `${code} ${CENTS_FORMAT.format(amount)}`;
}

/**
 * Format a plain number with en-GB thousands separators.
 *
 * Pass Intl options to control fraction digits, e.g.
 * `formatNumber(litres, { minimumFractionDigits: 3 })`.
 */
export function formatNumber(
  value: number | string | null | undefined,
  opts?: Intl.NumberFormatOptions,
): string {
  const n = toNumber(value);
  return opts ? new Intl.NumberFormat(LOCALE, opts).format(n) : new Intl.NumberFormat(LOCALE).format(n);
}

/** Parse a date input; returns null when empty or invalid. */
function toDate(value: string | Date | null | undefined): Date | null {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

/** Format a date as dd/MM/yyyy (en-GB). Returns an em dash for empty or invalid input. */
export function formatDate(value: string | Date | null | undefined): string {
  const date = toDate(value);
  if (!date) return '—';
  return date.toLocaleDateString(LOCALE, { day: '2-digit', month: '2-digit', year: 'numeric' });
}

/** Format a date-time as dd/MM/yyyy HH:mm (en-GB, 24h). Returns an em dash for empty or invalid input. */
export function formatDateTime(value: string | Date | null | undefined): string {
  const date = toDate(value);
  if (!date) return '—';
  const day = date.toLocaleDateString(LOCALE, { day: '2-digit', month: '2-digit', year: 'numeric' });
  const time = date.toLocaleTimeString(LOCALE, {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
  return `${day} ${time}`;
}

/**
 * Sum rows per currency for honest multi-currency totals.
 *
 * Rows without a currency count as TZS. Amounts that are null / undefined /
 * non-numeric count as 0. Never adds amounts across currencies.
 */
export function sumByCurrency(
  rows: Array<{ amount: number | string | null | undefined; currency?: string | null }>,
): Map<string, number> {
  const totals = new Map<string, number>();
  for (const row of rows) {
    const code = toCurrency(row.currency);
    totals.set(code, (totals.get(code) ?? 0) + toNumber(row.amount));
  }
  return totals;
}

/**
 * Render per-currency totals (from {@link sumByCurrency}) as one display string.
 *
 * Single currency: "TZS 1,234,567". Mixed: "TZS 1,234,567 + USD 2,340.00"
 * (TZS first, then alphabetical). An empty map renders "TZS 0".
 */
export function formatMoneyTotals(totals: Map<string, number>): string {
  if (totals.size === 0) return formatMoney(0);
  const codes = [...totals.keys()].sort((a, b) => {
    if (a === 'TZS') return -1;
    if (b === 'TZS') return 1;
    return a.localeCompare(b);
  });
  return codes.map((code) => formatMoney(totals.get(code), code)).join(' + ');
}
