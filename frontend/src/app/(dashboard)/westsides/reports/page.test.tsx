/**
 * The Undelivered Confirmed Orders entry in the Westsides report catalog.
 *
 * What these tests pin: the report rides the catalog's existing plumbing —
 * the endpoint is fetched with the standard scope params, the exposure
 * figures are renamed onto money-suffixed keys so the page's TZS formatter
 * picks them up, the backend `totals` block feeds the summary tiles, the
 * delivery-note objects flatten to a readable reference list, and the PDF
 * export carries the same formatted view the table shows.
 */

import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const downloadTablePdf = vi.fn();

vi.mock('@/hooks/use-org-scope', () => ({
  useOrgScope: () => ({
    companyOptions: [{ value: 'company-1', label: 'Westsides Trading' }],
    branchOptions: [],
    loading: false,
  }),
}));

vi.mock('@/lib/export-download', () => ({
  downloadTablePdf: (req: unknown) => downloadTablePdf(req),
}));

// The letterhead image is not under test; next/image needs app context that
// jsdom does not provide.
vi.mock('next/image', () => ({
  default: () => null,
}));

import WestsideReportsPage from './page';

const SETTINGS_KEY = 'itemba.westsides.readable-reports.v1';

const cutoffPayload = {
  scope: { companyId: 'company-1', branchId: null, asOf: '2026-08-29', dateFrom: null },
  generatedAt: '2026-08-29T10:00:00.000Z',
  coverageBasis: 'PER_PRODUCT_HEURISTIC',
  totals: {
    orderCount: 1,
    orderedQuantity: 100,
    deliveredQuantity: 60,
    undeliveredQuantity: 40,
    netRevenueExposure: 1694920,
    cogsExposure: 1520000,
    grossProfitExposure: 174920,
  },
  rows: [
    {
      salesOrderId: 'so-1',
      salesOrderNumber: 'SO-0042',
      orderDate: '2026-08-25T08:00:00.000Z',
      branchId: 'branch-1',
      status: 'CONFIRMED',
      paymentStatus: 'UNPAID',
      customerName: 'Mwananchi Traders',
      customerCode: 'CUST-9',
      outstandingAmount: 5000000,
      orderedQuantity: 100,
      deliveredQuantity: 60,
      undeliveredQuantity: 40,
      inTransitQuantity: 10,
      coverageRatio: 0.6,
      deliveryState: 'PARTIALLY_DELIVERED',
      daysSinceOrder: 4,
      netRevenue: 4237300,
      cogsAmount: 3800000,
      grossProfit: 437300,
      netRevenueExposure: 1694920,
      cogsExposure: 1520000,
      grossProfitExposure: 174920,
      deliveryNotes: [
        {
          id: 'dn-1',
          deliveryNoteNumber: 'DN-0007',
          status: 'DELIVERED',
          deliveryDate: '2026-08-27T00:00:00.000Z',
        },
      ],
      readinessStatus: 'WARNING',
      _reportMeta: { readiness: { status: 'WARNING', message: 'partial' } },
    },
  ],
  rowCap: 200,
  truncated: false,
  scanCap: 2000,
  scanTruncated: false,
};

async function renderUndeliveredReport(payload: Record<string, unknown> = cutoffPayload) {
  localStorage.setItem(
    SETTINGS_KEY,
    JSON.stringify({ companyId: 'company-1', activeKey: 'undelivered-confirmed-orders' }),
  );
  const fetchMock = vi.fn().mockResolvedValue({
    ok: true,
    json: () => Promise.resolve({ data: payload }),
  });
  vi.stubGlobal('fetch', fetchMock);
  render(<WestsideReportsPage />);
  await waitFor(() => expect(screen.getByText('SO-0042')).toBeInTheDocument());
  return fetchMock;
}

