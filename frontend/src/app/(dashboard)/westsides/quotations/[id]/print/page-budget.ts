/**
 * How many quotation line rows fit on page 1.
 *
 * @page is A4 portrait with a 12mm margin (globals.css) and print CSS zeroes the
 * sheet's own padding, so the printable column is 186mm x 273mm. The quotation
 * sheet is laid out entirely in absolute mm/pt, which is what lets this be
 * arithmetic instead of a DOM measurement: screen pixels and printed millimetres
 * do not agree, and measuring the on-screen layout would predict the wrong number
 * of rows for the printed page.
 *
 * Page 1 must always be a COMPLETE quotation - the recipient should never turn
 * over to find the total or somewhere to sign - so every block below is reserved
 * before any row is placed, and surplus rows go to a continuation sheet.
 *
 * Re-derive these if the layout changes. Over-estimating costs one row of
 * capacity; under-estimating costs the guarantee, which is the whole point.
 */

export const PAGE_CONTENT_MM = 273;

/** A single-line row at 7.5pt with 1mm vertical padding, plus the cell border. */
export const ROW_MM = 6.2;

export const CHROME_MM = {
  /** Logo, group/company/branch identity, address, contacts, TIN/VRN. */
  letterhead: 30,
  /** "QUOTATION" title, type, number, dates and the rule beneath them. */
  title: 15,
  /** Two-column customer / terms block. */
  parties: 27,
  /** Table head row. */
  tableHead: 7,
  /** Subtotal, optional discount/tax, and the emphasised Total. */
  totals: 23,
  /** Two signature blocks with captions. */
  signatures: 21,
  /** Footer rule, website and page counter. */
  footer: 8,
} as const;

/** Terms & notes panel, only reserved when the quotation actually carries notes. */
export const NOTES_MM = 13;

/**
 * Never render a first page with fewer rows than this. If the chrome ever grows
 * enough to squeeze the table to nothing, a first page showing three items and a
 * total is still a usable document; a first page showing none is not.
 */
export const MIN_FIRST_PAGE_ROWS = 4;

export function firstPageCapacity(hasNotes: boolean): number {
  const fixed =
    Object.values(CHROME_MM).reduce((sum, mm) => sum + mm, 0) + (hasNotes ? NOTES_MM : 0);
  return Math.max(MIN_FIRST_PAGE_ROWS, Math.floor((PAGE_CONTENT_MM - fixed) / ROW_MM));
}

/**
 * Split lines into the page-1 set and the continuation set. Kept next to the
 * budget so the two can never drift apart.
 */
export function splitLinesForPrint<T>(lines: T[], hasNotes: boolean) {
  const capacity = firstPageCapacity(hasNotes);
  return {
    capacity,
    firstPageLines: lines.slice(0, capacity),
    overflowLines: lines.slice(capacity),
  };
}
