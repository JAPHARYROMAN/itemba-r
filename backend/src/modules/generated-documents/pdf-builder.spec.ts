import { BusinessPdfModel, buildBusinessPdf } from './pdf-builder';

function sampleModel(overrides: Partial<BusinessPdfModel> = {}): BusinessPdfModel {
  return {
    title: 'Sales Order',
    subtitle: 'Mega Mart',
    reference: 'SO-2026-0001',
    status: 'Confirmed',
    organization: {
      name: 'Itemba Distribution Ltd',
      groupName: 'ITEMBA GROUP',
      branchName: 'Dar es Salaam HQ',
      address: '12 Nyerere Road, Dar es Salaam',
      phone: '+255 700 000 001',
      email: 'info@itembagrouptz.com',
      website: 'itembagrouptz.com',
      tin: '123-456-789',
    },
    generatedAt: new Date('2026-07-06T10:00:00Z'),
    meta: [
      { label: 'Order Number', value: 'SO-2026-0001' },
      { label: 'Order Date', value: '06/07/2026' },
      { label: 'Due Date', value: '20/07/2026' },
      { label: 'Payment Status', value: 'PENDING' },
    ],
    sections: [
      {
        title: 'Line Items',
        table: {
          headers: ['Item', 'SKU', 'Qty', 'Unit', 'Unit Price', 'Discount', 'Tax', 'Line Total'],
          numericColumns: [2, 4, 5, 6, 7],
          mutedColumns: [1],
          rows: [
            ['Cement Bag', 'CEM-50', '10', 'bag', '18,000.00', '0.00', '0.00', '180,000.00'],
            ['Iron Sheet', 'IRS-28', '5', 'pc', '25,000.00', '0.00', '0.00', '125,000.00'],
            ['Nails 3in', 'NLS-3', '2', 'kg', '4,500.00', '0.00', '0.00', '9,000.00'],
          ],
        },
        totals: [
          { label: 'Subtotal', value: 'TZS 314,000.00' },
          { label: 'Tax', value: 'TZS 0.00' },
          { label: 'Total', value: 'TZS 314,000.00', emphasis: true },
        ],
      },
      { title: 'Notes', paragraphs: ['Deliver to the main warehouse before noon.'] },
      { title: 'Authorization', signatures: ['Prepared By', 'Approved By', 'Customer'] },
    ],
    ...overrides,
  };
}

function occurrences(raw: string, needle: string): number {
  let count = 0;
  let index = raw.indexOf(needle);
  while (index !== -1) {
    count += 1;
    index = raw.indexOf(needle, index + needle.length);
  }
  return count;
}

// Palette ops as emitted after num() 2-dp rounding (0.145 stores as
// 0.14499..., so toFixed(2) yields 0.14 — see BRAND in pdf-builder.ts).
const BRAND_FILL_OP = '0.14 0.39 0.92 rg';
const BRAND_TINT_FILL_OP = '0.94 0.96 1 rg';
const BRAND_TINT_STRONG_FILL_OP = '0.86 0.92 1 rg';
const TEXT_MUTED_FILL_OP = '0.39 0.46 0.55 rg';
const PANEL_FILL_OP = '0.97 0.98 0.99 rg';
const BRAND_RULE_OP = `${BRAND_FILL_OP} 0 838.89 595.28 3 re f`;

