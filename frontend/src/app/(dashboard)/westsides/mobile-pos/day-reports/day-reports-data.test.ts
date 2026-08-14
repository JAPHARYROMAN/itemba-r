import { describe, expect, it } from 'vitest';
import {
  DAY_REPORT_EXPORT_COLUMNS,
  annotateSupersession,
  buildDayReportDetailPdf,
  buildDayReportExportRows,
  buildDayReportRegisterPdf,
  filterDayReports,
  formatBusinessDate,
  methodBreakdownTotal,
  methodLabel,
  normalizeDayReport,
  normalizeDayReports,
  parseBusinessDate,
  summarizeDayReports,
  terminalDayKey,
  type MobilePosDayReport,
} from './day-reports-data';

/** The §1.3 response shape, which §1.5 says the office list repeats verbatim. */
const wireReport = {
  id: 'report-1',
  businessDate: '2026-08-14',
  reference: 'TERM-014-20260814',
  submittedAt: '2026-08-14T18:42:11.000Z',
  terminal: { id: 'terminal-1', code: 'TERM-014', name: 'Kaunta 1' },
  branch: { id: 'branch-1', name: 'Uzunguni' },
  rep: { id: 'user-1', name: 'Asha Mwinyi' },
  salesCount: 23,
  grossTotal: 412000,
  itemsSoldQuantity: 87,
  byMethod: [
    { paymentMethod: 'CASH', label: 'Fedha', count: 19, amount: 331000 },
    { paymentMethod: 'CREDIT', label: null, count: 4, amount: 81000 },
  ],
  items: [{ productId: 'product-1', name: 'Embe Dodo', quantity: 14, amount: 84000 }],
  itemsTruncated: false,
  declaredHeldCount: 2,
  declaredHeldAmount: 26000,
};

function normalized(overrides: Record<string, unknown> = {}): MobilePosDayReport {
  const report = normalizeDayReport({ ...wireReport, ...overrides });
  if (!report) throw new Error('fixture failed to normalize');
  return report;
}

/**
 * The double-close day, as the endpoint returns it: newest `submittedAt` first
 * (§1.5). She closed at 14:00 with 10 sales / 200,000, kept selling, and closed
 * again at 20:00 — and the 20:00 close RECOMPUTED the whole day, so it reads 18
 * sales / 360,000 and fully contains the first. The day's real gross is
 * 360,000; adding the rows would present 560,000.
 */
const evening = normalized({
  id: 'close-evening',
  submittedAt: '2026-08-14T20:00:00.000Z',
  salesCount: 18,
  grossTotal: 360000,
  declaredHeldCount: 1,
  declaredHeldAmount: 6000,
});
const afternoon = normalized({
  id: 'close-afternoon',
  submittedAt: '2026-08-14T14:00:00.000Z',
  salesCount: 10,
  grossTotal: 200000,
  declaredHeldCount: 2,
  declaredHeldAmount: 26000,
});
const doubleClosedDay = [evening, afternoon];

describe('parseBusinessDate', () => {
  it('reads the calendar day as written rather than as a UTC instant', () => {
    const parsed = parseBusinessDate('2026-08-14');
    expect(parsed?.getFullYear()).toBe(2026);
    expect(parsed?.getMonth()).toBe(7);
    expect(parsed?.getDate()).toBe(14);
  });

  it('accepts the full ISO timestamp a DATE column serialises to', () => {
    expect(parseBusinessDate('2026-08-14T00:00:00.000Z')?.getDate()).toBe(14);
  });

  it('returns null for anything that is not a date', () => {
    expect(parseBusinessDate('')).toBeNull();
    expect(parseBusinessDate('not-a-date')).toBeNull();
  });

  it('renders an em dash rather than "Invalid Date"', () => {
    expect(formatBusinessDate('not-a-date')).toBe('—');
  });
});

