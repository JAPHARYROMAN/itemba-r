import { describe, expect, it } from 'vitest';
import {
  PAGE_CONTENT_MM,
  ROW_MM,
  deliveryNoteLineBudget,
  layoutDocumentLines,
  proformaLineBudget,
  purchaseOrderLineBudget,
  salesOrderLineBudget,
  shellTailMm,
} from './document-line-budget';

const lines = (count: number) => Array.from({ length: count }, (_, index) => index);

describe('DocumentShell line page budget', () => {
  it('keeps every document tail on a single sheet by itself', () => {
    for (const tail of [
      salesOrderLineBudget(true).tailMm,
      purchaseOrderLineBudget(true).tailMm,
      proformaLineBudget(true).tailMm,
      deliveryNoteLineBudget(true).tailMm,
      shellTailMm({ totalRows: 6, hasNotes: true }),
    ]) {
      expect(tail).toBeLessThanOrEqual(PAGE_CONTENT_MM);
    }
  });

  it('never places more rows than the reserved column can hold', () => {
    for (const budget of [
      salesOrderLineBudget(false),
      salesOrderLineBudget(true),
      purchaseOrderLineBudget(false),
      proformaLineBudget(true),
      deliveryNoteLineBudget(false),
    ]) {
      const split = layoutDocumentLines(lines(40), budget);
      const reserved = split.tailOnFirstPage
        ? budget.preambleMm + budget.tailMm
        : budget.preambleMm;
      expect(reserved + split.firstPageLines.length * ROW_MM).toBeLessThanOrEqual(PAGE_CONTENT_MM);
    }
  });

  it('keeps a typical sales order, with its total, on one sheet', () => {
    const split = layoutDocumentLines(lines(8), salesOrderLineBudget(false));
    expect(split.tailOnFirstPage).toBe(true);
    expect(split.pageCount).toBe(1);
    expect(split.overflowLines).toHaveLength(0);
  });

  it('keeps the sales-order total on page 1 when notes force a continuation', () => {
    const split = layoutDocumentLines(lines(8), salesOrderLineBudget(true));
    expect(split.tailOnFirstPage).toBe(true);
    expect(split.overflowLines.length).toBeGreaterThan(0);
    expect([...split.firstPageLines, ...split.overflowLines]).toEqual(lines(8));
  });

  it('splits a long delivery note without dropping a line', () => {
    const all = lines(40);
    const split = layoutDocumentLines(all, deliveryNoteLineBudget(false));
    expect(split.tailOnFirstPage).toBe(true);
    expect([...split.firstPageLines, ...split.overflowLines]).toEqual(all);
    expect(split.pageCount).toBe(2);
  });
});
