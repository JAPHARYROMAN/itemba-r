import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PayrollTypeWorkspace } from './payroll-type-workspace';
import { UnsavedWorkProvider } from './unsaved-work-provider';
const state = vi.hoisted(() => ({
  permissions: new Set<string>(),
  page: vi.fn(),
  post: vi.fn(),
  put: vi.fn(),
  remove: vi.fn(),
  failChoices: false,
}));
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }) }));
vi.mock('@/hooks/use-auth', () => ({
  useAuth: () => ({ hasPermission: (p: string) => state.permissions.has(p) }),
}));
vi.mock('@/lib/api-client', () => ({
  backendPage: state.page,
  backendPost: state.post,
  backendPut: state.put,
  backendDelete: state.remove,
}));
beforeEach(() => {
  vi.resetAllMocks();
  state.failChoices = false;
  state.permissions = new Set([
    'allowances.view',
    'allowances.manage',
    'deductions.view',
    'deductions.manage',
  ]);
  state.page.mockImplementation(async (path) => {
    if (path === '/companies') {
      if (state.failChoices) throw new Error('Companies unavailable');
      return { data: [{ id: 'company', name: 'Example Company' }], total: 1 };
    }
    return {
      data: [
        {
          id: 'type',
          name: 'Example type',
          code: 'EXAMPLE',
          companyId: 'company',
          company: { id: 'company', name: 'Example Company' },
          recurring: true,
          isActive: true,
          taxable: true,
          statutory: false,
          defaultAmount: '10000',
          defaultPercentage: '3.5',
        },
      ],
      total: 21,
    };
  });
  state.post.mockResolvedValue({});
  state.put.mockResolvedValue({});
  state.remove.mockResolvedValue({});
  window.matchMedia = vi.fn().mockReturnValue({ matches: false });
  HTMLDialogElement.prototype.showModal = function () {
    this.setAttribute('open', '');
  };
  HTMLDialogElement.prototype.close = function () {
    this.removeAttribute('open');
  };
});
const mount = (kind: 'allowance' | 'deduction') =>
  render(
    <UnsavedWorkProvider>
      <PayrollTypeWorkspace kind={kind} />
    </UnsavedWorkProvider>,
  );
