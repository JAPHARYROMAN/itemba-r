import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { DailyReports } from './DailyReports';
import type { PosShellProps } from './PosShell';
import { usePosLang } from '../core/pos-i18n';
const h = vi.hoisted(() => ({ get: vi.fn(), pdf: vi.fn() }));
vi.mock('@/lib/api-client', () => ({ backendGet: h.get }));
vi.mock('../core/pos-receipt', () => ({ sharePdfDocument: h.pdf }));
vi.mock('@/lib/mobile-pos-lite-store', () => ({
  posDaylogDate: (date = new Date()) =>
    new Date(date.getTime() + 10800000).toISOString().slice(0, 10),
}));
const props = {
  online: true,
  binding: { terminalCode: 'T-1', deviceSecret: 'private', activatedAt: '' },
  pendingSales: [],
  session: { branch: { name: 'Branch' }, terminal: { name: 'Till' }, rep: { name: 'Cashier' } },
} as unknown as PosShellProps;
function Reports({ value = props }: { value?: PosShellProps }) {
  const { t } = usePosLang();
  return <DailyReports props={{ ...value, t }} />;
}
function report(date: string, grossTotal = 1800) {
  return {
    businessDate: date,
    asOf: new Date().toISOString(),
    salesCount: 2,
    grossTotal,
    itemsSoldQuantity: 2,
    initialReceipts: 1300,
    initialCredit: 500,
    collectionCount: 1,
    collectionTotal: 100,
    refundCount: 1,
    refundTotal: 50,
    netReceipts: 1350,
    byMethod: [],
    collectionByMethod: [],
    items: [],
    itemsTruncated: false,
  };
}
afterEach(() => vi.resetAllMocks());
describe('Native daily report', () => {
  it('ignores a delayed refresh of the previous date, and exports the selected date by GET', async () => {
    const user = userEvent.setup();
    let resolveOld!: (v: unknown) => void;
    h.get.mockImplementation(async (path: string) => report(path.split('=')[1]));
    h.pdf.mockResolvedValue(true);
    localStorage.setItem('itemba-pos-lang', 'en');
    render(<Reports />);
    const selector = screen.getByRole('combobox');
    await screen.findByText('TZS 1,800');
    h.get.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveOld = resolve;
        }),
    );
    await user.click(screen.getByRole('button', { name: 'Refresh' }));
    const options = screen.getAllByRole('option');
    const olderDate = options[1].getAttribute('value')!;
    await user.selectOptions(selector, olderDate);
    await screen.findByText('TZS 1,800');
    await act(async () => resolveOld(report(options[0].getAttribute('value')!, 99999)));
    expect(screen.queryByText('TZS 99,999')).toBeNull();
    await user.click(screen.getByRole('button', { name: /Export.*PDF/i }));
    expect(h.pdf).toHaveBeenCalledWith(
      props.binding,
      `/api/backend/mobile-pos-lite/daily-summary/pdf?businessDate=${olderDate}`,
      `POS-T-1-${olderDate}.pdf`,
    );
  });
  it('clears financial totals offline and disables PDF without counting pending device sales', async () => {
    h.get.mockImplementation(async (path: string) => report(path.split('=')[1]));
    localStorage.setItem('itemba-pos-lang', 'en');
    const view = render(<Reports />);
    await screen.findByText('TZS 1,800');
    view.rerender(<Reports value={{ ...props, online: false }} />);
    await waitFor(() => expect(screen.queryByText('TZS 1,800')).toBeNull());
    expect(screen.getByRole('button', { name: /Export.*PDF/i })).toBeDisabled();
    expect(h.pdf).not.toHaveBeenCalled();
  });
});
