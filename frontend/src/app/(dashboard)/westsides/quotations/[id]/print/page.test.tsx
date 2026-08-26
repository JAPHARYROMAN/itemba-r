import { render, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it, vi, beforeEach } from 'vitest';

const backendGet = vi.fn();

vi.mock('next/navigation', () => ({ useParams: () => ({ id: 'quote-1' }) }));
vi.mock('next/link', () => ({
  default: ({ children, href }: { children: React.ReactNode; href: string }) => (
    <a href={href}>{children}</a>
  ),
}));
vi.mock('@/lib/api-client', () => ({ backendGet: (...args: unknown[]) => backendGet(...args) }));
vi.mock('@/components/documents', () => ({
  DocumentArtifactButton: () => <button type="button">Generate PDF</button>,
  DocumentPrintButton: () => <button type="button">Print / Save PDF</button>,
}));
vi.mock('@/components/ui', () => ({
  Card: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  PageSpinner: () => <div>loading</div>,
}));

import QuotationPrintPage from './page';
import { firstPageCapacity } from './page-budget';

function quotation(lineCount: number, overrides: Record<string, unknown> = {}) {
  return {
    id: 'quote-1',
    quotationNumber: 'QUO-2026-000001',
    quotationDate: '2026-08-20T00:00:00.000Z',
    validUntil: '2026-09-03T00:00:00.000Z',
    quotationType: 'BUILDING_MATERIALS',
    status: 'SENT',
    currency: 'TZS',
    subtotal: 1000,
    discountAmount: 0,
    taxAmount: 0,
    totalAmount: 1000,
    notes: 'Prices valid within the stated period.',
    company: { name: 'Itemba Distribution', profile: { tin: '136-065-580' } },
    customer: { name: 'Mega Mart' },
    lines: Array.from({ length: lineCount }, (_, index) => ({
      id: `line-${index + 1}`,
      product: { name: `Product ${index + 1}`, sku: `SKU-${index + 1}` },
      unit: { symbol: 'pc' },
      quantity: 1,
      unitPrice: 100,
      discountAmount: 0,
      taxAmount: 0,
      lineTotal: 100,
    })),
    ...overrides,
  };
}

describe('QuotationPrintPage', () => {
  beforeEach(() => backendGet.mockReset());

  it('renders a typical quotation on a single sheet', async () => {
    backendGet.mockResolvedValue(quotation(8));
    render(<QuotationPrintPage />);

    await screen.findByText('QUO-2026-000001');
    expect(document.querySelectorAll('.quotation-sheet')).toHaveLength(1);
    expect(screen.getByText(/Fits one page/)).toBeTruthy();
    expect(screen.getByText('Page 1 of 1')).toBeTruthy();
  });

  it('keeps the total and both signature blocks on page 1 when lines overflow', async () => {
    backendGet.mockResolvedValue(quotation(80));
    render(<QuotationPrintPage />);

    await screen.findByText('QUO-2026-000001');
    const sheets = document.querySelectorAll<HTMLElement>('.quotation-sheet');
    expect(sheets).toHaveLength(2);

    // The whole point: page 1 stands alone as a complete quotation.
    const first = within(sheets[0]);
    expect(first.getByText('Total')).toBeTruthy();
    expect(first.getByText('Issued By')).toBeTruthy();
    expect(first.getByText('Customer Acceptance')).toBeTruthy();

    // The continuation sheet carries rows only - no second total to contradict.
    const second = within(sheets[1]);
    expect(second.getByText(/Line Items \(continued\)/)).toBeTruthy();
    expect(second.queryByText('Customer Acceptance')).toBeNull();
  });

  it('splits at the budgeted capacity without losing a line', async () => {
    const count = 80;
    backendGet.mockResolvedValue(quotation(count));
    render(<QuotationPrintPage />);

    await screen.findByText('QUO-2026-000001');
    const capacity = firstPageCapacity(true);
    const rows = document.querySelectorAll('.quotation-row');
    expect(rows).toHaveLength(count);

    const sheets = document.querySelectorAll<HTMLElement>('.quotation-sheet');
    expect(sheets[0].querySelectorAll('.quotation-row')).toHaveLength(capacity);
    expect(sheets[1].querySelectorAll('.quotation-row')).toHaveLength(count - capacity);
  });

  it('numbers continuation rows continuing from page 1 rather than restarting', async () => {
    backendGet.mockResolvedValue(quotation(80));
    render(<QuotationPrintPage />);

    await screen.findByText('QUO-2026-000001');
    const sheets = document.querySelectorAll<HTMLElement>('.quotation-sheet');
    const firstRowOnSheetTwo = sheets[1].querySelector('.quotation-row');
    expect(firstRowOnSheetTwo?.textContent).toContain(String(firstPageCapacity(true) + 1));
  });

  it('drops the discount and tax columns when every line is zero', async () => {
    backendGet.mockResolvedValue(quotation(4));
    render(<QuotationPrintPage />);

    await screen.findByText('QUO-2026-000001');
    const headers = Array.from(document.querySelectorAll('.quotation-table th')).map(
      (th) => th.textContent,
    );
    expect(headers).not.toContain('Discount');
    expect(headers).not.toContain('Tax');
    expect(headers).toContain('Amount');
  });

  it('shows the discount column as soon as one line carries a discount', async () => {
    const model = quotation(4);
    model.lines[2].discountAmount = 250;
    backendGet.mockResolvedValue(model);
    render(<QuotationPrintPage />);

    await screen.findByText('QUO-2026-000001');
    const headers = Array.from(document.querySelectorAll('.quotation-table th')).map(
      (th) => th.textContent,
    );
    expect(headers).toContain('Discount');
    expect(headers).not.toContain('Tax');
  });

  it('prints an item quoted before it exists in the catalogue', async () => {
    const model = quotation(0);
    model.lines = [
      {
        id: 'adhoc-1',
        product: null,
        unit: null,
        itemName: 'Site clearing',
        unitLabel: 'trip',
        quantity: 2,
        unitPrice: 50000,
        discountAmount: 0,
        taxAmount: 0,
        lineTotal: 100000,
      },
    ] as never;
    backendGet.mockResolvedValue(model);
    render(<QuotationPrintPage />);

    await screen.findByText('QUO-2026-000001');
    // Regression guard: this rendered as "N/A" before itemName/unitLabel were read.
    expect(screen.getByText('Site clearing')).toBeTruthy();
    expect(screen.getByText('trip')).toBeTruthy();
  });

  it('does not render a continuation sheet for an empty quotation', async () => {
    backendGet.mockResolvedValue(quotation(0));
    render(<QuotationPrintPage />);

    await waitFor(() => expect(screen.getByText('QUO-2026-000001')).toBeTruthy());
    expect(document.querySelectorAll('.quotation-sheet')).toHaveLength(1);
    expect(screen.getByText(/No line items/)).toBeTruthy();
  });
});
