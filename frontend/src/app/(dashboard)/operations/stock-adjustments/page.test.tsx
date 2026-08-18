import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { InventoryWorkspaceProvider } from '@/features/inventory/inventory-workspace-context';

const backendList = vi.fn();
const backendPage = vi.fn();

vi.mock('@/hooks/use-auth', () => ({
  useAuth: () => ({ hasPermission: () => true }),
}));

vi.mock('@/lib/api-client', () => ({
  backendDelete: vi.fn(),
  backendGet: vi.fn(),
  backendList: (path: string, options?: unknown) => backendList(path, options),
  backendPage: (path: string, options?: unknown) => backendPage(path, options),
  backendPatch: vi.fn(),
  backendPost: vi.fn(),
}));

vi.mock('@/lib/export-download', () => ({
  downloadTablePdf: vi.fn(),
}));

import StockAdjustmentsPage from './page';

describe('StockAdjustmentsPage in the inventory workspace', () => {
  beforeEach(() => {
    backendList.mockReset();
    backendPage.mockReset();
    backendList.mockImplementation((path: string) => {
      if (path === '/companies') {
        return Promise.resolve([{ id: 'company-1', name: 'Westsides', code: 'WESTSIDES' }]);
      }
      if (path === '/divisions') {
        return Promise.resolve([{ id: 'division-1', name: 'Hardware', code: 'HW' }]);
      }
      if (path === '/branches') {
        return Promise.resolve([
          { id: 'branch-1', name: 'Kisimani Main Branch', divisionId: 'division-1' },
        ]);
      }
      if (path === '/units') {
        return Promise.resolve([{ id: 'unit-1', name: 'Piece', symbol: 'pc' }]);
      }
      return Promise.resolve([]);
    });
    backendPage.mockResolvedValue({ data: [], total: 0, page: 1, totalPages: 1 });
    vi.stubGlobal(
      'matchMedia',
      vi.fn().mockReturnValue({
        matches: true,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      }),
    );
  });

  it('opens the creation form and allows branch selection from an all-branches view', async () => {
    const user = userEvent.setup();
    render(
      <InventoryWorkspaceProvider
        scope={{ companyId: 'company-1', divisionId: '', branchId: '' }}
        searchQuery=""
      >
        <StockAdjustmentsPage />
      </InventoryWorkspaceProvider>,
    );

    const createButton = await screen.findByRole('button', { name: /new adjustment/i });
    expect(createButton).toBeEnabled();
    await user.click(createButton);

    expect(await screen.findByText('Create Stock Adjustment')).toBeInTheDocument();
    const branchSelect = screen.getByLabelText(/branch \/ location/i);
    expect(branchSelect).toBeEnabled();

    await waitFor(() =>
      expect(screen.getByRole('option', { name: /kisimani/i })).toBeInTheDocument(),
    );
    await user.selectOptions(branchSelect, 'branch-1');
    expect(branchSelect).toHaveValue('branch-1');

    await user.click(screen.getByRole('combobox', { name: 'Search product, line 1' }));
    await waitFor(() =>
      expect(backendList).toHaveBeenCalledWith('/products', {
        query: {
          search: undefined,
          companyId: 'company-1',
          divisionId: 'division-1',
          branchId: 'branch-1',
          limit: 20,
        },
      }),
    );
  });
});