describe('normalizeDayReport', () => {
  it('carries the whole §1.3 payload through unchanged', () => {
    const report = normalized();
    expect(report.id).toBe('report-1');
    expect(report.reference).toBe('TERM-014-20260814');
    expect(report.terminal).toEqual({ id: 'terminal-1', name: 'Kaunta 1', code: 'TERM-014' });
    expect(report.branch.name).toBe('Uzunguni');
    expect(report.rep.name).toBe('Asha Mwinyi');
    expect(report.salesCount).toBe(23);
    expect(report.grossTotal).toBe(412000);
    expect(report.byMethod).toHaveLength(2);
    expect(report.declaredHeldCount).toBe(2);
  });

  it('coerces Decimal columns that cross the wire as strings', () => {
    const report = normalized({
      grossTotal: '412000.00',
      itemsSoldQuantity: '87.0000',
      declaredHeldAmount: '26000.00',
    });
    expect(report.grossTotal).toBe(412000);
    expect(report.itemsSoldQuantity).toBe(87);
    expect(report.declaredHeldAmount).toBe(26000);
  });

  it('falls back to the flat snapshot columns when refs are not nested', () => {
    const report = normalizeDayReport({
      id: 'report-2',
      businessDate: '2026-08-13T00:00:00.000Z',
      submittedAt: '2026-08-13T19:00:00.000Z',
      terminalId: 'terminal-9',
      terminalCode: 'TERM-009',
      terminalName: 'Kaunta 9',
      branchId: 'branch-2',
      branchName: 'Majengo',
      repUserId: 'user-2',
      repName: 'Neema Juma',
      salesCount: 3,
      grossTotal: 9000,
      itemsSoldQuantity: 5,
      byMethod: [],
      items: [],
      declaredHeldCount: 0,
      declaredHeldAmount: 0,
    });
    expect(report?.terminal).toEqual({ id: 'terminal-9', name: 'Kaunta 9', code: 'TERM-009' });
    expect(report?.branch.name).toBe('Majengo');
    expect(report?.rep.name).toBe('Neema Juma');
    // Reference is derived, not stored (§1.3), so an omitted one is rebuilt.
    expect(report?.reference).toBe('TERM-009-20260813');
    expect(report?.businessDate).toBe('2026-08-13');
  });

  it('survives Json columns arriving as something other than arrays', () => {
    const report = normalized({ byMethod: null, items: 'unexpected' });
    expect(report.byMethod).toEqual([]);
    expect(report.items).toEqual([]);
  });

  it('drops rows with no id, which could not be opened or exported anyway', () => {
    expect(normalizeDayReport({ businessDate: '2026-08-14' })).toBeNull();
    expect(normalizeDayReport(null)).toBeNull();
    expect(normalizeDayReports([wireReport, {}, null])).toHaveLength(1);
  });
});

describe('methodLabel', () => {
  it("prefers the terminal's own configured label", () => {
    expect(methodLabel({ paymentMethod: 'CASH', label: 'Fedha', count: 1, amount: 1 })).toBe(
      'Fedha',
    );
  });

  it('humanises the code when no label was configured, as CREDIT has none', () => {
    expect(methodLabel({ paymentMethod: 'MOBILE_MONEY', label: null, count: 1, amount: 1 })).toBe(
      'Mobile money',
    );
    expect(methodLabel({ paymentMethod: 'CREDIT', label: '', count: 1, amount: 1 })).toBe('Credit');
  });
});

describe('filterDayReports', () => {
  const reports = [
    normalized(),
    normalized({
      id: 'report-2',
      branch: { id: 'branch-2', name: 'Majengo' },
      rep: { id: 'user-2', name: 'Neema Juma' },
      terminal: { id: 'terminal-2', code: 'TERM-002', name: 'Kaunta 2' },
    }),
  ];

  it('returns everything when nothing is narrowed', () => {
    expect(filterDayReports(reports, {})).toHaveLength(2);
  });

  it('narrows by branch and by rep', () => {
    expect(filterDayReports(reports, { branchId: 'branch-2' }).map((r) => r.id)).toEqual([
      'report-2',
    ]);
    expect(filterDayReports(reports, { repId: 'user-1' }).map((r) => r.id)).toEqual(['report-1']);
    expect(filterDayReports(reports, { branchId: 'branch-1', repId: 'user-2' })).toHaveLength(0);
  });

  it('reaches company through the terminal map, since the record carries none', () => {
    const terminalCompany = new Map([
      ['terminal-1', 'company-a'],
      ['terminal-2', 'company-b'],
    ]);
    expect(
      filterDayReports(reports, { companyId: 'company-b' }, terminalCompany).map((r) => r.id),
    ).toEqual(['report-2']);
  });

  it('keeps a report whose terminal is not in the map rather than hiding money', () => {
    const terminalCompany = new Map([['terminal-1', 'company-a']]);
    expect(
      filterDayReports(reports, { companyId: 'company-a' }, terminalCompany).map((r) => r.id),
    ).toEqual(['report-1', 'report-2']);
  });
});

