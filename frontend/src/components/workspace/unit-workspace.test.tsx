import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { UnitWorkspace } from './unit-workspace';
import { UnitEditor, ConversionEditor } from './unit-editors';
import { UnsavedWorkProvider } from './unsaved-work-provider';
import { InventoryWorkspaceProvider } from '@/features/inventory/inventory-workspace-context';
import type { Unit, UnitConversion } from './unit-types';
import InventoryWorkspace from '@/features/inventory/inventory-workspace';
const state = vi.hoisted(() => ({
  permissions: new Set<string>(),
  get: vi.fn(),
  page: vi.fn(),
  post: vi.fn(),
  patch: vi.fn(),
  remove: vi.fn(),
  download: vi.fn(),
  pdf: vi.fn(),
  replace: vi.fn(),
  params: new URLSearchParams('tab=catalog&view=units&companyId=company'),
}));
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: state.replace }),
  usePathname: () => '/inventory',
  useSearchParams: () => state.params,
}));
vi.mock('next/dynamic', () => ({
  default: () =>
    function EmbeddedUnits() {
      return <UnitWorkspace />;
    },
}));
vi.mock('@/features/inventory/inventory-search', () => ({
  default: ({ onQueryChange }: { onQueryChange: (q: string) => void }) => (
    <button onClick={() => onQueryChange('')}>Repeat inventory search</button>
  ),
}));
vi.mock('@/features/inventory/inventory-scope', () => ({
  InventoryScope: ({
    onChange,
  }: {
    onChange: (scope: { companyId: string; divisionId: string; branchId: string }) => void;
  }) => (
    <button onClick={() => onChange({ companyId: 'other', divisionId: '', branchId: '' })}>
      Switch inventory company
    </button>
  ),
}));
vi.mock('@/hooks/use-auth', () => ({
  useAuth: () => ({
    user: { companyId: 'company' },
    loading: false,
    hasPermission: (p: string) => state.permissions.has(p),
  }),
}));
vi.mock('@/lib/api-client', () => ({
  backendGet: state.get,
  backendPage: state.page,
  backendPost: state.post,
  backendPatch: state.patch,
  backendDelete: state.remove,
}));
vi.mock('@/lib/report-export', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/report-export')>()),
  downloadTextFile: state.download,
}));
vi.mock('@/lib/export-download', () => ({ downloadTablePdf: state.pdf, TABLE_PDF_MAX_ROWS: 5000 }));
const kg: Unit = {
  id: 'kg',
  name: 'Kilogram',
  symbol: 'kg',
  unitType: 'WEIGHT',
  isBaseUnit: true,
  isSystemUnit: true,
  status: 'ACTIVE',
  companyId: null,
};
const bag: Unit = {
  ...kg,
  id: 'bag',
  name: 'Cement bag',
  symbol: 'bag',
  isBaseUnit: false,
  isSystemUnit: false,
  unitType: 'PACKAGE',
  companyId: 'company',
};
const conversion: UnitConversion = {
  id: 'conv',
  companyId: 'company',
  fromUnitId: 'bag',
  toUnitId: 'kg',
  conversionFactor: '50.000000',
  description: 'Standard cement bag; verify the supplier’s pack size.',
  isActive: true,
  fromUnit: bag,
  toUnit: kg,
};
const mount = (children: React.ReactNode = <UnitWorkspace />) =>
  render(<UnsavedWorkProvider>{children}</UnsavedWorkProvider>);
