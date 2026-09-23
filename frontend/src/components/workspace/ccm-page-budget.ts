/**
 * How CCM notices paginate.
 *
 * @page is A4 portrait with a 14mm margin (`ccm-document.css`), so the
 * printable column is 269mm tall. Body type is 11pt at 1.5 line-height with
 * 5pt cell padding — 9.5mm per table row. History items are reserved at 30mm
 * (identifier, meta line, and a two-to-three-line reason).
 *
 * Sections 1–3 already fill a sheet. The guarantee is therefore not
 * "signatures on page 1" — they cannot fit there — but:
 *
 *   1. History items split without drop or duplicate.
 *   2. The notice (or referral) tail that carries the signatures fits on a
 *      single sheet by itself, so a long history cannot orphan a signature
 *      onto a page of its own.
 *
 * Re-derive these if the layout changes. Over-estimating costs an earlier
 * continuation; under-estimating costs the tail guarantee.
 */

export const PAGE_CONTENT_MM = 269;

export const TABLE_ROW_MM = 9.5;
export const HEADING_MM = 13;
export const TITLE_MM = 24;
export const HISTORY_ITEM_MM = 30;
export const EMPTY_HISTORY_MM = 10;
export const FOOTER_MM = 16;
export const SIGNATURES_MM = 48;
export const NOTICE_MM = 63;
export const OPERATOR_ROW_MM = 10;
export const SUMMARY_MM = 22;
export const OPTIONAL_NARRATIVE_MM = 18;

export const TERMINATION_EMPLOYER_ROWS = 5;
export const TERMINATION_EMPLOYEE_ROWS = 10;
export const TERMINATION_EMPLOYMENT_ROWS = 7;

export const CMA_DISPUTE_ROWS = 7;
export const CMA_EMPLOYER_ROWS = 5;
export const CMA_EMPLOYEE_ROWS = 10;

function sectionMm(rows: number): number {
  return HEADING_MM + rows * TABLE_ROW_MM;
}

export function terminationPreambleMm(hasPassport: boolean): number {
  return (
    TITLE_MM +
    sectionMm(TERMINATION_EMPLOYER_ROWS) +
    sectionMm(TERMINATION_EMPLOYEE_ROWS + (hasPassport ? 1 : 0)) +
    sectionMm(TERMINATION_EMPLOYMENT_ROWS) +
    HEADING_MM
  );
}

export function terminationTailMm(operatorFieldCount: number): number {
  return (
    NOTICE_MM + operatorFieldCount * OPERATOR_ROW_MM + SIGNATURES_MM + FOOTER_MM
  );
}

export function cmaPreambleMm(flags: {
  hasInitialPosition: boolean;
  hasMediationOutcome: boolean;
}): number {
  return (
    TITLE_MM +
    sectionMm(CMA_DISPUTE_ROWS) +
    HEADING_MM +
    SUMMARY_MM +
    (flags.hasInitialPosition ? OPTIONAL_NARRATIVE_MM : 0) +
    (flags.hasMediationOutcome ? OPTIONAL_NARRATIVE_MM : 0) +
    sectionMm(CMA_EMPLOYER_ROWS) +
    sectionMm(CMA_EMPLOYEE_ROWS) +
    HEADING_MM
  );
}

export function cmaTailMm(): number {
  return SIGNATURES_MM + FOOTER_MM;
}

export function firstPageHistoryCapacity(preambleMm: number): number {
  const remaining = PAGE_CONTENT_MM - preambleMm;
  if (remaining < HISTORY_ITEM_MM) return 0;
  return Math.floor(remaining / HISTORY_ITEM_MM);
}

export function splitHistoryForPrint<T>(items: T[], preambleMm: number) {
  const capacity = firstPageHistoryCapacity(preambleMm);
  return {
    capacity,
    firstPageItems: items.slice(0, capacity),
    overflowItems: items.slice(capacity),
  };
}
