import { act, fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { StatutoryReturnWorkspace } from './statutory-return-workspace';
import type { ReturnKind, StatutoryReturn } from './statutory-return-types';
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
function fixture(kind: ReturnKind): StatutoryReturn {
  const fields = {
    paye: { taxableIncome: 1000000, payeAmount: 0, tin: 'TIN-EXAMPLE', nidaNumber: 'NIDA-EXAMPLE' },
    nssf: {
      pensionableSalary: 1000000,
      employeeContribution: 70000,
      employerContribution: 130000,
      totalContribution: 200000,
      memberNumber: 'NSSF-EXAMPLE',
    },
    psssf: {
      pensionableSalary: 1000000,
      employeeContribution: 50000,
      employerContribution: 150000,
      totalContribution: 200000,
      memberNumber: 'PSSSF-EXAMPLE',
    },
    wcf: { gross: 1000000, wcfAmount: 5000, rate: 0.005, wcfNumber: 'WCF-EXAMPLE' },
    sdl: { gross: 1000000, sdlAmount: 0 },
    nhif: { employeeContribution: 30000, employerContribution: 30000, nhifNumber: null },
    heslb: { basicSalary: 1000000, deduction: 150000, heslbNumber: 'HESLB-EXAMPLE' },
  };
  const summaries: Record<ReturnKind, StatutoryReturn['summary']> = {
    paye: { employees: 21, totalTaxable: 21000000, totalPaye: 0 },
    nssf: {
      employees: 21,
      totalPensionable: 21000000,
      totalEmployee: 1470000,
      totalEmployer: 2730000,
      totalContribution: 4200000,
    },
    psssf: {
      employees: 21,
      totalPensionable: 21000000,
      totalEmployee: 1050000,
      totalEmployer: 3150000,
      totalContribution: 4200000,
    },
    wcf: { employees: 21, totalGross: 21000000, totalWcf: 105000 },
    sdl: { employees: 21, totalGross: 21000000, totalSdl: 0, thresholdMet: true },
    nhif: {
      employees: 21,
      totalEmployee: 630000,
      totalEmployer: 630000,
      totalContribution: 1260000,
      membersWithoutNumber: 21,
    },
    heslb: {
      employees: 21,
      totalBasic: 21000000,
      totalDeduction: 3150000,
      membersWithoutNumber: 0,
    },
  };
  return {
    header: {
      companyId: 'company',
      companyName: 'Example Company',
      companyTin: 'EMPLOYER-TIN',
      periodLabel: 'September 2026',
      taxType: kind.toUpperCase(),
    },
    formCode: `${kind.toUpperCase()}-EXAMPLE`,
    formName: `${kind.toUpperCase()} monthly return`,
    summary: summaries[kind],
    rows: Array.from({ length: 21 }, (_, i) => ({
      employeeId: `employee-${i}`,
      employeeCode: `EXAMPLE-${i + 1}`,
      fullName: i === 0 ? 'Alex Example' : `Example Person ${i + 1}`,
      ...fields[kind],
    })),
    file: {
      filename: `${kind}-example.csv`,
      mimeType: 'text/csv',
      rowCount: kind === 'sdl' ? 1 : 21,
      content: `Employee,Amount\r\n"Alex Example",0\r\nTOTAL,4200000\r\n${kind}`,
    },
  };
}
beforeEach(() => {
  vi.resetAllMocks();
  state.companyId = null;
  state.permissions = new Set(['payroll.view', 'companies.read']);
  state.get.mockImplementation(async (path: string) =>
    fixture(path.split('/').pop() as ReturnKind),
  );
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
  await userEvent.selectOptions(screen.getByLabelText('Month'), '9');
}
async function generate() {
  await userEvent.click(screen.getByRole('button', { name: 'Generate return' }));
  await screen.findByRole('region', { name: 'Complete return totals' });
}
function capture(name: string) {
  const dir = process.env.ITEMBA_PAYROLL_VISUAL_DIR;
  if (dir) {
    mkdirSync(dir, { recursive: true });
    const clone = document.body.cloneNode(true) as HTMLElement;
    document.querySelectorAll('select').forEach((select, index) => {
      Array.from(clone.querySelectorAll('select')[index].options).forEach((option) => {
        if (option.value === select.value) option.setAttribute('selected', '');
        else option.removeAttribute('selected');
      });
    });
    writeFileSync(join(dir, name + '.html'), clone.innerHTML);
  }
}
describe('Statutory return workspace', () => {
  it('gates reads and supports the assigned company without requesting company-directory permission', async () => {
    state.permissions.clear();
    const denied = render(<StatutoryReturnWorkspace />);
    expect(screen.getByText('Your role cannot view statutory returns.')).toBeInTheDocument();
    expect(state.get).not.toHaveBeenCalled();
    expect(state.page).not.toHaveBeenCalled();
    denied.unmount();
    state.permissions.add('payroll.view');
    state.companyId = 'assigned';
    render(<StatutoryReturnWorkspace />);
    await generate();
    expect(screen.queryByLabelText('Company')).not.toBeInTheDocument();
    expect(state.page).not.toHaveBeenCalled();
    expect(state.get).toHaveBeenCalledWith(
      '/hr/statutory-returns/paye',
      expect.objectContaining({ query: expect.objectContaining({ companyId: 'assigned' }) }),
    );
  });
  it('does not generate without a usable company and explains restricted company selection', () => {
    state.permissions.delete('companies.read');
    render(<StatutoryReturnWorkspace />);
    expect(screen.getByRole('button', { name: 'Generate return' })).toBeDisabled();
    expect(screen.getByText(/Your account needs an assigned company/)).toBeInTheDocument();
    expect(state.get).not.toHaveBeenCalled();
  });
  it.each([
    ['paye', 'TIN-EXAMPLE'],
    ['nssf', 'NSSF-EXAMPLE'],
    ['psssf', 'PSSSF-EXAMPLE'],
    ['wcf', '0.50%'],
    ['sdl', 'TZS 0.00'],
    ['nhif', 'Not recorded'],
    ['heslb', 'HESLB-EXAMPLE'],
  ] as const)(
    'preserves %s amounts and identity details without hard-coded contribution-rate labels',
    async (kind, detail) => {
      render(<StatutoryReturnWorkspace />);
      await choose();
      await userEvent.click(screen.getByRole('button', { name: kind.toUpperCase(), exact: true }));
      await generate();
      expect(state.get).toHaveBeenLastCalledWith(
        `/hr/statutory-returns/${kind}`,
        expect.objectContaining({ query: { companyId: 'company', year: '2026', month: '9' } }),
      );
      await userEvent.click(screen.getByRole('button', { name: 'Inspect Alex Example' }));
      expect(screen.getByRole('complementary', { name: 'Record details' })).toHaveTextContent(
        detail,
      );
      expect(screen.queryByText(/Employee 10%|Employer 10%|15% deduction/)).not.toBeInTheDocument();
      capture(`statutory-${kind}`);
    },
  );
  it('paginates all returned rows while retaining whole-return totals and clears results when filters change', async () => {
    render(<StatutoryReturnWorkspace />);
    await choose();
    await generate();
    const totals = screen.getByRole('region', { name: 'Complete return totals' });
    expect(totals).toHaveTextContent('TZS 21,000,000.00');
    expect(totals).toHaveTextContent('21');
    expect(
      screen.queryByRole('button', { name: 'Inspect Example Person 21' }),
    ).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Next' }));
    expect(screen.getByRole('button', { name: 'Inspect Example Person 21' })).toBeInTheDocument();
    expect(state.get).toHaveBeenCalledTimes(1);
    await userEvent.selectOptions(screen.getByLabelText('Month'), '8');
    expect(screen.queryByRole('button', { name: /Download CSV/ })).not.toBeInTheDocument();
    expect(
      screen.queryByRole('region', { name: 'Complete return totals' }),
    ).not.toBeInTheDocument();
    await generate();
    expect(screen.getByText('Page 1 of 2')).toBeInTheDocument();
  });
  it('downloads the exact complete current CSV and restores the action after a failed download', async () => {
    const objectUrl = vi.fn().mockReturnValue('blob:synthetic');
    const revoke = vi.fn();
    vi.stubGlobal(
      'URL',
      Object.assign(URL, { createObjectURL: objectUrl, revokeObjectURL: revoke }),
    );
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    render(<StatutoryReturnWorkspace />);
    await choose();
    await generate();
    await userEvent.click(screen.getByRole('button', { name: 'Next' }));
    await userEvent.click(screen.getByRole('button', { name: 'Download CSV (21 rows)' }));
    const blob = objectUrl.mock.calls[0][0] as Blob;
    const content = await new Promise<string>((resolve) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result));
      reader.readAsText(blob);
    });
    expect(content).toBe(fixture('paye').file.content);
    expect(click.mock.instances[0]).toHaveAttribute('download', 'paye-example.csv');
    expect(revoke).toHaveBeenCalledWith('blob:synthetic');
    expect(document.querySelector('a[download]')).toBeNull();
    objectUrl.mockImplementationOnce(() => {
      throw new Error('Download unavailable');
    });
    await userEvent.click(screen.getByRole('button', { name: 'Download CSV (21 rows)' }));
    expect(screen.getByRole('alert')).toHaveTextContent('CSV could not be downloaded');
    await userEvent.click(screen.getByRole('button', { name: 'Download CSV (21 rows)' }));
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    click.mockRestore();
  });
  it('retries failures with the same company/period and never offers an old CSV during loading or failure', async () => {
    state.get.mockRejectedValueOnce(new Error('Service unavailable'));
    render(<StatutoryReturnWorkspace />);
    await choose();
    await userEvent.click(screen.getByRole('button', { name: 'Generate return' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Service unavailable');
    expect(screen.queryByRole('button', { name: /Download CSV/ })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Try again' }));
    await screen.findByRole('region', { name: 'Complete return totals' });
    expect(state.get.mock.calls[0][1].query).toEqual(state.get.mock.calls[1][1].query);
  });
  it('cancels a pending return when its type changes and ignores its late result', async () => {
    let finish!: (result: StatutoryReturn) => void;
    state.get.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    render(<StatutoryReturnWorkspace />);
    await choose();
    await userEvent.click(screen.getByRole('button', { name: 'Generate return' }));
    const signal = state.get.mock.calls[0][1].signal as AbortSignal;
    await userEvent.click(screen.getByRole('button', { name: 'NSSF', exact: true }));
    expect(signal.aborted).toBe(true);
    await act(async () => finish(fixture('paye')));
    expect(screen.queryByText('PAYE monthly return')).not.toBeInTheDocument();
    await generate();
    expect(screen.getByText('NSSF monthly return')).toBeInTheDocument();
  });
  it('retries and loads every company-choice page', async () => {
    state.page.mockRejectedValueOnce(new Error('Directory unavailable'));
    state.page.mockResolvedValueOnce({
      data: [{ id: 'company', name: 'Example Company' }],
      total: 2,
    });
    state.page.mockResolvedValueOnce({ data: [{ id: 'other', name: 'Other Company' }], total: 2 });
    render(<StatutoryReturnWorkspace />);
    await userEvent.click(await screen.findByRole('button', { name: 'Retry companies' }));
    await screen.findByRole('option', { name: 'Other Company' });
    expect(within(screen.getByLabelText('Company')).getAllByRole('option')).toHaveLength(3);
  });
  it('rejects invalid years and makes an empty return explicit while retaining its downloadable file', async () => {
    render(<StatutoryReturnWorkspace />);
    await choose();
    fireEvent.change(screen.getByRole('spinbutton', { name: /Year/ }), {
      target: { value: '1999' },
    });
    fireEvent.submit(screen.getByRole('button', { name: 'Generate return' }).closest('form')!);
    expect(screen.getByRole('alert')).toHaveTextContent('Enter a year from 2000 to 2100');
    expect(state.get).not.toHaveBeenCalled();
    fireEvent.change(screen.getByRole('spinbutton', { name: /Year/ }), {
      target: { value: '2026' },
    });
    state.get.mockResolvedValueOnce({
      ...fixture('paye'),
      rows: [],
      summary: { employees: 0, totalPaye: 0 },
      file: { ...fixture('paye').file, rowCount: 0 },
    });
    await generate();
    expect(screen.getByText('No PAYE records in this return.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Download CSV (0 rows)' })).toBeEnabled();
  });
});