describe('annotateSupersession', () => {
  it('marks the newest close of a terminal-day as the counted one', () => {
    const marked = annotateSupersession(doubleClosedDay);
    expect(marked.map((r) => r.id)).toEqual(['close-evening', 'close-afternoon']);
    expect(marked[0].supersession).toEqual({
      closeNumber: 2,
      closeCount: 2,
      counted: true,
      supersededBy: null,
    });
    expect(marked[1].supersession).toEqual({
      closeNumber: 1,
      closeCount: 2,
      counted: false,
      supersededBy: { id: 'close-evening', submittedAt: '2026-08-14T20:00:00.000Z' },
    });
  });

  it('finds the newest close wherever it sits in the array', () => {
    const marked = annotateSupersession([afternoon, evening]);
    expect(marked.find((r) => r.id === 'close-evening')?.supersession.counted).toBe(true);
    expect(marked.find((r) => r.id === 'close-afternoon')?.supersession.counted).toBe(false);
  });

  it('leaves a day closed once alone', () => {
    const [only] = annotateSupersession([normalized()]);
    expect(only.supersession).toEqual({
      closeNumber: 1,
      closeCount: 1,
      counted: true,
      supersededBy: null,
    });
  });

  it('keeps two reps on one terminal-day apart — their reports are disjoint', () => {
    // §1.3 scopes the report by createdById and §8-D case 8 names the shift
    // handover, so these two cover different sales of the same calendar day.
    const asha = normalized({ id: 'asha' });
    const neema = normalized({ id: 'neema', rep: { id: 'user-2', name: 'Neema Juma' } });
    expect(annotateSupersession([asha, neema]).every((r) => r.supersession.counted)).toBe(true);
  });

  it('counts every row when the key parts are missing rather than hiding money', () => {
    const orphanA = normalized({ id: 'orphan-a', terminal: {}, rep: {} });
    const orphanB = normalized({ id: 'orphan-b', terminal: {}, rep: {} });
    expect(terminalDayKey(orphanA)).not.toBe(terminalDayKey(orphanB));
    expect(annotateSupersession([orphanA, orphanB]).every((r) => r.supersession.counted)).toBe(
      true,
    );
  });

  it('breaks a tie on array order, which is the endpoint newest-first ordering', () => {
    const first = normalized({ id: 'first', submittedAt: '2026-08-14T20:00:00.000Z' });
    const second = normalized({ id: 'second', submittedAt: '2026-08-14T20:00:00.000Z' });
    const marked = annotateSupersession([first, second]);
    expect(marked[0].supersession.counted).toBe(true);
    expect(marked[1].supersession.counted).toBe(false);
  });

  it('never lets an unreadable timestamp outrank a readable one', () => {
    const broken = normalized({ id: 'broken', submittedAt: '' });
    const marked = annotateSupersession([broken, afternoon]);
    expect(marked.find((r) => r.id === 'close-afternoon')?.supersession.counted).toBe(true);
    expect(marked.find((r) => r.id === 'broken')?.supersession.counted).toBe(false);
  });
});