async function inspect() {
  await userEvent.click(await screen.findByRole('button', { name: 'Inspect Example type' }));
}
describe.each(['allowance', 'deduction'] as const)('%s type workspace', (kind) => {
  it('enforces read and manage permission separately', async () => {
    state.permissions.clear();
    const view = mount(kind);
    expect(screen.getByText('Your role cannot view ' + kind + ' types.')).toBeInTheDocument();
    expect(state.page).not.toHaveBeenCalled();
    view.unmount();
    state.permissions.add(kind + 's.view');
    mount(kind);
    await inspect();
    expect(screen.queryByRole('button', { name: 'Edit type' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Delete type' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'New ' + kind + ' type' })).not.toBeInTheDocument();
  });
  it('preserves company-scoped server search and pagination', async () => {
    mount(kind);
    await inspect();
    await userEvent.click(screen.getByRole('button', { name: 'Next', exact: true }));
    await waitFor(() =>
      expect(state.page).toHaveBeenCalledWith(
        '/hr/' + kind + '-types',
        expect.objectContaining({ query: expect.objectContaining({ page: 2 }) }),
      ),
    );
    await userEvent.selectOptions(screen.getByLabelText('Company filter'), 'company');
    await userEvent.type(
      screen.getByPlaceholderText('Search ' + kind + ' types by name…'),
      ' Example ',
    );
    await waitFor(() =>
      expect(state.page).toHaveBeenCalledWith(
        '/hr/' + kind + '-types',
        expect.objectContaining({
          query: { page: 1, limit: 20, companyId: 'company', search: 'Example' },
        }),
      ),
    );
  });
  it('guards edits, retains failed inputs and clears optional defaults without resending unchanged fields', async () => {
    mount(kind);
    await inspect();
    await userEvent.click(screen.getByRole('button', { name: 'Edit type' }));
    const dialog = await screen.findByRole('dialog', { name: 'Edit ' + kind + ' type' });
    await within(dialog).findByRole('option', { name: 'Example Company' });
    await userEvent.clear(within(dialog).getByLabelText('Default amount (TZS)'));
    if (kind === 'deduction')
      await userEvent.clear(within(dialog).getByLabelText('Default percentage (%)'));
    state.put.mockRejectedValueOnce(new Error('Save failed'));
    await userEvent.click(within(dialog).getByRole('button', { name: 'Save type' }));
    expect(await within(dialog).findByRole('alert')).toHaveTextContent('Save failed');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    await userEvent.click(screen.getByRole('button', { name: 'Stay here' }));
    expect(within(dialog).getByLabelText('Default amount (TZS)')).toHaveValue(null);
    await userEvent.click(within(dialog).getByRole('button', { name: 'Save type' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(state.put).toHaveBeenLastCalledWith('/hr/' + kind + '-types/type', {
      defaultAmount: null,
      ...(kind === 'deduction' ? { defaultPercentage: null } : {}),
    });
    expect(state.post).not.toHaveBeenCalled();
  });
  it('retries failed company choices and creates with numeric and classification values', async () => {
    mount(kind);
    await inspect();
    state.failChoices = true;
    await userEvent.click(screen.getByRole('button', { name: 'New ' + kind + ' type' }));
    const dialog = await screen.findByRole('dialog', { name: 'New ' + kind + ' type' });
    expect(await within(dialog).findByRole('alert')).toHaveTextContent('Companies unavailable');
    expect(within(dialog).getByRole('button', { name: 'Save type' })).toBeDisabled();
    state.failChoices = false;
    await userEvent.click(within(dialog).getByRole('button', { name: 'Retry companies' }));
    await within(dialog).findByRole('option', { name: 'Example Company' });
    await userEvent.selectOptions(
      within(dialog).getByLabelText('Company', { exact: false }),
      'company',
    );
    await userEvent.type(within(dialog).getByLabelText('Name', { exact: false }), ' Sample ');
    await userEvent.type(within(dialog).getByLabelText('Code', { exact: false }), ' SAMPLE ');
    await userEvent.type(within(dialog).getByLabelText('Default amount (TZS)'), '0');
    await userEvent.selectOptions(
      within(dialog).getByLabelText(kind === 'allowance' ? 'Taxable' : 'Statutory'),
      'true',
    );
    await userEvent.selectOptions(within(dialog).getByLabelText('Recurring'), 'true');
    if (kind === 'deduction')
      await userEvent.type(within(dialog).getByLabelText('Default percentage (%)'), '2.5');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Save type' }));
    await waitFor(() =>
      expect(state.post).toHaveBeenCalledWith('/hr/' + kind + '-types', {
        companyId: 'company',
        name: 'Sample',
        code: 'SAMPLE',
        isActive: true,
        recurring: true,
        [kind === 'allowance' ? 'taxable' : 'statutory']: true,
        defaultAmount: 0,
        ...(kind === 'deduction' ? { defaultPercentage: 2.5 } : {}),
      }),
    );
  });
  it('keeps failed deletion inside a named confirmation and retries explicitly', async () => {
    mount(kind);
    await inspect();
    await userEvent.click(screen.getByRole('button', { name: 'Delete type' }));
    const dialog = await screen.findByRole('dialog', { name: 'Delete ' + kind + ' type' });
    expect(dialog).toHaveTextContent('Example type · EXAMPLE');
    expect(dialog).toHaveTextContent('Example Company');
    expect(state.remove).not.toHaveBeenCalled();
    state.remove.mockRejectedValueOnce(new Error('Deletion failed'));
    await userEvent.click(within(dialog).getByRole('button', { name: 'Delete type' }));
    expect(await within(dialog).findByRole('alert')).toHaveTextContent('Deletion failed');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Delete type' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(state.remove).toHaveBeenLastCalledWith('/hr/' + kind + '-types/type');
  });
});