const ready = () => screen.findByRole('button', { name: 'Inspect Cement bag' });
function capture(name: string) {
  const dir = process.env.ITEMBA_PAYROLL_VISUAL_DIR;
  if (!dir) return;
  mkdirSync(dir, { recursive: true });
  const clone = document.body.cloneNode(true) as HTMLElement;
  document.querySelectorAll('select').forEach((s, i) =>
    Array.from(clone.querySelectorAll('select')[i].options).forEach((o) => {
      if (o.value === s.value) o.setAttribute('selected', '');
      else o.removeAttribute('selected');
    }),
  );
  writeFileSync(join(dir, name + '.html'), clone.innerHTML);
}
beforeEach(() => {
  vi.resetAllMocks();
  state.params = new URLSearchParams('tab=catalog&view=units&companyId=company');
  state.permissions = new Set(['units.view', 'units.manage', 'companies.read']);
  state.get.mockImplementation(async (path: string) => ({
    data: path === '/units' ? [bag, kg] : [conversion],
    total: 41,
  }));
  state.page.mockImplementation(async (path: string) => ({
    data:
      path === '/companies'
        ? [
            { id: 'company', name: 'Example Company' },
            { id: 'other', name: 'Other Company' },
          ]
        : path === '/units'
          ? [bag, kg]
          : [conversion],
    total: path === '/unit-conversions' ? 1 : 2,
  }));
  state.post.mockResolvedValue({});
  state.patch.mockResolvedValue({});
  state.remove.mockResolvedValue({});
  state.pdf.mockResolvedValue(undefined);
  window.matchMedia = vi.fn().mockReturnValue({ matches: false });
  HTMLDialogElement.prototype.showModal = function () {
    this.setAttribute('open', '');
  };
  HTMLDialogElement.prototype.close = function () {
    this.removeAttribute('open');
  };
});
describe('Unit register', () => {
  it('does not silently truncate a PDF above the service limit', async () => {
    mount();
    await ready();
    state.page.mockResolvedValue({
      data: Array.from({ length: 5001 }, (_, i) => ({ ...bag, id: String(i) })),
      total: 5001,
    });
    await userEvent.click(screen.getByRole('button', { name: 'Export PDF' }));
    await screen.findByText(/use CSV for all 5,001 records/);
    expect(state.pdf).not.toHaveBeenCalled();
  });
  it('requires read permission and separates management and company directory access', async () => {
    state.permissions.clear();
    const view = mount();
    expect(screen.getByText('Your role cannot view units and conversions.')).toBeInTheDocument();
    expect(state.get).not.toHaveBeenCalled();
    expect(state.page).not.toHaveBeenCalled();
    view.unmount();
    state.permissions.add('units.view');
    mount();
    await ready();
    expect(screen.queryByRole('button', { name: 'New unit' })).not.toBeInTheDocument();
    expect(state.page).not.toHaveBeenCalled();
    await userEvent.click(await ready());
    expect(screen.queryByRole('button', { name: 'Edit unit' })).not.toBeInTheDocument();
  });
  it('preserves unit and conversion detail, protects system units and exports synthetic visuals', async () => {
    state.get.mockImplementation(async (path: string) => ({
      data: path === '/units' ? [bag, kg] : [conversion],
      total: path === '/units' ? 2 : 1,
    }));
    mount();
    await ready();
    await userEvent.click(screen.getByRole('button', { name: 'Inspect Kilogram' }));
    expect(screen.getByText('System units are read-only.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Delete unit' })).not.toBeInTheDocument();
    await userEvent.click(await ready());
    expect(
      within(screen.getByRole('complementary', { name: 'Record details' })).getByText('Package', {
        exact: true,
      }),
    ).toBeInTheDocument();
    capture('units-register');
    await userEvent.click(screen.getByRole('button', { name: 'Conversions', exact: true }));
    await userEvent.click(
      await screen.findByRole('button', { name: 'Inspect Cement bag to Kilogram' }),
    );
    expect(screen.getAllByText('1 bag = 50.000000 kg').length).toBeGreaterThan(0);
    expect(screen.getByText(conversion.description!)).toBeInTheDocument();
    capture('units-conversions');
    await userEvent.click(screen.getByRole('button', { name: 'Edit conversion', exact: true }));
    capture('units-conversion-editor');
  });
  it('applies complete choice paging, combined filters, search and server pagination', async () => {
    state.page.mockImplementation(async (path: string, options: { query: { page: number } }) => ({
      data:
        path === '/companies'
          ? options.query.page === 1
            ? [{ id: 'company', name: 'Example Company' }]
            : [{ id: 'other', name: 'Other Company' }]
          : [bag, kg],
      total: 2,
    }));
    mount();
    await ready();
    await userEvent.click(screen.getByRole('button', { name: /^Filters/ }));
    await screen.findByRole('option', { name: 'Other Company' });
    await userEvent.selectOptions(
      screen.getByRole('combobox', { name: 'Company filter' }),
      'other',
    );
    await userEvent.selectOptions(
      screen.getByRole('combobox', { name: 'Status filter' }),
      'INACTIVE',
    );
    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Type filter' }), 'WEIGHT');
    fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'gram' } });
    await waitFor(() =>
      expect(state.get).toHaveBeenLastCalledWith(
        '/units',
        expect.objectContaining({
          query: {
            companyId: 'other',
            status: 'INACTIVE',
            unitType: 'WEIGHT',
            search: 'gram',
            page: 1,
            limit: 20,
          },
        }),
      ),
    );
    await ready();
    await userEvent.click(screen.getByRole('button', { name: 'Next', exact: true }));
    await waitFor(() =>
      expect(state.get).toHaveBeenLastCalledWith(
        '/units',
        expect.objectContaining({ query: expect.objectContaining({ page: 2 }) }),
      ),
    );
    await userEvent.click(screen.getByRole('button', { name: 'Conversions', exact: true }));
    await waitFor(() =>
      expect(state.get).toHaveBeenLastCalledWith(
        '/unit-conversions',
        expect.objectContaining({
          query: { companyId: 'other', status: 'INACTIVE', search: 'gram', page: 1, limit: 20 },
        }),
      ),
    );
  });
  it('discards obsolete reads and retries failure without showing old records', async () => {
    let resolve!: (v: unknown) => void;
    let signal!: AbortSignal;
    state.get.mockImplementationOnce((_p: string, o: { signal: AbortSignal }) => {
      signal = o.signal;
      return new Promise((r) => {
        resolve = r;
      });
    });
    mount();
    await userEvent.click(screen.getByRole('button', { name: 'Conversions', exact: true }));
    await screen.findByRole('button', { name: 'Inspect Cement bag to Kilogram' });
    expect(signal.aborted).toBe(true);
    await act(async () => resolve({ data: [bag], total: 1 }));
    expect(
      screen.queryByRole('button', { name: 'Inspect Cement bag', exact: true }),
    ).not.toBeInTheDocument();
    state.get.mockRejectedValueOnce(new Error('Service unavailable'));
    await userEvent.click(screen.getByRole('button', { name: 'Refresh', exact: true }));
    await screen.findByText('Service unavailable');
    expect(
      screen.queryByRole('button', { name: 'Inspect Cement bag to Kilogram' }),
    ).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Try again' }));
    await screen.findByRole('button', { name: 'Inspect Cement bag to Kilogram' });
  });
  it('exports every matching page, preserves factor precision and exposes PDF failure', async () => {
    mount();
    await ready();
    state.page.mockImplementation(async (path: string, o: { query: { page: number } }) => ({
      data: path === '/units' ? [o.query.page === 1 ? bag : kg] : [conversion],
      total: path === '/units' ? 2 : 1,
    }));
    await userEvent.click(screen.getByRole('button', { name: 'Export CSV' }));
    await waitFor(() =>
      expect(state.download).toHaveBeenCalledWith(
        'units.csv',
        'text/csv',
        expect.stringContaining('Kilogram'),
      ),
    );
    expect(state.download.mock.calls[0][2]).toContain('Cement bag');
    expect(state.download.mock.calls[0][2]).toContain('System');
    await userEvent.click(screen.getByRole('button', { name: 'Conversions', exact: true }));
    await screen.findByRole('button', { name: 'Inspect Cement bag to Kilogram' });
    state.pdf.mockRejectedValueOnce(new Error('PDF unavailable'));
    await userEvent.click(screen.getByRole('button', { name: 'Export PDF' }));
    await screen.findByText(/PDF unavailable/);
    await userEvent.click(screen.getByRole('button', { name: 'Export PDF' }));
    await waitFor(() => expect(state.pdf).toHaveBeenCalledTimes(2));
    expect(state.pdf.mock.calls[1][0].rows[0][2]).toBe('50.000000');
  });
  it('uses embedded inventory company and search without a second scope picker', async () => {
    mount(
      <InventoryWorkspaceProvider
        scope={{ companyId: 'company', divisionId: '', branchId: '' }}
        searchQuery="bag"
      >
        <UnitWorkspace />
      </InventoryWorkspaceProvider>,
    );
    await ready();
    expect(state.get).toHaveBeenCalledWith(
      '/units',
      expect.objectContaining({
        query: expect.objectContaining({ companyId: 'company', search: 'bag' }),
      }),
    );
    await userEvent.click(screen.getByRole('button', { name: /^Filters/ }));
    expect(screen.queryByRole('combobox', { name: 'Company filter' })).not.toBeInTheDocument();
  });
  it('retains a failed named deletion and retries the same record', async () => {
    mount();
    await userEvent.click(await ready());
    await userEvent.click(screen.getByRole('button', { name: 'Delete unit', exact: true }));
    const dialog = screen.getByRole('dialog', { name: 'Delete unit' });
    expect(within(dialog).getByText('Cement bag (bag)')).toBeInTheDocument();
    state.remove.mockRejectedValueOnce(new Error('Unit is in use'));
    await userEvent.click(within(dialog).getByRole('button', { name: 'Delete unit' }));
    expect(await within(dialog).findByRole('alert')).toHaveTextContent('Unit is in use');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Delete unit' }));
    await screen.findByText('Unit deleted.');
    expect(state.remove).toHaveBeenNthCalledWith(2, '/units/bag');
  });
});
describe('Measurement editors', () => {
  it('creates a company unit with its full measurement settings', async () => {
    const saved = vi.fn();
    mount(<UnitEditor companyId="company" onClose={vi.fn()} onSaved={saved} />);
    fireEvent.change(screen.getByRole('textbox', { name: /Name/ }), {
      target: { value: '  Crate  ' },
    });
    fireEvent.change(screen.getByRole('textbox', { name: /Symbol/ }), {
      target: { value: ' crt ' },
    });
    await userEvent.selectOptions(screen.getByRole('combobox', { name: /Unit type/ }), 'PACKAGE');
    await userEvent.click(
      screen.getByRole('checkbox', { name: 'Base unit for this type and scope' }),
    );
    await userEvent.click(screen.getByRole('button', { name: 'Create unit' }));
    await waitFor(() => expect(saved).toHaveBeenCalled());
    expect(state.post).toHaveBeenCalledWith('/units', {
      companyId: 'company',
      name: 'Crate',
      symbol: 'crt',
      unitType: 'PACKAGE',
      isBaseUnit: true,
      status: 'ACTIVE',
    });
  });
  it('guards the actual Inventory scope handler before it remounts the active view', async () => {
    state.permissions.add('products.view');
    state.replace.mockImplementation((href: string) => {
      state.params = new URL(href, 'http://localhost').searchParams;
    });
    const view = mount(<InventoryWorkspace />);
    await ready();
    await userEvent.click(screen.getByRole('button', { name: 'New unit', exact: true }));
    await screen.findByRole('dialog', { name: 'New unit' });
    fireEvent.change(screen.getByRole('textbox', { name: /Name/ }), {
      target: { value: 'Unsaved unit' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Switch inventory company' }));
    await userEvent.click(await screen.findByRole('button', { name: 'Stay here' }));
    expect(state.replace).not.toHaveBeenCalled();
    expect(screen.getByRole('textbox', { name: /Name/ })).toHaveValue('Unsaved unit');
    fireEvent.click(screen.getByRole('button', { name: 'Switch inventory company' }));
    await userEvent.click(await screen.findByRole('button', { name: 'Discard changes' }));
    expect(state.replace).toHaveBeenCalledWith(expect.stringContaining('companyId=other'), {
      scroll: false,
    });
    view.rerender(
      <UnsavedWorkProvider>
        <InventoryWorkspace />
      </UnsavedWorkProvider>,
    );
    await waitFor(() =>
      expect(screen.queryByRole('dialog', { name: 'New unit' })).not.toBeInTheDocument(),
    );
    await userEvent.click(screen.getByRole('button', { name: 'Find a product' }));
    fireEvent.click(screen.getByRole('button', { name: 'Repeat inventory search' }));
    expect(state.replace).toHaveBeenCalledTimes(1);
  });
  it('retains an open draft when the enclosing inventory scope changes', async () => {
    const content = (companyId: string) => (
      <UnsavedWorkProvider>
        <InventoryWorkspaceProvider
          scope={{ companyId, divisionId: '', branchId: '' }}
          searchQuery=""
        >
          <UnitWorkspace />
        </InventoryWorkspaceProvider>
      </UnsavedWorkProvider>
    );
    const view = render(content('company'));
    await ready();
    await userEvent.click(screen.getByRole('button', { name: 'New unit', exact: true }));
    await screen.findByRole('dialog', { name: 'New unit' });
    fireEvent.change(screen.getByRole('textbox', { name: /Name/ }), {
      target: { value: 'Draft quantity' },
    });
    view.rerender(content('other'));
    expect(screen.getByRole('textbox', { name: /Name/ })).toHaveValue('Draft quantity');
    expect(screen.getByRole('combobox', { name: 'Company scope' })).toHaveValue('company');
    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    await userEvent.click(await screen.findByRole('button', { name: 'Discard changes' }));
    expect(screen.queryByRole('dialog', { name: 'New unit' })).not.toBeInTheDocument();
  });
  it('does not offer partial conversion choices when a later page fails, and can retry', async () => {
    state.page.mockImplementation(async (path: string, options: { query: { page: number } }) => {
      if (path === '/companies')
        return { data: [{ id: 'company', name: 'Example Company' }], total: 1 };
      if (options.query.page === 2) throw new Error('Second page unavailable');
      return { data: [bag], total: 2 };
    });
    mount(<ConversionEditor companyId="company" onClose={vi.fn()} onSaved={vi.fn()} />);
    await screen.findByText(/Second page unavailable/);
    expect(screen.queryByRole('option', { name: 'Cement bag (bag)' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Create conversion' })).toBeDisabled();
    state.page.mockResolvedValue({ data: [bag, kg], total: 2 });
    await userEvent.click(screen.getByRole('button', { name: 'Retry unit choices' }));
    await waitFor(() =>
      expect(screen.getAllByRole('option', { name: 'Kilogram (kg)' })).toHaveLength(2),
    );
    expect(screen.getByRole('button', { name: 'Create conversion' })).toBeEnabled();
  });
  it('guards edits, keeps failed input, and sends unit fields without changing scope', async () => {
    const saved = vi.fn(),
      close = vi.fn();
    mount(<UnitEditor record={bag} companyId="other" onClose={close} onSaved={saved} />);
    fireEvent.change(screen.getByRole('textbox', { name: /Name/ }), {
      target: { value: 'Large cement bag' },
    });
    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    await userEvent.click(await screen.findByRole('button', { name: 'Stay here' }));
    expect(screen.getByRole('textbox', { name: /Name/ })).toHaveValue('Large cement bag');
    state.patch.mockRejectedValueOnce(new Error('Save unavailable'));
    await userEvent.click(screen.getByRole('button', { name: 'Save changes' }));
    await screen.findByText('Save unavailable');
    expect(saved).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole('button', { name: 'Save changes' }));
    await waitFor(() => expect(saved).toHaveBeenCalled());
    expect(state.patch).toHaveBeenLastCalledWith('/units/bag', {
      name: 'Large cement bag',
    });
    expect(close).not.toHaveBeenCalled();
  });
  it('keeps existing conversion pairs fixed and can clear a description', async () => {
    const saved = vi.fn();
    mount(<ConversionEditor record={conversion} companyId="" onClose={vi.fn()} onSaved={saved} />);
    expect(screen.getByRole('combobox', { name: /From unit/ })).toBeDisabled();
    expect(screen.getByRole('combobox', { name: /To unit/ })).toBeDisabled();
    expect(state.page).not.toHaveBeenCalled();
    fireEvent.change(screen.getByRole('textbox', { name: 'Description' }), {
      target: { value: '' },
    });
    fireEvent.change(screen.getByRole('spinbutton', { name: /Conversion factor/ }), {
      target: { value: '0.0000001' },
    });
    await userEvent.click(screen.getByRole('button', { name: 'Save changes' }));
    await screen.findByText(/at most six decimal places/);
    expect(state.patch).not.toHaveBeenCalled();
    fireEvent.change(screen.getByRole('spinbutton', { name: /Conversion factor/ }), {
      target: { value: '0.000001' },
    });
    await userEvent.click(screen.getByRole('button', { name: 'Save changes' }));
    await waitFor(() => expect(saved).toHaveBeenCalled());
    expect(state.patch).toHaveBeenCalledWith('/unit-conversions/conv', {
      conversionFactor: 0.000001,
      description: '',
    });
  });
  it('creates conversions with a selected company and fully paged active units', async () => {
    state.page.mockImplementation(async (path: string, o: { query: { page: number } }) => ({
      data:
        path === '/companies'
          ? [{ id: 'company', name: 'Example Company' }]
          : [o.query.page === 1 ? bag : kg],
      total: path === '/companies' ? 1 : 2,
    }));
    const saved = vi.fn();
    mount(<ConversionEditor companyId="company" onClose={vi.fn()} onSaved={saved} />);
    await waitFor(() =>
      expect(screen.getAllByRole('option', { name: 'Kilogram (kg)' })).toHaveLength(2),
    );
    await userEvent.selectOptions(screen.getByRole('combobox', { name: /From unit/ }), 'bag');
    await userEvent.selectOptions(screen.getByRole('combobox', { name: /To unit/ }), 'bag');
    await userEvent.click(screen.getByRole('button', { name: 'Create conversion' }));
    await screen.findByText('Choose two different units.');
    await userEvent.selectOptions(screen.getByRole('combobox', { name: /To unit/ }), 'kg');
    fireEvent.change(screen.getByRole('spinbutton', { name: /Conversion factor/ }), {
      target: { value: '50' },
    });
    expect(screen.getByText('1 bag = 50 kg')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Create conversion' }));
    await waitFor(() => expect(saved).toHaveBeenCalled());
    expect(state.post).toHaveBeenCalledWith('/unit-conversions', {
      fromUnitId: 'bag',
      toUnitId: 'kg',
      companyId: 'company',
      conversionFactor: 50,
      description: '',
      isActive: true,
    });
  });
});