describe('WestsideReportsPage — Undelivered Confirmed Orders', () => {
  beforeEach(() => {
    downloadTablePdf.mockReset();
    localStorage.clear();
    vi.unstubAllGlobals();
    vi.stubGlobal(
      'matchMedia',
      vi.fn().mockReturnValue({
        matches: true,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      }),
    );
  });

  it('is registered in the catalog and loads through the standard plumbing', async () => {
    const fetchMock = await renderUndeliveredReport();

    const url = String(fetchMock.mock.calls[0][0]);
    expect(url).toContain('/api/backend/westsides/reports/undelivered-confirmed-orders');
    expect(url).toContain('companyId=company-1');
  });

  it('formats exposure as money and flattens delivery notes', async () => {
    await renderUndeliveredReport();

    // Renamed exposure columns ride the page's TZS formatter (the heading and
    // the money figure also appear in the summary tiles, hence getAllByText) …
    expect(screen.getAllByText('Undelivered Revenue').length).toBeGreaterThan(0);
    expect(screen.getAllByText('TZS 1,520,000.00').length).toBeGreaterThan(0);
    // … the raw backend field names do not leak into headings …
    expect(screen.queryByText('Net Revenue Exposure')).not.toBeInTheDocument();
    // … ids and readiness plumbing stay hidden …
    expect(screen.queryByText('Sales Order Id')).not.toBeInTheDocument();
    expect(screen.queryByText('Readiness Status')).not.toBeInTheDocument();
    // … and delivery notes become a readable reference list.
    expect(screen.getByText('DN-0007 (DELIVERED)')).toBeInTheDocument();
    expect(screen.getByText('PARTIALLY DELIVERED')).toBeInTheDocument();
  });

  it('feeds the summary tiles from the backend totals block', async () => {
    await renderUndeliveredReport();

    // Screen tiles + print summary both render the totals; the exposure total
    // must be the backend figure, not a per-page recomputation.
    expect(screen.getAllByText('TZS 1,694,920.00').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Order Count').length).toBeGreaterThan(0);
  });

  it('exports the same formatted view it shows', async () => {
    await renderUndeliveredReport();
    await userEvent.click(screen.getByRole('button', { name: 'Export PDF' }));

    await waitFor(() => expect(downloadTablePdf).toHaveBeenCalledTimes(1));
    const request = downloadTablePdf.mock.calls[0][0];
    expect(request.title).toBe('Undelivered Confirmed Orders');
    expect(request.columns).toContain('Undelivered Revenue');
    const revenueIndex = request.columns.indexOf('Undelivered Revenue');
    expect(request.numericColumns).toContain(revenueIndex);
    expect(request.rows[0][revenueIndex]).toBe('TZS 1,694,920.00');
  });

  it('surfaces the truncation and missing-cost honesty flags as a printed notice and in the PDF meta', async () => {
    // 250 flagged orders, one row returned: the summary tiles cover all 250
    // while the table carries the capped rows — the document must say so, on
    // screen AND on paper, and the missing-cost disclosure rides along.
    const truncatedPayload = {
      ...cutoffPayload,
      totals: { ...cutoffPayload.totals, orderCount: 250, ordersMissingCost: 3 },
      rows: [{ ...cutoffPayload.rows[0], cogsMissing: true }],
      rowCap: 200,
      truncated: true,
      scanCap: 1000,
      scanTruncated: true,
    };
    await renderUndeliveredReport(truncatedPayload);

    const notice = screen.getByText(/Showing the 200 largest exposures of 250 flagged orders/);
    expect(notice.textContent).toContain('summary totals cover all flagged orders');
    expect(notice.textContent).toContain('stopped at the 1,000-candidate cap');
    expect(notice.textContent).toContain('no snapshotted cost');
    // The notice prints with the document: it must not sit in a no-print box.
    expect(notice.closest('.no-print')).toBeNull();
    // The per-row missing-cost flag is a visible Yes/No column.
    expect(screen.getByText('Cogs Missing')).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Export PDF' }));
    await waitFor(() => expect(downloadTablePdf).toHaveBeenCalledTimes(1));
    const request = downloadTablePdf.mock.calls[0][0];
    expect(request.meta).toContainEqual({
      label: 'Note',
      value: expect.stringContaining('largest exposures'),
    });
  });

  it('renders no notice when nothing is truncated and no cost is missing', async () => {
    await renderUndeliveredReport();

    expect(screen.queryByText(/largest exposures/)).not.toBeInTheDocument();
    expect(screen.queryByText(/candidate cap/)).not.toBeInTheDocument();
  });
});