describe('summarizeDayReports', () => {
  it('counts a terminal-day closed twice ONCE, from its latest close', () => {
    // The register showed 28 sales / TZS 560,000 for a day whose real gross was
    // 360,000, because every close recomputes the whole day and the rows were
    // simply added.
    expect(summarizeDayReports(doubleClosedDay)).toEqual({
      submissions: 2,
      terminalDays: 1,
      superseded: 1,
      salesCount: 18,
      grossTotal: 360000,
      declaredHeldCount: 1,
      declaredHeldAmount: 6000,
    });
  });

  it('still adds terminal-days that are genuinely distinct', () => {
    const otherDay = normalized({ id: 'other-day', businessDate: '2026-08-13' });
    const otherTerminal = normalized({
      id: 'other-terminal',
      terminal: { id: 'terminal-2', code: 'TERM-002', name: 'Kaunta 2' },
    });
    const otherRep = normalized({ id: 'other-rep', rep: { id: 'user-2', name: 'Neema Juma' } });
    const totals = summarizeDayReports([normalized(), otherDay, otherTerminal, otherRep]);
    expect(totals.terminalDays).toBe(4);
    expect(totals.superseded).toBe(0);
    expect(totals.salesCount).toBe(92);
    expect(totals.grossTotal).toBe(1648000);
  });

  it('deduplicates the declared-held pair too — a second close re-declares one outbox', () => {
    const totals = summarizeDayReports(doubleClosedDay);
    expect(totals.declaredHeldCount).toBe(1);
    expect(totals.declaredHeldAmount).toBe(6000);
  });

  it('stays correct when a filter narrows the window', () => {
    // Deduplication must follow the filters, not just the default view.
    const otherRepCloses = [
      normalized({
        id: 'neema-evening',
        rep: { id: 'user-2', name: 'Neema Juma' },
        submittedAt: '2026-08-14T19:00:00.000Z',
        salesCount: 5,
        grossTotal: 50000,
      }),
      normalized({
        id: 'neema-afternoon',
        rep: { id: 'user-2', name: 'Neema Juma' },
        submittedAt: '2026-08-14T13:00:00.000Z',
        salesCount: 2,
        grossTotal: 20000,
      }),
    ];
    const window = [...doubleClosedDay, ...otherRepCloses];
    expect(summarizeDayReports(window).grossTotal).toBe(410000);
    expect(summarizeDayReports(filterDayReports(window, { repId: 'user-2' })).grossTotal).toBe(
      50000,
    );
    expect(summarizeDayReports(filterDayReports(window, { repId: 'user-1' })).grossTotal).toBe(
      360000,
    );
  });

  it('is zero for an empty register rather than NaN', () => {
    expect(summarizeDayReports([])).toEqual({
      submissions: 0,
      terminalDays: 0,
      superseded: 0,
      salesCount: 0,
      grossTotal: 0,
      declaredHeldCount: 0,
      declaredHeldAmount: 0,
    });
  });
});

describe('methodBreakdownTotal', () => {
  it('sums the server-computed breakdown', () => {
    expect(methodBreakdownTotal(normalized())).toBe(412000);
  });
});

describe('buildDayReportExportRows', () => {
  it('emits exactly the shared export columns so CSV and PDF cannot drift', () => {
    const [row] = buildDayReportExportRows([normalized()]);
    expect(Object.keys(row)).toEqual(DAY_REPORT_EXPORT_COLUMNS);
  });

  it('carries the declared-unsent pair, which is the honest half of the report', () => {
    const [row] = buildDayReportExportRows([normalized()]);
    expect(row['Held Count']).toBe('2');
    expect(row['Held Amount']).toBe('TZS 26,000.00');
    expect(row['Gross Total']).toBe('TZS 412,000.00');
    expect(row.Terminal).toBe('TERM-014 — Kaunta 1');
  });

  it('says of every row whether the summary added it', () => {
    expect(buildDayReportExportRows([normalized()])[0].Counted).toBe('Yes');
    const [latest, earlier] = buildDayReportExportRows(doubleClosedDay);
    expect(latest.Counted).toBe('Yes (close 2 of 2)');
    expect(earlier.Counted).toBe('Superseded (close 1 of 2)');
  });
});

describe('buildDayReportRegisterPdf', () => {
  it('prints the deduplicated totals, not the sum of the rows', () => {
    const pdf = buildDayReportRegisterPdf({ reports: doubleClosedDay });
    expect(pdf.summary).toEqual([
      { label: 'Terminal-days counted', value: '1' },
      { label: 'Submissions listed', value: '2 (1 superseded)' },
      { label: 'Sales', value: '18' },
      { label: 'Gross total', value: 'TZS 360,000.00' },
      { label: 'Still on phones (declared)', value: 'TZS 6,000.00' },
    ]);
    // The screen and the paper must agree by construction, not by coincidence.
    const totals = summarizeDayReports(doubleClosedDay);
    expect(pdf.summary?.find((entry) => entry.label === 'Gross total')?.value).toBe(
      'TZS 360,000.00',
    );
    expect(totals.grossTotal).toBe(360000);
  });

  it('lists the superseded close and explains why it was not added', () => {
    const pdf = buildDayReportRegisterPdf({ reports: doubleClosedDay });
    expect(pdf.rows).toHaveLength(2);
    expect(pdf.columns).toEqual(DAY_REPORT_EXPORT_COLUMNS);
    expect(pdf.rows[1][DAY_REPORT_EXPORT_COLUMNS.indexOf('Counted')]).toBe(
      'Superseded (close 1 of 2)',
    );
    expect(pdf.note).toContain('1 of the 2 submissions listed was superseded');
    expect(pdf.note).toContain('recomputes the whole day');
  });

  it('says nothing about supersession when no day was closed twice', () => {
    const pdf = buildDayReportRegisterPdf({ reports: [normalized()] });
    expect(pdf.note).toBeUndefined();
    expect(pdf.summary).toContainEqual({ label: 'Submissions listed', value: '1' });
  });

  it('keeps the window-cap disclosure, and stays inside the note clamp', () => {
    const pdf = buildDayReportRegisterPdf({ reports: doubleClosedDay, windowFull: true });
    expect(pdf.note).toContain('most recent submissions in this date range');
    // downloadTablePdf clamps `note` at 500 chars; a truncated disclosure is a
    // half-sentence about money.
    expect((pdf.note ?? '').length).toBeLessThanOrEqual(500);
  });
});

