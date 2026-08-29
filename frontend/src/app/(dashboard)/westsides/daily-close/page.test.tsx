/**
 * The "Cash by till" panel — the per-terminal custody view of the daily close.
 *
 * What these tests pin: the panel attributes expected receipts to the till
 * that rang them, shows each terminal's OWN close (its reported total and the
 * declared held cash) BESIDE the expected figures instead of folding them in,
 * surfaces a till that never filed its close, keeps the counter remainder row
 * last — and disappears entirely when the backend does not send `byTerminal`,
 * so the panel stays purely additive.
 */

import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/hooks/use-auth', () => ({
  useAuth: () => ({ hasPermission: () => true }),
}));

vi.mock('@/hooks/use-org-scope', () => ({
  useOrgScope: () => ({
    companyOptions: [{ value: 'company-1', label: 'Westsides Trading' }],
    branchOptions: [{ value: 'branch-1', label: 'Kariakoo' }],
  }),
}));

import DailyClosePage from './page';

const byTerminal = [
  {
    terminalId: 'term-1',
    kind: 'TERMINAL',
    terminalCode: 'KAU-01',
    terminalName: 'Kaunta 1',
    tillLabel: 'Till 3',
    cashier: { userId: 'user-7', name: 'Amina Hassan', source: 'DAY_REPORT' },
    salesCount: 41,
    expectedTotal: 1180000,
    paidTotal: 1180000,
    expectedByMethod: [
      {
        paymentMethod: 'CASH',
        cashAccountId: 'ca-1',
        cashAccountName: 'Kariakoo Cash',
        cashAccountType: 'CASH_ON_HAND',
        methodLabel: 'Till 3',
        count: 41,
        expected: 1180000,
        paid: 1180000,
      },
    ],
    dayReport: {
      submittedAt: '2026-08-29T16:45:00.000Z',
      repUserId: 'user-7',
      repName: 'Amina Hassan',
      salesCount: 41,
      grossTotal: 1174000,
      byMethod: [],
      declaredHeldCount: 2,
      declaredHeldAmount: 6000,
      reportCount: 2,
    },
  },
  {
    terminalId: 'term-2',
    kind: 'TERMINAL',
    terminalCode: 'KAU-02',
    terminalName: 'Kaunta 2',
    tillLabel: null,
    cashier: { userId: 'user-8', name: 'Juma Bakari', source: 'TERMINAL_ASSIGNED' },
    salesCount: 33,
    expectedTotal: 910000,
    paidTotal: 910000,
    expectedByMethod: [
      {
        paymentMethod: 'CASH',
        cashAccountId: 'ca-1',
        cashAccountName: 'Kariakoo Cash',
        cashAccountType: 'CASH_ON_HAND',
        methodLabel: null,
        count: 33,
        expected: 910000,
        paid: 910000,
      },
    ],
    dayReport: null,
  },
  {
    terminalId: null,
    kind: 'COUNTER',
    terminalCode: null,
    terminalName: 'Counter / quick sale',
    tillLabel: null,
    cashier: { userId: null, name: null, source: null },
    salesCount: 19,
    expectedTotal: 470000,
    paidTotal: 470000,
    expectedByMethod: [
      {
        paymentMethod: 'CASH',
        cashAccountId: 'ca-1',
        cashAccountName: 'Kariakoo Cash',
        cashAccountType: 'CASH_ON_HAND',
        methodLabel: null,
        count: 19,
        expected: 470000,
        paid: 470000,
      },
    ],
    dayReport: null,
  },
];

function closePayload(overrides: Record<string, unknown> = {}) {
  return {
    date: '2026-08-29',
    companyId: 'company-1',
    branchId: 'branch-1',
    savedClose: null,
    totals: {
      salesCount: 93,
      totalSales: 2560000,
      paidAmount: 2560000,
      outstandingAmount: 0,
      taxAmount: 390508,
      discountAmount: 0,
      averageOrder: 27527,
    },
    yesterday: { salesCount: 80, totalSales: 2000000 },
    byMethod: [
      {
        paymentMethod: 'CASH',
        cashAccountId: 'ca-1',
        cashAccountName: 'Kariakoo Cash',
        cashAccountType: 'CASH_ON_HAND',
        count: 93,
        expected: 2560000,
        paid: 2560000,
      },
    ],
    bySalesType: [],
    bySalesperson: [],
    topProducts: [],
    orders: [],
    mobileMoneyReferences: [],
    ...overrides,
  };
}

async function renderClose(payload: Record<string, unknown>) {
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ data: payload }),
    }),
  );
  render(<DailyClosePage />);
  const companySelect = screen.getAllByRole('combobox')[0];
  await userEvent.selectOptions(companySelect, 'company-1');
  await waitFor(() => expect(screen.getByText('Method reconciliation')).toBeInTheDocument());
}

