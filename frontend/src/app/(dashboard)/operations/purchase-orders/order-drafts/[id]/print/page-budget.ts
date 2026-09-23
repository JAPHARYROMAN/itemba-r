/**
 * How many supplier-order-draft rows fit on page 1.
 *
 * Print CSS pins the letterhead at 54mm and zeroes `.document-page` padding,
 * so the column under the 12mm @page margin is 273mm. Page 1 keeps the priced
 * total, supplier record, terms and both signature lines. Surplus rows continue.
 */

export const PAGE_CONTENT_MM = 273;
export const ROW_MM = 6.5;

export const CHROME_MM = {
  header: 54,
  tableHead: 8,
  totals: 22,
  supplier: 12,
  terms: 24,
  signatures: 16,
  footer: 8,
} as const;

export const TITLE_MM = 8;
export const UNPRICED_BANNER_MM = 8;
export const MIN_FIRST_PAGE_ROWS = 4;

export function firstPageCapacity(flags: { hasTitle: boolean; unpriced: boolean }): number {
  const fixed =
    Object.values(CHROME_MM).reduce((sum, mm) => sum + mm, 0) +
    (flags.hasTitle ? TITLE_MM : 0) +
    (flags.unpriced ? UNPRICED_BANNER_MM : 0);
  return Math.max(MIN_FIRST_PAGE_ROWS, Math.floor((PAGE_CONTENT_MM - fixed) / ROW_MM));
}

export function splitDraftLines<T>(lines: T[], flags: { hasTitle: boolean; unpriced: boolean }) {
  const capacity = firstPageCapacity(flags);
  return {
    capacity,
    firstPageLines: lines.slice(0, capacity),
    overflowLines: lines.slice(capacity),
  };
}
