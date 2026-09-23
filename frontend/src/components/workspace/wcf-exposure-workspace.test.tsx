import { act, fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { WcfExposureWorkspace } from './wcf-exposure-workspace';
import type { WcfExposure } from './wcf-exposure-types';
const state = vi.hoisted(() => ({
  permissions: new Set<string>(),
  companyId: null as string | null,
  get: vi.fn(),
  page: vi.fn(),
}));
vi.mock('@/hooks/use-auth', () => ({
  useAuth: () => ({
    user: { companyId: state.companyId },
    hasPermission: (p: string) => state.permissions.has(p),
  }),
}));
vi.mock('@/lib/api-client', () => ({ backendGet: state.get, backendPage: state.page }));
const fixture: WcfExposure = {
  header: {
    companyId: 'company',
    companyName: 'Example Company',
    companyTin: 'EXAMPLE-TIN',
    year: 2026,
    fromMonth: 1,
    toMonth: 3,
    periodLabel: 'January – March 2026',
  },
  summary: { branchCount: 2, totalGross: 6000000, totalWcf: 30000, effectiveRate: 0.005 },
  branches: [
    {
      branchId: 'branch',
      branchName: 'Central branch',
      branchCode: 'CENTRAL',
      region: 'Example region',
      totalEmployees: 2,
      totalGross: 5000000,
      totalWcf: 25000,
      monthlyExposure: [
        { month: 1, gross: 2000000, wcfAmount: 10000, employees: 2 },
        { month: 3, gross: 3000000, wcfAmount: 15000, employees: 1 },
      ],
    },
    {
      branchId: null,
      branchName: 'Unassigned (no branch)',
      branchCode: null,
      totalEmployees: 1,
      totalGross: 1000000,
      totalWcf: 5000,
      monthlyExposure: [{ month: 1, gross: 1000000, wcfAmount: 5000, employees: 1 }],
    },
  ],
};
beforeEach(() => {
  vi.resetAllMocks();
  state.permissions = new Set(['payroll.view', 'companies.read']);
  state.companyId = null;
  state.get.mockResolvedValue(fixture);
  state.page.mockResolvedValue({
    data: [
      { id: 'company', name: 'Example Company' },
      { id: 'other', name: 'Other Company' },
    ],
    total: 2,
  });
  window.matchMedia = vi.fn().mockReturnValue({ matches: false });
});
async function choose() {
  await screen.findByRole('option', { name: 'Example Company' });
  await userEvent.selectOptions(screen.getByLabelText('Company'), 'company');
  fireEvent.change(screen.getByRole('spinbutton', { name: /Year/ }), { target: { value: '2026' } });
  await userEvent.selectOptions(screen.getByLabelText('From month'), '1');
  await userEvent.selectOptions(screen.getByLabelText('To month'), '3');
}
async function generate() {
  await userEvent.click(screen.getByRole('button', { name: 'Generate report' }));
  await screen.findByRole('region', { name: 'Complete exposure totals' });
}
function capture(name: string) {
  const dir = process.env.ITEMBA_PAYROLL_VISUAL_DIR;
  if (!dir) return;
  mkdirSync(dir, { recursive: true });
  const clone = document.body.cloneNode(true) as HTMLElement;
  document.querySelectorAll('select').forEach((s, i) => {
    Array.from(clone.querySelectorAll('select')[i].options).forEach((o) => {
      if (o.value === s.value) o.setAttribute('selected', '');
      else o.removeAttribute('selected');
    });
  });
  writeFileSync(join(dir, name + '.html'), clone.innerHTML);
}
describe('WCF exposure workspace', () => {
  it('gates read and directory permissions while supporting the assigned company', async () => {
    state.permissions.clear();
    const denied = render(<WcfExposureWorkspace />);
    expect(screen.getByText('Your role cannot view WCF exposure.')).toBeInTheDocument();
    expect(state.get).not.toHaveBeenCalled();
    expect(state.page).not.toHaveBeenCalled();
    denied.unmount();
    state.permissions.add('payroll.view');
    state.companyId = 'assigned';
    render(<WcfExposureWorkspace />);
    await generate();
    expect(state.page).not.toHaveBeenCalled();
    expect(state.get).toHaveBeenCalledWith(
      '/hr/wcf-audit/exposure',
      expect.objectContaining({ query: expect.objectContaining({ companyId: 'assigned' }) }),
    );
  });
  it('preserves branch, monthly and company totals, distinct employee counts and absent months', async () => {
    render(<WcfExposureWorkspace />);
    await choose();
    await generate();
    expect(state.get).toHaveBeenLastCalledWith(
      '/hr/wcf-audit/exposure',
      expect.objectContaining({
        query: { companyId: 'company', year: '2026', fromMonth: '1', toMonth: '3' },
      }),
    );
    const totals = screen.getByRole('region', { name: 'Complete exposure totals' });
    expect(totals).toHaveTextContent('TZS 6,000,000.00');
    expect(totals).toHaveTextContent('TZS 30,000.00');
    expect(totals).toHaveTextContent('0.50%');
    await userEvent.click(screen.getByRole('button', { name: 'Inspect Central branch' }));
    const details = screen.getByRole('complementary', { name: 'Record details' });
    expect(details).toHaveTextContent('Example region');
    expect(details).toHaveTextContent('Distinct employees in period2');
    expect(details).toHaveTextContent('FebruaryNo recorded lines.');
    expect(details).toHaveTextContent(
      'MarchGross payTZS 3,000,000.00W C F'.replace('W C F', 'WCF'),
    );
    capture('wcf-exposure');
    await userEvent.click(screen.getByText('Monthly totals across all branches'));
    const companyMonths = screen
      .getByText('Monthly totals across all branches')
      .closest('details')!;
    expect(companyMonths).toHaveAttribute('open');
    expect(companyMonths).toHaveTextContent(
      'January 2026Gross payTZS 3,000,000.00WCFTZS 15,000.00',
    );
    capture('wcf-exposure-months');
    await userEvent.click(screen.getByRole('button', { name: 'Inspect Unassigned (no branch)' }));
    expect(screen.getByRole('complementary', { name: 'Record details' })).toHaveTextContent(
      'Distinct employees in period1',
    );
  });
  it('validates month order and integer year before reads', async () => {
    render(<WcfExposureWorkspace />);
    await choose();
    await userEvent.selectOptions(screen.getByLabelText('From month'), '4');
    await userEvent.click(screen.getByRole('button', { name: 'Generate report' }));
    expect(screen.getByRole('alert')).toHaveTextContent('From month must be on or before To month');
    expect(state.get).not.toHaveBeenCalled();
    await userEvent.selectOptions(screen.getByLabelText('From month'), '1');
    fireEvent.change(screen.getByRole('spinbutton', { name: /Year/ }), {
      target: { value: '2026.5' },
    });
    fireEvent.submit(screen.getByRole('button', { name: 'Generate report' }).closest('form')!);
    expect(screen.getByRole('alert')).toHaveTextContent('Enter a year from 2000 to 2100');
    expect(state.get).not.toHaveBeenCalled();
  });
  it('retains all branches with local pagination and whole-period totals', async () => {
    state.get.mockResolvedValue({
      ...fixture,
      branches: Array.from({ length: 21 }, (_, i) => ({
        ...fixture.branches[0],
        branchId: `branch-${i}`,
        branchName: `Branch ${i + 1}`,
      })),
    });
    render(<WcfExposureWorkspace />);
    await choose();
    await generate();
    expect(screen.queryByRole('button', { name: 'Inspect Branch 21' })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Next' }));
    expect(screen.getByRole('button', { name: 'Inspect Branch 21' })).toBeInTheDocument();
    expect(state.get).toHaveBeenCalledTimes(1);
    await userEvent.selectOptions(screen.getByLabelText('Company'), 'other');
    expect(
      screen.queryByRole('region', { name: 'Complete exposure totals' }),
    ).not.toBeInTheDocument();
    await generate();
    expect(screen.getByText('Page 1 of 2')).toBeInTheDocument();
  });
  it('retries the same query and renders a true empty result', async () => {
    state.get.mockRejectedValueOnce(new Error('Service unavailable')).mockResolvedValueOnce({
      ...fixture,
      branches: [],
      summary: { branchCount: 0, totalGross: 0, totalWcf: 0, effectiveRate: 0 },
    });
    render(<WcfExposureWorkspace />);
    await choose();
    await userEvent.click(screen.getByRole('button', { name: 'Generate report' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Service unavailable');
    await userEvent.click(screen.getByRole('button', { name: 'Try again' }));
    await screen.findByText('No WCF contributions recorded in this period.');
    expect(state.get.mock.calls[0][1].query).toEqual(state.get.mock.calls[1][1].query);
    expect(screen.queryByText('Monthly totals across all branches')).not.toBeInTheDocument();
  });
  it('aborts an obsolete company read and never renders its late result', async () => {
    let finish!: (v: WcfExposure) => void;
    state.get.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    render(<WcfExposureWorkspace />);
    await choose();
    await userEvent.click(screen.getByRole('button', { name: 'Generate report' }));
    const signal = state.get.mock.calls[0][1].signal as AbortSignal;
    await userEvent.selectOptions(screen.getByLabelText('Company'), 'other');
    expect(signal.aborted).toBe(true);
    await act(async () => finish(fixture));
    expect(
      screen.queryByRole('region', { name: 'Generated exposure report' }),
    ).not.toBeInTheDocument();
  });
  it('retries company choices and loads all pages', async () => {
    state.page
      .mockRejectedValueOnce(new Error('Directory unavailable'))
      .mockResolvedValueOnce({ data: [{ id: 'company', name: 'Example Company' }], total: 2 })
      .mockResolvedValueOnce({ data: [{ id: 'other', name: 'Other Company' }], total: 2 });
    render(<WcfExposureWorkspace />);
    await userEvent.click(await screen.findByRole('button', { name: 'Retry companies' }));
    await screen.findByRole('option', { name: 'Other Company' });
    expect(within(screen.getByLabelText('Company')).getAllByRole('option')).toHaveLength(3);
  });
});
