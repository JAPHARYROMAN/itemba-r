import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ProductRegister } from './product-register';
import type { Product } from './product-types';

const state = vi.hoisted(() => ({ permissions: new Set<string>() }));
vi.mock('@/hooks/use-auth', () => ({
  useAuth: () => ({
    user: { companyId: 'company' },
    loading: false,
    hasPermission: (permission: string) => state.permissions.has(permission),
  }),
}));
const record: Product = {
  id: 'exact-product',
  name: 'Product',
  productCode: 'SKU-01',
  companyId: 'company',
  categoryId: 'category',
  baseUnitId: 'unit',
  productType: 'STOCK_ITEM',
  status: 'ACTIVE',
  trackInventory: true,
  trackBatch: false,
  trackExpiry: false,
  inventoryBalance: { quantityOnHand: 2, quantityReserved: 5 },
  availableQuantity: -3,
};
const props = (onAdjust = vi.fn(), branchId = 'branch') => ({
  records: [record],
  total: 1,
  page: 1,
  selectedId: null,
  loading: false,
  error: '',
  detailLoading: false,
  detailError: '',
  onRetry: vi.fn(),
  onDetailRetry: vi.fn(),
  onSelect: vi.fn(),
  onClose: vi.fn(),
  onPage: vi.fn(),
  scope: { companyId: 'company', divisionId: '', branchId },
  branchLabel: 'Branch',
  retrievedAt: null,
  imageVersion: 1,
  profileHref: () => '/inventory/products/exact-product',
  onSaved: vi.fn(),
  onAdjust,
  onDelete: vi.fn(),
});
beforeEach(() => {
  state.permissions = new Set(['products.view']);
});

describe('direct product stock actions', () => {
  it('launches the exact tracked product without first opening its inspector', () => {
    state.permissions.add('inventory.adjustments.create');
    const onAdjust = vi.fn();
    const config = props(onAdjust);
    render(<ProductRegister {...config} />);
    fireEvent.click(screen.getByRole('button', { name: 'Adjust stock for Product' }));
    expect(onAdjust).toHaveBeenCalledWith(record);
    expect(config.onSelect).not.toHaveBeenCalled();
  });
  it('requires adjustment permission and a selected branch for the row action', () => {
    const ui = render(<ProductRegister {...props()} />);
    expect(
      screen.queryByRole('button', { name: 'Adjust stock for Product' }),
    ).not.toBeInTheDocument();
    state.permissions.add('inventory.adjustments.create');
    ui.rerender(<ProductRegister {...props(undefined, '')} />);
    expect(
      screen.queryByRole('button', { name: 'Adjust stock for Product' }),
    ).not.toBeInTheDocument();
  });
  it('does not offer a stock adjustment for an untracked product', () => {
    state.permissions.add('inventory.adjustments.create');
    render(<ProductRegister {...props()} records={[{ ...record, trackInventory: false }]} />);
    expect(
      screen.queryByRole('button', { name: 'Adjust stock for Product' }),
    ).not.toBeInTheDocument();
  });
  it('keeps semantic stock status text with the raw negative availability', () => {
    const { container } = render(<ProductRegister {...props()} />);
    expect(screen.getByText('-3')).toBeVisible();
    expect(screen.getByText('Over-reserved')).toHaveAttribute('data-stock-status', 'Over-reserved');
    expect(container.querySelector('[data-column-label="Reserved"]')).toHaveTextContent('5');
  });
});