describe('DailyClosePage — Cash by till', () => {
  beforeEach(() => {
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

  it('attributes expected receipts per till and shows the terminal close beside them', async () => {
    await renderClose(closePayload({ byTerminal }));

    expect(screen.getByText('Cash by till')).toBeInTheDocument();
    expect(screen.getByText('2 tills + counter')).toBeInTheDocument();

    const row = screen.getByText('KAU-01').closest('tr') as HTMLElement;
    expect(row).not.toBeNull();
    // Till identity, cashier, and the custody source of the attribution.
    expect(within(row).getByText('Till: Till 3')).toBeInTheDocument();
    expect(within(row).getByText('Amina Hassan')).toBeInTheDocument();
    expect(within(row).getByText('from terminal close')).toBeInTheDocument();
    // Expected stays the server's figure; the terminal's own close and the
    // declared held pair sit BESIDE it (1,174,000 sent + 6,000 held = drawer).
    // The figure appears in the method sub-line and the Expected column.
    expect(within(row).getAllByText('1,180,000.00').length).toBeGreaterThan(0);
    expect(within(row).getByText('TZS 1,174,000.00')).toBeInTheDocument();
    expect(within(row).getByText(/Declared held: 2 · TZS 6,000\.00/)).toBeInTheDocument();
    expect(within(row).getByText('-6,000.00')).toBeInTheDocument();
    expect(within(row).getByText(/latest of 2 closes/)).toBeInTheDocument();
  });

  it('surfaces a till that never filed its close instead of defaulting it', async () => {
    await renderClose(closePayload({ byTerminal }));

    const row = screen.getByText('KAU-02').closest('tr') as HTMLElement;
    expect(within(row).getByText('no terminal close filed')).toBeInTheDocument();
    expect(within(row).getByText('assigned to terminal')).toBeInTheDocument();
  });

  it('keeps the counter remainder row last and totals the panel', async () => {
    await renderClose(closePayload({ byTerminal }));

    const panel = screen.getByText('Cash by till').closest('div')?.parentElement as HTMLElement;
    const table = panel.parentElement?.querySelector('table') as HTMLElement;
    const bodyRows = within(table).getAllByRole('row').slice(1, -1); // drop head + foot
    expect(bodyRows).toHaveLength(3);
    expect(bodyRows[2]).toHaveTextContent('Counter / quick sale');
    expect(bodyRows[2]).toHaveTextContent('counted at branch close');
    // Panel totals tie back to the branch reconciliation above.
    expect(within(table).getByText('2,560,000.00')).toBeInTheDocument();
    expect(within(table).getByText(/Declared held total: TZS 6,000\.00/)).toBeInTheDocument();
  });

  it('renders no till panel when the backend does not send byTerminal', async () => {
    await renderClose(closePayload());

    expect(screen.queryByText('Cash by till')).not.toBeInTheDocument();
    // The rest of the close is untouched.
    expect(screen.getByText('Method reconciliation')).toBeInTheDocument();
  });

  it('compares the close against its business-day expected figure and discloses summed handover closes', async () => {
    // A night till: every sale fell inside the terminal's business day but
    // before this close's own window, so the close-window expected is an
    // honest zero while the terminal's close reports the real 400,000 — the
    // delta must compare like windows and show no phantom shortfall. Two
    // cashiers' latest closes are summed (shift handover, 3 reports filed).
    const nightTill = {
      terminalId: 'term-9',
      kind: 'TERMINAL',
      terminalCode: 'KAU-09',
      terminalName: 'Usiku',
      tillLabel: null,
      cashier: { userId: 'user-9', name: 'Rehema', source: 'DAY_REPORT' },
      salesCount: 0,
      expectedTotal: 0,
      paidTotal: 0,
      expectedByMethod: [],
      businessDayExpectedTotal: 400000,
      businessDaySalesCount: 12,
      dayReport: {
        submittedAt: '2026-08-29T21:10:00.000Z',
        repUserId: 'user-9',
        repName: 'Rehema + Zena',
        salesCount: 12,
        grossTotal: 400000,
        byMethod: [],
        declaredHeldCount: 1,
        declaredHeldAmount: 25000,
        reportCount: 3,
        repCount: 2,
      },
    };
    await renderClose(closePayload({ byTerminal: [...byTerminal, nightTill] }));

    // The two windows are labeled apart, not presented as the same figure.
    expect(screen.getByText('Expected (close window)')).toBeInTheDocument();
    expect(screen.getByText('Reported vs expected (business day)')).toBeInTheDocument();

    const row = screen.getByText('KAU-09').closest('tr') as HTMLElement;
    expect(within(row).getByText('TZS 400,000.00')).toBeInTheDocument();
    expect(within(row).getByText('Business-day expected: TZS 400,000.00')).toBeInTheDocument();
    // 400,000 reported vs 400,000 business-day expected: balanced — NOT a
    // -400,000 shortfall against the zero close-window figure.
    expect(within(row).getByText('+0.00')).toBeInTheDocument();
    expect(
      within(row).getByText(/latest close per cashier summed \(3 filed\)/),
    ).toBeInTheDocument();
    expect(within(row).getByText('Rehema + Zena', { exact: false })).toBeInTheDocument();
  });
});
