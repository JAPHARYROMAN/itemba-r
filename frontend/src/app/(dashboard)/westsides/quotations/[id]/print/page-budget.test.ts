import { describe, expect, it } from 'vitest';
import {
  CHROME_MM,
  MIN_FIRST_PAGE_ROWS,
  NOTES_MM,
  PAGE_CONTENT_MM,
  ROW_MM,
  firstPageCapacity,
  splitLinesForPrint,
} from './page-budget';

const lines = (count: number) => Array.from({ length: count }, (_, index) => index);

describe('quotation print page budget', () => {
  it('never promises more rows than the printable column can hold', () => {
    for (const hasNotes of [false, true]) {
      const capacity = firstPageCapacity(hasNotes);
      const chrome =
        Object.values(CHROME_MM).reduce((sum, mm) => sum + mm, 0) + (hasNotes ? NOTES_MM : 0);

      // The whole guarantee in one assertion: rows plus the reserved chrome must
      // fit inside the page. If this fails, the totals and signature block get
      // pushed onto page 2 and page 1 stops being a complete quotation.
      expect(chrome + capacity * ROW_MM).toBeLessThanOrEqual(PAGE_CONTENT_MM);
    }
  });

  it('reserves room for the notes panel, costing capacity rather than the guarantee', () => {
    expect(firstPageCapacity(true)).toBeLessThan(firstPageCapacity(false));
  });

  it('still yields a usable page if the chrome ever grows', () => {
    expect(firstPageCapacity(true)).toBeGreaterThanOrEqual(MIN_FIRST_PAGE_ROWS);
  });

  it('keeps a typical quotation on a single sheet', () => {
    // Real quotations are single figures of line items; those must never spill.
    const { overflowLines } = splitLinesForPrint(lines(12), true);
    expect(overflowLines).toHaveLength(0);
  });

  it('splits without dropping or duplicating a single line', () => {
    const all = lines(60);
    const { firstPageLines, overflowLines, capacity } = splitLinesForPrint(all, true);

    expect(firstPageLines).toHaveLength(capacity);
    expect([...firstPageLines, ...overflowLines]).toEqual(all);
  });

  it('puts everything on page 1 when the list is short', () => {
    const { firstPageLines, overflowLines } = splitLinesForPrint(lines(3), false);
    expect(firstPageLines).toHaveLength(3);
    expect(overflowLines).toHaveLength(0);
  });

  it('handles an empty quotation without producing a continuation sheet', () => {
    const { firstPageLines, overflowLines } = splitLinesForPrint(lines(0), false);
    expect(firstPageLines).toHaveLength(0);
    expect(overflowLines).toHaveLength(0);
  });
});
