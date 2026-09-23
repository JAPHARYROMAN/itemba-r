/**
 * How many line rows fit on a DocumentShell print before the totals and
 * signatures.
 *
 * @page is A4 with a 12mm margin and print CSS zeroes `.document-page`
 * padding, so the column is 273mm. These blocks are the print-CSS sizes
 * (letterhead logo 17mm, table cells 1.5mm, signature rule 8mm), not the
 * on-screen pixel layout. Measuring the screen would predict the wrong page.
 *
 * When the preamble plus the tail still fit, page 1 stays a complete
 * document and only surplus rows continue. When they do not, the tail moves
 * intact to the continuation so a long list cannot separate the total from
 * the signatures.
 */

export const PAGE_CONTENT_MM = 273;
export const ROW_MM = 7;

const LETTERHEAD_MM = 28;
const TITLE_MM = 16;
const META_ROW_MM = 8;
const STAT_GRID_MM = 16;
const SECTION_HEADING_MM = 8;
const KV_ROW_MM = 8;
const TABLE_HEAD_MM = 7;
const TOTAL_ROW_MM = 8;
const NOTES_MM = 22;
const SIGNATURES_MM = 30;
const FOOTER_MM = 14;

export type ShellPreamble = {
  metaItems: number;
  detailItems: number;
  detailSections: number;
  statGrid?: boolean;
};

export type ShellTail = {
  totalRows: number;
  hasNotes: boolean;
};

export function shellPreambleMm(parts: ShellPreamble): number {
  return (
    LETTERHEAD_MM +
    TITLE_MM +
    Math.ceil(parts.metaItems / 3) * META_ROW_MM +
    (parts.statGrid ? STAT_GRID_MM : 0) +
    parts.detailSections * SECTION_HEADING_MM +
    Math.ceil(parts.detailItems / 2) * KV_ROW_MM +
    SECTION_HEADING_MM +
    TABLE_HEAD_MM
  );
}

export function shellTailMm(parts: ShellTail): number {
  return (
    parts.totalRows * TOTAL_ROW_MM + (parts.hasNotes ? NOTES_MM : 0) + SIGNATURES_MM + FOOTER_MM
  );
}

export function salesOrderLineBudget(hasNotes: boolean) {
  return {
    preambleMm: shellPreambleMm({ metaItems: 4, detailItems: 8, detailSections: 1 }),
    tailMm: shellTailMm({ totalRows: 6, hasNotes }),
  };
}

export function purchaseOrderLineBudget(hasNotes: boolean) {
  return {
    preambleMm: shellPreambleMm({ metaItems: 6, detailItems: 18, detailSections: 1 }),
    tailMm: shellTailMm({ totalRows: 6, hasNotes }),
  };
}

export function proformaLineBudget(hasNotes: boolean) {
  return {
    preambleMm: shellPreambleMm({
      metaItems: 5,
      detailItems: 12,
      detailSections: 2,
      statGrid: true,
    }),
    tailMm: shellTailMm({ totalRows: 4, hasNotes }),
  };
}

export function deliveryNoteLineBudget(hasNotes: boolean) {
  return {
    preambleMm: shellPreambleMm({ metaItems: 4, detailItems: 8, detailSections: 1 }),
    tailMm: shellTailMm({ totalRows: 0, hasNotes }),
  };
}

export function layoutDocumentLines<T>(lines: T[], budget: { preambleMm: number; tailMm: number }) {
  const tailOnFirstPage = budget.preambleMm + budget.tailMm <= PAGE_CONTENT_MM;
  const reserved = tailOnFirstPage ? budget.preambleMm + budget.tailMm : budget.preambleMm;
  const capacity = Math.max(0, Math.floor((PAGE_CONTENT_MM - reserved) / ROW_MM));
  const overflowLines = lines.slice(capacity);
  return {
    capacity,
    tailOnFirstPage,
    firstPageLines: lines.slice(0, capacity),
    overflowLines,
    pageCount: lines.length > 0 && (!tailOnFirstPage || overflowLines.length > 0) ? 2 : 1,
  };
}