describe('buildBusinessPdf rendering', () => {
  it('renders the redesigned single-page document', () => {
    const buffer = buildBusinessPdf(sampleModel());
    const raw = buffer.toString('latin1');

    expect(raw.startsWith('%PDF-')).toBe(true);
    expect(raw.trimEnd().endsWith('%%EOF')).toBe(true);

    // Document type replaces the old 'DOCUMENT' literal in the letterhead.
    expect(raw).toContain('(SALES ORDER) Tj');
    expect(raw).not.toContain('(DOCUMENT) Tj');

    // Brand color plumbing landed: accent rule / reference / table labels.
    expect(raw).toContain(BRAND_FILL_OP);
    expect(raw).toContain(BRAND_RULE_OP);
    // Tinted table-header band and grand-total emphasis row.
    expect(raw).toContain(BRAND_TINT_FILL_OP);
    expect(raw).toContain(BRAND_TINT_STRONG_FILL_OP);
    // Muted SKU cells (mutedColumns) render in TEXT_MUTED.
    expect(raw).toContain(TEXT_MUTED_FILL_OP);

    // The legacy per-row gray stroke box is gone.
    expect(raw).not.toContain('0.85 g');

    // Footer: contact line left, generated stamp + page counter right.
    expect(raw).toContain('Page 1 of');
    expect(raw).toContain('itembagrouptz.com | info@itembagrouptz.com | +255 700 000 001');
    expect(raw).toContain('Generated ');
  });

  it('paginates long tables and repeats chrome on every page', () => {
    const rows = Array.from({ length: 60 }, (_, index) => [
      `Product ${index + 1}`,
      `SKU-${index + 1}`,
      '1',
      'pc',
      '1,000.00',
      '0.00',
      '0.00',
      '1,000.00',
    ]);
    const buffer = buildBusinessPdf(
      sampleModel({
        sections: [
          {
            title: 'Lines',
            table: {
              headers: [
                'Item',
                'SKU',
                'Qty',
                'Unit',
                'Unit Price',
                'Discount',
                'Tax',
                'Line Total',
              ],
              numericColumns: [2, 4, 5, 6, 7],
              mutedColumns: [1],
              rows,
            },
          },
        ],
      }),
    );
    const raw = buffer.toString('latin1');

    const countMatch = raw.match(/\/Count (\d+)/);
    expect(countMatch).not.toBeNull();
    const pageCount = Number(countMatch![1]);
    expect(pageCount).toBeGreaterThanOrEqual(2);

    // The tinted table header repeats at the top of each continuation page.
    expect(occurrences(raw, '(ITEM) Tj')).toBe(pageCount);
    // The brand accent rule is painted on every page.
    expect(occurrences(raw, BRAND_RULE_OP)).toBe(pageCount);
    // Every page carries its footer page counter.
    for (let page = 1; page <= pageCount; page += 1) {
      expect(raw).toContain(`Page ${page} of ${pageCount}`);
    }
  });

  it('supports landscape reports with weighted columns and wrapped table headings', () => {
    const buffer = buildBusinessPdf(
      sampleModel({
        orientation: 'landscape',
        title: 'Daily Sales Report',
        sections: [
          {
            title: 'Report Detail',
            table: {
              headers: ['Recorded Sales', 'Description'],
              columnWeights: [0.2, 5],
              numericColumns: [0],
              stripedRows: true,
              rows: [
                ['1,200,000.00', 'Daily close for the main branch'],
                ['900,000.00', 'Daily close for the second branch'],
              ],
            },
          },
        ],
      }),
    );
    const raw = buffer.toString('latin1');

    expect(raw).toContain('/MediaBox [0 0 841.89 595.28]');
    expect(raw).toContain('(RECORDED) Tj');
    expect(raw).toContain('(SALES) Tj');
    expect(raw).toContain(PANEL_FILL_OP);
  });

  it('starts requested detail sections on a clean continuation page', () => {
    const buffer = buildBusinessPdf(
      sampleModel({
        sections: [
          {
            title: 'Consolidated Debt Schedule',
            paragraphs: ['Summary of all active customer debts.'],
          },
          {
            title: 'Debt Detail - REC-2026-000001',
            pageBreakBefore: true,
            paragraphs: ['First debt detail.'],
          },
          {
            title: 'Debt Detail - REC-2026-000002',
            pageBreakBefore: true,
            paragraphs: ['Second debt detail.'],
          },
        ],
      }),
    );
    const raw = buffer.toString('latin1');

    expect(raw).toContain('/Count 3');
    expect(raw).toContain('(CONSOLIDATED DEBT SCHEDULE) Tj');
    expect(raw).toContain('(DEBT DETAIL - REC-2026-000001) Tj');
    expect(raw).toContain('(DEBT DETAIL - REC-2026-000002) Tj');
    expect(occurrences(raw, BRAND_RULE_OP)).toBe(3);
  });
});
