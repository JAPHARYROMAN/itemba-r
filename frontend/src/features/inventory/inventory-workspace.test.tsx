import { useState } from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import InventoryWorkspace from './inventory-workspace';
import { useInventoryWorkspace } from './inventory-workspace-context';
import { UnsavedWorkProvider, useFormGuard } from '@/components/workspace/unsaved-work-provider';
import { WorkspaceNavigationProvider } from '@/components/workspace/workspace-navigation';
const state = vi.hoisted(() => ({
  permissions: new Set<string>(),
  search: '',
  page: vi.fn(),
  push: vi.fn(),
  replace: vi.fn(),
  loading: false,
}));
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: state.push, replace: state.replace }),
  usePathname: () => '/inventory',
  useSearchParams: () => new URLSearchParams(state.search),
}));
vi.mock('@/hooks/use-auth', () => ({
  useAuth: () => ({
    hasPermission: (p: string) => state.permissions.has(p),
    loading: state.loading,
    user: {},
  }),
}));
vi.mock('@/lib/api-client', () => ({ backendPage: state.page }));
vi.mock('next/dynamic', () => ({
  default: () =>
    function View() {
      const context = useInventoryWorkspace();
      const [form, setForm] = useState({ note: '' });
      const guard = useFormGuard(form, setForm);
      return (
        <form {...guard.capture}>
          <output aria-label="Mounted scope">{JSON.stringify(context?.scope)}</output>
          <input
            aria-label="View draft"
            value={form.note}
            onChange={(e) => setForm({ note: e.target.value })}
          />
        </form>
      );
    },
}));
const mount = () =>
  render(
    <UnsavedWorkProvider>
      <InventoryWorkspace />
    </UnsavedWorkProvider>,
  );
beforeEach(() => {
  vi.resetAllMocks();
  state.loading = false;
  state.search =
    'tab=catalog&view=products&companyId=company&divisionId=division&branchId=branch&q=cement';
  window.history.replaceState({}, '', `/inventory?${state.search}`);
  state.permissions = new Set([
    'inventory.view',
    'inventory.movements.view',
    'products.view',
    'product_categories.view',
    'units.view',
  ]);
  HTMLDialogElement.prototype.showModal = function () {
    this.setAttribute('open', '');
  };
  HTMLDialogElement.prototype.close = function () {
    this.removeAttribute('open');
  };
  state.page.mockResolvedValue({
    data: [{ id: 'product', name: 'Cement', productCode: 'CEM-01' }],
    total: 1,
  });
});
describe('Inventory workspace navigation', () => {
  it('changes companion tabs while preserving its own scope and the browser route', () => {
    state.search = 'tab=reports&companyId=main-company';
    render(
      <UnsavedWorkProvider>
        <WorkspaceNavigationProvider
          appId="inventory"
          initialHref="/inventory?tab=catalog&view=products&companyId=side-company&branchId=side-branch&q=cement"
          ownsPath={(path) => path === '/inventory'}
        >
          <InventoryWorkspace />
        </WorkspaceNavigationProvider>
      </UnsavedWorkProvider>,
    );
    expect(screen.getByLabelText('Mounted scope')).toHaveTextContent('"companyId":"side-company"');
    fireEvent.click(screen.getByRole('link', { name: 'Stock', exact: true }));
    expect(screen.getByRole('link', { name: 'Stock', exact: true })).toHaveAttribute(
      'aria-current',
      'page',
    );
    expect(screen.getByLabelText('Mounted scope')).toHaveTextContent('"branchId":"side-branch"');
    expect(state.push).not.toHaveBeenCalled();
    expect(state.replace).not.toHaveBeenCalled();
  });
  it('keeps scope and search in section links and chooses an accessible view for invalid requests', () => {
    const view = mount();
    expect(screen.getByRole('link', { name: 'Stock', exact: true })).toHaveAttribute(
      'href',
      '/inventory?tab=stock&view=live&companyId=company&divisionId=division&branchId=branch&q=cement',
    );
    expect(screen.getByRole('link', { name: 'Products', exact: true })).toHaveAttribute(
      'aria-current',
      'page',
    );
    expect(screen.getByLabelText('Mounted scope')).toHaveTextContent('"branchId":"branch"');
    state.permissions = new Set(['units.view']);
    state.search = 'tab=controls&view=damage';
    view.rerender(
      <UnsavedWorkProvider>
        <InventoryWorkspace />
      </UnsavedWorkProvider>,
    );
    expect(screen.queryByRole('link', { name: 'Controls', exact: true })).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Catalog', exact: true })).toHaveAttribute(
      'aria-current',
      'page',
    );
    expect(screen.queryByRole('button', { name: 'Find a product' })).not.toBeInTheDocument();
  });
  it('guards product-search navigation while preserving drafts on Stay', async () => {
    mount();
    fireEvent.change(screen.getByLabelText('View draft'), {
      target: { value: 'Unfinished stock count' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Find a product' }));
    fireEvent.focus(screen.getByRole('combobox', { name: 'Search inventory' }));
    fireEvent.click(await screen.findByRole('button', { name: /Cement CEM-01/ }));
    await screen.findByRole('dialog', { name: 'Keep your changes?' });
    expect(state.push).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Stay here' }));
    expect(screen.getByLabelText('View draft')).toHaveValue('Unfinished stock count');
    fireEvent.focus(screen.getByRole('combobox', { name: 'Search inventory' }));
    fireEvent.click(await screen.findByRole('button', { name: /Cement CEM-01/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Discard changes' }));
    expect(state.push).toHaveBeenCalledWith(
      '/inventory/products/product?companyId=company&divisionId=division&branchId=branch&q=cement',
      { scroll: false },
    );
  });
  it('does not mount views or read directories before auth or without any workspace access', async () => {
    state.loading = true;
    const view = mount();
    expect(state.page).not.toHaveBeenCalled();
    expect(screen.queryByLabelText('Mounted scope')).not.toBeInTheDocument();
    state.loading = false;
    state.permissions.clear();
    view.rerender(
      <UnsavedWorkProvider>
        <InventoryWorkspace />
      </UnsavedWorkProvider>,
    );
    await waitFor(() =>
      expect(screen.getByText('Inventory access is restricted')).toBeInTheDocument(),
    );
    expect(state.page).not.toHaveBeenCalled();
  });
});
