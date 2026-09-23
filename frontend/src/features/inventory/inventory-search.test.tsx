import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
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
  it('ignores obsolete scope responses and does not open stale results while loading', async () => {
    let resolve!: (p: unknown) => void;
    h.backendPage.mockImplementationOnce(
      () =>
        new Promise((r) => {
          resolve = r;
        }),
    );
    const onNavigate = vi.fn(),
      onQueryChange = vi.fn();
    const props = {
      query: 'cement',
      permissions: { balances: true, movements: true, batches: false, catalog: true },
      onNavigate,
      onQueryChange,
    };
    const view = render(<InventorySearch {...props} scope={scope} />);
    const input = screen.getByRole('combobox', { name: 'Search inventory' });
    fireEvent.focus(input);
    await waitFor(() => expect(h.backendPage).toHaveBeenCalledTimes(1));
    const signal = h.backendPage.mock.calls[0][1].signal;
    h.backendPage.mockResolvedValue({
      data: [{ id: 'new', name: 'New scoped product', availableQuantity: null }],
      total: 1,
    });
    view.rerender(<InventorySearch {...props} scope={{ ...scope, companyId: 'second' }} />);
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(onNavigate).not.toHaveBeenCalled();
    await screen.findByText('New scoped product');
    expect(signal.aborted).toBe(true);
    await act(async () => resolve({ data: [{ id: 'old', name: 'Obsolete product' }], total: 1 }));
    expect(screen.queryByText('Obsolete product')).not.toBeInTheDocument();
    expect(screen.queryByText('0 available')).not.toBeInTheDocument();
  });
  it('retries failures and keeps Escape from opening hidden results with Enter', async () => {
    h.backendPage.mockRejectedValueOnce(new Error('Search unavailable'));
    const onNavigate = vi.fn();
    render(
      <InventorySearch
        scope={scope}
        query="cement"
        permissions={{ balances: true, movements: true, batches: false, catalog: true }}
        onQueryChange={vi.fn()}
        onNavigate={onNavigate}
      />,
    );
    const input = screen.getByRole('combobox', { name: 'Search inventory' });
    fireEvent.focus(input);
    await screen.findByText('Inventory search is temporarily unavailable.');
    fireEvent.click(screen.getByRole('button', { name: 'Try search again' }));
    await screen.findByText('Twiga Cement 50kg');
    fireEvent.keyDown(input, { key: 'ArrowDown' });
    const productButton = screen.getByRole('button', { name: /Twiga Cement 50kg CEM-001/ });
    expect(productButton).toHaveFocus();
    fireEvent.keyDown(productButton, { key: 'Escape' });
    expect(input).toHaveFocus();
    // Native search inputs clear their text on Escape unless the default is cancelled.
    expect(fireEvent.keyDown(input, { key: 'Escape', cancelable: true })).toBe(false);
    expect(input).toHaveValue('cement');
    expect(
      screen.queryByRole('dialog', { name: 'Inventory search results' }),
    ).not.toBeInTheDocument();
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(onNavigate).not.toHaveBeenCalled();
  });
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