describe('buildDayReportDetailPdf', () => {
  it('puts the method breakdown in the summary and the items in the table', () => {
    const pdf = buildDayReportDetailPdf(normalized());
    expect(pdf.columns).toEqual(['Item', 'Quantity', 'Amount']);
    expect(pdf.rows).toEqual([['Embe Dodo', '14', 'TZS 84,000.00']]);
    expect(pdf.summary).toEqual(
      expect.arrayContaining([
        { label: 'Gross total', value: 'TZS 412,000.00' },
        { label: 'Fedha (19)', value: 'TZS 331,000.00' },
        { label: 'Credit (4)', value: 'TZS 81,000.00' },
      ]),
    );
  });

  it('states that the declared-unsent figure is outside the gross total', () => {
    const pdf = buildDayReportDetailPdf(normalized());
    expect(pdf.status).toBe('PARTIAL');
    expect(pdf.note).toContain('NOT included in the gross total');
    expect(pdf.summary).toEqual(
      expect.arrayContaining([
        { label: 'Still on the phone (2, declared)', value: 'TZS 26,000.00' },
      ]),
    );
  });

  it('says nothing about unsent sales when the outbox was empty at close', () => {
    const pdf = buildDayReportDetailPdf(
      normalized({ declaredHeldCount: 0, declaredHeldAmount: 0 }),
    );
    expect(pdf.status).toBe('COMPLETED');
    expect(pdf.note).toBeUndefined();
  });

  it('exports a zero-sale day without producing an empty table', () => {
    const pdf = buildDayReportDetailPdf(
      normalized({ salesCount: 0, grossTotal: 0, items: [], byMethod: [] }),
    );
    expect(pdf.rows).toHaveLength(1);
    expect(pdf.rows[0][0]).toBe('No items sold');
  });

  it('discloses a shortened item breakdown without casting doubt on the totals', () => {
    const pdf = buildDayReportDetailPdf(normalized({ itemsTruncated: true }));
    // The flag marks a DISPLAY cap: the day is ranked in full and the smallest
    // rows are dropped from the printed list, so it can move no total. The
    // note must say the list is short...
    expect(pdf.note).toMatch(/highest-value items/i);
    // ...and must NOT repeat the old claim that Items Sold "may be
    // understated", which was true only of a 500-order bound that no longer
    // exists. The phone's own paper says the totals are complete; two papers
    // for one report cannot contradict each other in an accountant's file.
    expect(pdf.note).not.toMatch(/understated/i);
    expect(pdf.note).toMatch(/exact/i);
  });

  it('stamps a superseded close as superseded, so a filed page is not read as the day', () => {
    const [, earlier] = annotateSupersession(doubleClosedDay);
    const pdf = buildDayReportDetailPdf(earlier);
    expect(pdf.status).toBe('SUPERSEDED');
    expect(pdf.note).toContain('SUPERSEDED — close 1 of 2');
    expect(pdf.note).toContain('does not count this report');
  });

  it('tells the counted close that it is one of several', () => {
    const [latest] = annotateSupersession(doubleClosedDay);
    const pdf = buildDayReportDetailPdf(latest);
    expect(pdf.status).toBe('PARTIAL');
    expect(pdf.note).toContain('Close 2 of 2');
  });

  it('says nothing about closes when the day was closed once', () => {
    const [only] = annotateSupersession([normalized({ declaredHeldCount: 0 })]);
    expect(buildDayReportDetailPdf(only).note).toBeUndefined();
  });
});
