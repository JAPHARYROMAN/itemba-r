import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { TradingPartnerWorkspace } from './trading-partner-workspace';
import { TradingPartnerEditor } from './trading-partner-editor';
import { UnsavedWorkProvider } from './unsaved-work-provider';
import { type PartnerKind, type TradingPartner } from './trading-partner-types';
const state = vi.hoisted(() => ({
  permissions: new Set<string>(),
  get: vi.fn(),
  page: vi.fn(),
  post: vi.fn(),
  patch: vi.fn(),
  remove: vi.fn(),
}));
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }) }));
vi.mock('@/hooks/use-auth', () => ({
  useAuth: () => ({
    user: { companyId: 'company' },
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
const category = { id: 'category', name: 'Building materials', categoryType: 'HARDWARE' };
const fixture: TradingPartner = {
  id: 'partner',
  name: 'Acacia Trading',
  companyId: 'company',
  company: { name: 'Example Company' },
  divisionId: 'division',
  division: { name: 'Central operations' },
  branchId: 'branch',
  branch: { name: 'Dar es Salaam' },
  customerCode: 'CUS-0042',
  supplierCode: 'SUP-0042',
  customerType: 'COMPANY',
  supplierType: 'GENERAL_SUPPLIER',
  status: 'ACTIVE',
  legalName: 'Acacia Trading Limited',
  phone: '+255 700 000 000',
  email: 'accounts@example.test',
  contactPerson: 'Alex Morgan',
  address: 'Example address',
  tin: '100-200-300',
  vrn: 'VRN-0042',
  creditLimit: 5000000,
  currentBalance: 1250000,
  paymentTerms: 'Net 30',
  notes: 'Contact the accounts team before delivery.',
  productCategories: [{ productCategory: category }],
};
const summary = {
  total: 41,
  active: 32,
  inactive: 4,
  blocked: 5,
  currentBalance: 1250000,
  creditLimit: 5000000,
  openReceivableBalance: 1500000,
  overdueReceivableBalance: 250000,
  openPayableBalance: 1500000,
  overduePayableBalance: 250000,
};
beforeEach(() => {
  vi.resetAllMocks();
  state.permissions = new Set([
    'companies.read',
    'divisions.read',
    'branches.read',
    'product_categories.view',
    ...['customers', 'suppliers'].flatMap((k) =>
      ['view', 'create', 'update', 'delete'].map((p) => `${k}.${p}`),
    ),
  ]);
  state.get.mockImplementation(async (path: string) =>
    path.endsWith('workbench-summary')
      ? summary
      : {
          data: [
            {
              ...fixture,
              ...(path.startsWith('/suppliers')
                ? { customerCode: undefined, customerType: undefined }
                : { supplierCode: undefined, supplierType: undefined }),
            },
          ],
          total: 41,
        },
  );
  state.page.mockImplementation(async (path: string) => ({
    data:
      path === '/companies'
        ? [
            { id: 'company', name: 'Example Company' },
            { id: 'other', name: 'Other Company' },
          ]
        : path === '/divisions'
          ? [{ id: 'division', name: 'Central operations' }]
          : path === '/branches'
            ? [{ id: 'branch', name: 'Dar es Salaam', divisionId: 'division' }]
            : [category],
    total: path === '/companies' ? 2 : 1,
  }));
  state.post.mockResolvedValue({});
  state.patch.mockResolvedValue({});
  state.remove.mockResolvedValue({});
  window.matchMedia = vi.fn().mockReturnValue({ matches: false });
  HTMLDialogElement.prototype.showModal = function () {
    this.setAttribute('open', '');
  };
  HTMLDialogElement.prototype.close = function () {
    this.removeAttribute('open');
  };
});
const mount = (kind: PartnerKind = 'customers') =>
  render(
    <UnsavedWorkProvider>
      <TradingPartnerWorkspace kind={kind} />
    </UnsavedWorkProvider>,
  );
const inspect = () =>
  userEvent.click(screen.getByRole('button', { name: 'Inspect Acacia Trading' }));
async function ready() {
  await screen.findByRole('button', { name: 'Inspect Acacia Trading' });
}
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
describe.each(['customers', 'suppliers'] as const)('%s workspace', (kind) => {
  const label = kind === 'customers' ? 'customer' : 'supplier';
  it('keeps read/create/update/delete and directory permissions separate', async () => {
    state.permissions.clear();
    const view = mount(kind);
    expect(state.get).not.toHaveBeenCalled();
    expect(state.page).not.toHaveBeenCalled();
    expect(screen.getByText(`Your role cannot view ${kind}.`)).toBeInTheDocument();
    view.unmount();
    state.permissions.add(`${kind}.view`);
    state.permissions.add(`${kind}.create`);
    mount(kind);
    await ready();
    await inspect();
    expect(screen.getByRole('button', { name: `New ${label}` })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: `Edit ${label}` })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: `Delete ${label}` })).not.toBeInTheDocument();
    expect(state.page).not.toHaveBeenCalled();
    expect(screen.getByRole('link', { name: 'Open profile' })).toHaveAttribute(
      'href',
      `/operations/${kind}/partner`,
    );
  });
  it('retains details and real summary, paginates and combines scoped filters', async () => {
    const user = userEvent.setup();
    mount(kind);
    await ready();
    await inspect();
    const detail = screen.getByRole('complementary', { name: 'Record details' });
    expect(within(detail).getByText('Net 30')).toBeInTheDocument();
    expect(within(detail).getByText('TIN: 100-200-300', { exact: false })).toBeInTheDocument();
    if (kind === 'suppliers')
      expect(within(detail).getByText('Building materials')).toBeInTheDocument();
    capture(`partner-${kind}`);
    await user.click(screen.getByRole('button', { name: 'Next', exact: true }));
    await waitFor(() =>
      expect(state.get).toHaveBeenCalledWith(
        `/${kind}`,
        expect.objectContaining({ query: expect.objectContaining({ page: 2, limit: 20 }) }),
      ),
    );
    await user.type(screen.getByRole('searchbox'), ' Acacia ');
    await waitFor(() =>
      expect(state.get).toHaveBeenCalledWith(
        `/${kind}`,
        expect.objectContaining({ query: expect.objectContaining({ page: 1, search: 'Acacia' }) }),
      ),
    );
    await user.click(screen.getByRole('button', { name: 'Filters', exact: true }));
    await user.selectOptions(screen.getByRole('combobox', { name: 'Company filter' }), 'company');
    await user.selectOptions(
      await screen.findByRole('combobox', { name: 'Division filter' }),
      'division',
    );
    await user.selectOptions(screen.getByRole('combobox', { name: 'Status filter' }), 'BLOCKED');
    await user.selectOptions(
      screen.getByRole('combobox', {
        name: kind === 'customers' ? 'Branch filter' : 'Category filter',
      }),
      kind === 'customers' ? 'branch' : 'category',
    );
    await waitFor(() =>
      expect(state.get).toHaveBeenCalledWith(
        `/${kind}/workbench-summary`,
        expect.objectContaining({
          query: expect.objectContaining({
            companyId: 'company',
            divisionId: 'division',
            status: 'BLOCKED',
            search: 'Acacia',
            [kind === 'customers' ? 'branchId' : 'productCategoryId']:
              kind === 'customers' ? 'branch' : 'category',
          }),
        }),
      ),
    );
    await user.selectOptions(screen.getByRole('combobox', { name: 'Company filter' }), 'other');
    await waitFor(() =>
      expect(state.get).toHaveBeenCalledWith(
        `/${kind}`,
        expect.objectContaining({
          query: expect.objectContaining({
            companyId: 'other',
            divisionId: '',
            [kind === 'customers' ? 'branchId' : 'productCategoryId']: '',
          }),
        }),
      ),
    );
  });
  it('protects edits, sends changed fields and nullable clears, retains failures for retry', async () => {
    const user = userEvent.setup();
    mount(kind);
    await ready();
    await inspect();
    await user.click(screen.getByRole('button', { name: `Edit ${label}` }));
    await user.clear(screen.getByRole('textbox', { name: 'Phone', exact: true }));
    await user.clear(screen.getByRole('textbox', { name: /^Name/ }));
    await user.type(screen.getByRole('textbox', { name: /^Name/ }), 'Acacia revised');
    capture(`partner-${kind}-editor`);
    await user.click(screen.getByRole('button', { name: 'Cancel', exact: true }));
    await user.click(await screen.findByRole('button', { name: 'Stay here' }));
    expect(screen.getByRole('textbox', { name: /^Name/ })).toHaveValue('Acacia revised');
    state.patch.mockRejectedValueOnce(new Error('Save unavailable'));
    await user.click(screen.getByRole('button', { name: 'Save changes', exact: true }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Save unavailable');
    expect(state.patch).toHaveBeenLastCalledWith(`/${kind}/partner`, {
      name: 'Acacia revised',
      phone: null,
    });
    await user.click(screen.getByRole('button', { name: 'Save changes', exact: true }));
    await waitFor(() =>
      expect(screen.queryByRole('dialog', { name: `Edit ${label}` })).not.toBeInTheDocument(),
    );
  });
  it('creates through the real scope contract and preserves categories or branch', async () => {
    const user = userEvent.setup();
    mount(kind);
    await ready();
    await user.click(screen.getByRole('button', { name: `New ${label}` }));
    await user.selectOptions(
      await screen.findByRole('combobox', { name: /^Division/ }),
      'division',
    );
    if (kind === 'customers')
      await user.selectOptions(
        screen.getByRole('combobox', { name: /^Branch \/ location/ }),
        'branch',
      );
    else await user.click(await screen.findByRole('checkbox', { name: /Building materials/ }));
    await user.type(screen.getByRole('textbox', { name: /^Name/ }), 'New partner');
    await user.click(screen.getByRole('button', { name: `Create ${label}`, exact: true }));
    await waitFor(() =>
      expect(state.post).toHaveBeenCalledWith(
        `/${kind}`,
        expect.objectContaining({
          companyId: 'company',
          divisionId: 'division',
          name: 'New partner',
          creditLimit: 0,
          [kind === 'customers' ? 'branchId' : 'productCategoryIds']:
            kind === 'customers' ? 'branch' : ['category'],
        }),
      ),
    );
  });
});
describe('Partner recovery and actions', () => {
  it('preserves legacy customer scope when editing contact information', async () => {
    const saved = vi.fn();
    render(
      <UnsavedWorkProvider>
        <TradingPartnerEditor
          kind="customers"
          record={{ ...fixture, divisionId: null, branchId: null, division: null, branch: null }}
          onClose={vi.fn()}
          onSaved={saved}
        />
      </UnsavedWorkProvider>,
    );
    await userEvent.type(screen.getByRole('textbox', { name: 'Phone', exact: true }), '9');
    await userEvent.click(screen.getByRole('button', { name: 'Save changes' }));
    await waitFor(() => expect(saved).toHaveBeenCalled());
    expect(state.patch).toHaveBeenCalledWith('/customers/partner', { phone: '+255 700 000 0009' });
  });

  it('aborts old scopes, hides obsolete details, retries failed lists without fake zero summary', async () => {
    mount();
    await ready();
    await inspect();
    let finish!: (v: unknown) => void;
    let signal!: AbortSignal;
    state.get.mockImplementation((path: string, options: { signal: AbortSignal }) =>
      path.endsWith('workbench-summary')
        ? Promise.reject(new Error('Summary unavailable'))
        : new Promise((resolve) => {
            finish = resolve;
            signal = options.signal;
          }),
    );
    fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'new' } });
    await waitFor(() =>
      expect(screen.queryByRole('button', { name: 'Edit customer' })).not.toBeInTheDocument(),
    );
    await waitFor(() => expect(screen.getAllByText('Unavailable').length).toBeGreaterThan(0));
    state.get.mockRejectedValue(new Error('Read unavailable'));
    fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'next' } });
    await screen.findByText('Unable to load records');
    expect(signal.aborted).toBe(true);
    await act(async () => finish({ data: [fixture], total: 41 }));
    expect(
      screen.queryByRole('button', { name: 'Inspect Acacia Trading' }),
    ).not.toBeInTheDocument();
    state.get.mockResolvedValue({ data: [fixture], total: 41 });
    await userEvent.click(screen.getByRole('button', { name: 'Try again' }));
    await ready();
  });
  it.each(['block', 'unblock', 'delete'] as const)(
    'requires named %s confirmation and retains failed action',
    async (kind) => {
      if (kind === 'unblock')
        state.get.mockImplementation(async (path: string) =>
          path.endsWith('workbench-summary')
            ? summary
            : { data: [{ ...fixture, status: 'BLOCKED' }], total: 1 },
        );
      const user = userEvent.setup();
      mount('suppliers');
      await ready();
      await inspect();
      const label = `${kind[0].toUpperCase()}${kind.slice(1)} supplier`;
      await user.click(screen.getByRole('button', { name: label }));
      expect(state.patch).not.toHaveBeenCalled();
      expect(state.remove).not.toHaveBeenCalled();
      let dialog = screen.getByRole('dialog', { name: label });
      expect(within(dialog).getByText('Acacia Trading')).toBeInTheDocument();
      await user.click(within(dialog).getByRole('button', { name: 'Keep supplier' }));
      await user.click(screen.getByRole('button', { name: label }));
      dialog = screen.getByRole('dialog', { name: label });
      const api = kind === 'delete' ? state.remove : state.patch;
      api.mockRejectedValueOnce(new Error('Try later'));
      await user.click(within(dialog).getByRole('button', { name: label }));
      expect(await within(dialog).findByRole('alert')).toHaveTextContent('Try later');
      await user.click(within(dialog).getByRole('button', { name: label }));
      await waitFor(() =>
        expect(screen.queryByRole('dialog', { name: label })).not.toBeInTheDocument(),
      );
      if (kind === 'delete') expect(api).toHaveBeenCalledWith('/suppliers/partner');
      else
        expect(api).toHaveBeenCalledWith('/suppliers/partner', {
          status: kind === 'block' ? 'BLOCKED' : 'ACTIVE',
        });
    },
  );
  it('restores phone focus after inspection', async () => {
    window.matchMedia = vi.fn().mockReturnValue({ matches: true });
    mount();
    await ready();
    await inspect();
    expect(screen.getByRole('complementary', { name: 'Record details' })).toHaveFocus();
    await userEvent.click(screen.getByRole('button', { name: 'Back to list' }));
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Inspect Acacia Trading' })).toHaveFocus(),
    );
  });
  it('loads all directory pages and retries instead of silently using incomplete choices', async () => {
    state.page.mockImplementation(async (path: string, options: { query: { page: number } }) => {
      if (path === '/companies') {
        if (options.query.page === 1)
          return { data: [{ id: 'company', name: 'Example Company' }], total: 2 };
        throw new Error('Later page failed');
      }
      return { data: [], total: 0 };
    });
    mount();
    await screen.findByText(/Later page failed/);
    await userEvent.click(screen.getByRole('button', { name: 'Filters', exact: true }));
    expect(screen.getByRole('combobox', { name: 'Company filter' })).toBeDisabled();
    state.page.mockResolvedValue({ data: [{ id: 'company', name: 'Example Company' }], total: 1 });
    await userEvent.click(screen.getByRole('button', { name: 'Retry company choices' }));
    await waitFor(() =>
      expect(screen.getByRole('combobox', { name: 'Company filter' })).not.toBeDisabled(),
    );
  });
  it('allows unchanged scope edits without directory access and never changes immutable codes', async () => {
    state.permissions = new Set(['suppliers.update']);
    const saved = vi.fn();
    render(
      <UnsavedWorkProvider>
        <TradingPartnerEditor kind="suppliers" record={fixture} onClose={vi.fn()} onSaved={saved} />
      </UnsavedWorkProvider>,
    );
    expect(state.page).not.toHaveBeenCalled();
    expect(screen.getByRole('textbox', { name: 'Supplier code' })).toBeDisabled();
    await userEvent.type(screen.getByRole('textbox', { name: 'Payment terms' }), ' revised');
    await userEvent.click(screen.getByRole('button', { name: 'Save changes' }));
    await waitFor(() => expect(saved).toHaveBeenCalled());
    expect(state.patch).toHaveBeenCalledWith('/suppliers/partner', {
      paymentTerms: 'Net 30 revised',
    });
  });
});
