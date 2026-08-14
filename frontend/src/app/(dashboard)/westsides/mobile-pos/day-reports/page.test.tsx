/**
 * The register's wiring, not its arithmetic — `day-reports-data.test.ts` owns
 * the deduplication rule itself. What this file pins is that the SCREEN uses
 * it: the stat row, the table markings and the PDF export all read the same
 * deduplicated view, so none of them can drift back to summing the rows.
 */

import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const backendList = vi.fn();
const downloadTablePdf = vi.fn();

vi.mock('@/hooks/use-auth', () => ({
  useAuth: () => ({ hasPermission: () => true }),
}));

vi.mock('@/hooks/use-org-scope', () => ({
  useOrgScope: () => ({ companyOptions: [], branchOptions: [] }),
}));

vi.mock('@/lib/api-client', () => ({
  backendList: (path: string, opts?: unknown) => backendList(path, opts),
}));

vi.mock('@/lib/export-download', () => ({
  downloadTablePdf: (req: unknown) => downloadTablePdf(req),
}));

import MobilePosDayReportsPage from './page';

/** One rep, one terminal, one day — closed twice. The 20:00 close recomputed */
/** the whole day, so it CONTAINS the 14:00 one: the day is 18 / 360,000. */
const dayClosedTwice = [
  {
    id: 'close-evening',
    businessDate: '2026-08-14',
    reference: 'TERM-014-20260814',
    submittedAt: '2026-08-14T20:00:00.000Z',
    terminal: { id: 'terminal-1', code: 'TERM-014', name: 'Kaunta 1' },
    branch: { id: 'branch-1', name: 'Uzunguni' },
    rep: { id: 'user-1', name: 'Asha Mwinyi' },
    salesCount: 18,
    grossTotal: 360000,
    itemsSoldQuantity: 60,
    byMethod: [],
    items: [],
    itemsTruncated: false,
    declaredHeldCount: 0,
    declaredHeldAmount: 0,
  },
  {
    id: 'close-afternoon',
    businessDate: '2026-08-14',
    reference: 'TERM-014-20260814',
    submittedAt: '2026-08-14T14:00:00.000Z',
    terminal: { id: 'terminal-1', code: 'TERM-014', name: 'Kaunta 1' },
    branch: { id: 'branch-1', name: 'Uzunguni' },
    rep: { id: 'user-1', name: 'Asha Mwinyi' },
    salesCount: 10,
    grossTotal: 200000,
    itemsSoldQuantity: 33,
    byMethod: [],
    items: [],
    itemsTruncated: false,
    declaredHeldCount: 0,
    declaredHeldAmount: 0,
  },
];

function mockList(reports: unknown[]) {
  backendList.mockImplementation((path: string) =>
    Promise.resolve(path.includes('/terminals') ? [] : reports),
  );
}

async function renderRegister(reports: unknown[]) {
  mockList(reports);
  render(<MobilePosDayReportsPage />);
  await waitFor(() => expect(screen.getByText(/loaded submission/)).toBeInTheDocument());
}

describe('MobilePosDayReportsPage', () => {
  beforeEach(() => {
    backendList.mockReset();
    downloadTablePdf.mockReset();
    // StatCard counts its numbers up over 800ms unless the reader asked for
    // reduced motion. Asserting the final figure should not mean racing an
    // animation, so the tests read the page as a reduced-motion reader does.
    vi.stubGlobal(
      'matchMedia',
      vi.fn().mockReturnValue({
        matches: true,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      }),
    );
  });

  it('shows the terminal-day once in the headline figures', async () => {
    await renderRegister(dayClosedTwice);

    // Not 28 sales and not TZS 560,000 — the later close contains the earlier.
    // Money is a formatted string, so it never rides StatCard's count-up and
    // this assertion is the one that cannot be satisfied by an animation frame.
    expect(screen.getByText('Gross Total', { selector: 'p' }).parentElement).toHaveTextContent(
      'TZS 360,000.00',
    );
    expect(screen.queryByText('TZS 560,000.00')).not.toBeInTheDocument();
    expect(screen.getByText('Terminal-Days').parentElement).toHaveTextContent(
      '2 submissions · 1 superseded',
    );
    // The count is numeric: reduced motion pins it, and the wait covers the
    // effect that applies it.
    await waitFor(() =>
      expect(screen.getByText('Sales', { selector: 'p' }).parentElement).toHaveTextContent('18'),
    );
  });

  it('marks the superseded close in the table instead of hiding it', async () => {
    await renderRegister(dayClosedTwice);

    // Both closes are still listed: that a day was closed twice is information.
    expect(screen.getAllByRole('row')).toHaveLength(3);
    expect(screen.getByText('SUPERSEDED')).toBeInTheDocument();
    expect(screen.getByText('close 1 of 2')).toBeInTheDocument();
    expect(screen.getByText('Counted · close 2 of 2')).toBeInTheDocument();
    expect(screen.getByTestId('superseded-disclosure')).toHaveTextContent(
      'Every close recomputes the whole day on the server',
    );
  });

  it('exports the same corrected figures it shows', async () => {
    await renderRegister(dayClosedTwice);
    await userEvent.click(screen.getByLabelText('Export filtered day reports to PDF'));

    await waitFor(() => expect(downloadTablePdf).toHaveBeenCalledTimes(1));
    const request = downloadTablePdf.mock.calls[0][0];
    expect(request.summary).toContainEqual({ label: 'Gross total', value: 'TZS 360,000.00' });
    expect(request.summary).toContainEqual({ label: 'Terminal-days counted', value: '1' });
    expect(request.summary).toContainEqual({ label: 'Sales', value: '18' });
    expect(request.rows).toHaveLength(2);
    expect(request.note).toContain('superseded');
  });

  it('says nothing about supersession on an ordinary window', async () => {
    await renderRegister([dayClosedTwice[0]]);
    expect(screen.queryByTestId('superseded-disclosure')).not.toBeInTheDocument();
    expect(screen.queryByText('SUPERSEDED')).not.toBeInTheDocument();
    expect(screen.getByText('Terminal-Days').parentElement).toHaveTextContent('1 submission');
  });
});
