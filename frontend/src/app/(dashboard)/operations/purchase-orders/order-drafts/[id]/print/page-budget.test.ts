import { describe, expect, it } from 'vitest';
import {
  CHROME_MM,
  PAGE_CONTENT_MM,
  ROW_MM,
  TITLE_MM,
  UNPRICED_BANNER_MM,
  firstPageCapacity,
  splitDraftLines,
} from './page-budget';

describe('supplier order draft print page budget', () => {
  it('never promises more rows than the printable column can hold', () => {
    for (const flags of [
      { hasTitle: false, unpriced: false },
      { hasTitle: true, unpriced: true },
    ]) {
      const capacity = firstPageCapacity(flags);
      const chrome =
        Object.values(CHROME_MM).reduce((sum, mm) => sum + mm, 0) +
        (flags.hasTitle ? TITLE_MM : 0) +
        (flags.unpriced ? UNPRICED_BANNER_MM : 0);
      expect(chrome + capacity * ROW_MM).toBeLessThanOrEqual(PAGE_CONTENT_MM);
    }
  });

  it('keeps a short draft on one sheet and splits a long one without losing a line', () => {
    const short = splitDraftLines([1, 2, 3], { hasTitle: true, unpriced: false });
    expect(short.overflowLines).toHaveLength(0);

    const all = Array.from({ length: 40 }, (_, index) => index);
    const long = splitDraftLines(all, { hasTitle: true, unpriced: true });
    expect(long.overflowLines.length).toBeGreaterThan(0);
    expect([...long.firstPageLines, ...long.overflowLines]).toEqual(all);
  });
});