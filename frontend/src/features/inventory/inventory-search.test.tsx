import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import InventorySearch, { inventoryProductHref, inventoryViewHref } from './inventory-search';

const h = vi.hoisted(() => ({
  backendPage: vi.fn(),
}));

vi.mock('@/lib/api-client', () => ({
  backendPage: h.backendPage,
}));

const scope = {
  companyId: 'company-1',
  divisionId: 'division-1',
  branchId: 'branch-1',
};

describe('inventory search links', () => {
  it('preserves the complete inventory scope in product and view links', () => {
    expect(inventoryProductHref(scope, 'product/1', 'cement')).toBe(
      '/inventory/products/product%2F1?companyId=company-1&divisionId=division-1&branchId=branch-1&q=cement',
    );
    expect(
      inventoryViewHref(scope, 'stock', 'movements', {
        productId: 'product-1',
        q: 'cement',
      }),
    ).toBe(
      '/inventory?tab=stock&view=movements&companyId=company-1&divisionId=division-1&branchId=branch-1&productId=product-1&q=cement',
    );
  });
});

describe('InventorySearch', () => {
  beforeEach(() => {
    h.backendPage.mockReset();
    h.backendPage.mockResolvedValue({
      data: [
        {
          id: 'product-1',
          name: 'Twiga Cement 50kg',
          productCode: 'CEM-001',
          availableQuantity: 42,
          unitSymbol: 'bag',
          category: { name: 'Cement' },
          status: 'ACTIVE',
        },
      ],
      total: 1,
      page: 1,
      limit: 8,
      totalPages: 1,
    });
  });

  it('searches within the selected scope and opens exact product movements', async () => {
    const onQueryChange = vi.fn();
    const onNavigate = vi.fn();

    render(
      <InventorySearch
        scope={scope}
        query=""
        permissions={{ balances: true, movements: true, batches: true, catalog: true }}
        onQueryChange={onQueryChange}
        onNavigate={onNavigate}
      />,
    );

    fireEvent.change(screen.getByRole('combobox', { name: 'Search inventory' }), {
      target: { value: 'cement' },
    });

    await waitFor(() => expect(h.backendPage).toHaveBeenCalledTimes(1));
    expect(h.backendPage).toHaveBeenCalledWith(
      '/products',
      expect.objectContaining({
        query: {
          search: 'cement',
          companyId: 'company-1',
          divisionId: 'division-1',
          branchId: 'branch-1',
          page: 1,
          limit: 8,
        },
      }),
    );
    expect(await screen.findByText('Twiga Cement 50kg')).toBeInTheDocument();
    expect(screen.getByText('42 bag available')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Movements' }));
    expect(onNavigate).toHaveBeenCalledWith(
      '/inventory?tab=stock&view=movements&companyId=company-1&divisionId=division-1&branchId=branch-1&productId=product-1&q=cement',
    );
    await waitFor(() => expect(onQueryChange).toHaveBeenCalledWith('cement'));
  });
});
