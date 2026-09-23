import { describe, expect, it } from 'vitest';
import {
  PAGE_CONTENT_MM,
  HISTORY_ITEM_MM,
  cmaPreambleMm,
  cmaTailMm,
  firstPageHistoryCapacity,
  splitHistoryForPrint,
  terminationPreambleMm,
  terminationTailMm,
} from './ccm-page-budget';

describe('CCM print page budget', () => {
  it('keeps the termination tail — notice, blanks and signatures — on one sheet', () => {
    expect(terminationTailMm(7)).toBeLessThanOrEqual(PAGE_CONTENT_MM);
  });

  it('keeps the CMA referral signatures on one sheet', () => {
    expect(cmaTailMm()).toBeLessThanOrEqual(PAGE_CONTENT_MM);
  });

  it('never promises more history items than the first sheet can hold', () => {
    for (const preamble of [
      terminationPreambleMm(false),
      terminationPreambleMm(true),
      cmaPreambleMm({ hasInitialPosition: false, hasMediationOutcome: false }),
      cmaPreambleMm({ hasInitialPosition: true, hasMediationOutcome: true }),
    ]) {
      const capacity = firstPageHistoryCapacity(preamble);
      if (preamble > PAGE_CONTENT_MM) {
        // A CMA referral that already fills the sheet cannot start history there.
        expect(capacity).toBe(0);
      } else {
        expect(preamble + capacity * HISTORY_ITEM_MM).toBeLessThanOrEqual(PAGE_CONTENT_MM);
      }
    }
  });

  it('splits history without dropping or duplicating an item', () => {
    const items = Array.from({ length: 12 }, (_, index) => index);
    const { firstPageItems, overflowItems, capacity } = splitHistoryForPrint(
      items,
      terminationPreambleMm(false),
    );

    expect(firstPageItems).toHaveLength(capacity);
    expect([...firstPageItems, ...overflowItems]).toEqual(items);
  });

  it('moves every history item overleaf when the preamble already fills the sheet', () => {
    const { firstPageItems, overflowItems } = splitHistoryForPrint(
      ['DA-1', 'DA-2'],
      terminationPreambleMm(false),
    );

    expect(firstPageItems).toHaveLength(0);
    expect(overflowItems).toEqual(['DA-1', 'DA-2']);
  });
});
