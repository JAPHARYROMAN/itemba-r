import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const backendGet = vi.fn();
const backendList = vi.fn();

vi.mock('@/lib/api-client', () => ({
  backendGet: (path: string) => backendGet(path),
  backendList: (path: string, options?: unknown) => backendList(path, options),
}));

import { ProductPicker } from './product-picker';

const cement = {
  id: 'product-1',
  name: 'Portland Cement 42.5kg',
  productCode: 'CEM-425',
  sku: 'SKU-CEMENT',
  defaultUnitId: 'unit-bag',
  effectivePurchasePrice: 24500,
  category: { name: 'Cement' },
  productFamily: { brand: 'Twiga', name: 'Portland Cement' },
  unitSymbol: 'bag',
  availableQuantity: 12,
};

function ControlledPicker({ onChange }: { onChange: ReturnType<typeof vi.fn> }) {
  const [value, setValue] = useState('');
  return (
    <ProductPicker
      value={value}
      onChange={(productId, product) => {
        setValue(productId);
        onChange(productId, product);
      }}
      companyId="company-1"
      divisionId="division-1"
      branchId="branch-1"
    />
  );
}

describe('ProductPicker', () => {
  beforeEach(() => {
    backendGet.mockReset();
    backendList.mockReset();
    backendList.mockResolvedValue([cement]);
  });

  it('opens a visible scoped product list and searches the real products endpoint', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<ControlledPicker onChange={onChange} />);

    const input = screen.getByRole('combobox', { name: 'Search products' });
    await user.click(input);

    const listbox = await screen.findByRole('listbox', { name: 'Products' });
    expect(listbox).toBeInTheDocument();
    expect(listbox).toHaveStyle({ zIndex: '1600' });
    await waitFor(() => expect(screen.getByText('Portland Cement 42.5kg')).toBeInTheDocument());
    expect(screen.getByText(/CEM-425/)).toBeInTheDocument();
    expect(screen.getByText('12 bag available')).toBeInTheDocument();
    expect(backendList).toHaveBeenCalledWith('/products', {
      query: {
        search: undefined,
        companyId: 'company-1',
        divisionId: 'division-1',
        branchId: 'branch-1',
        limit: 20,
      },
    });

    await user.type(input, 'cement');
    await waitFor(() =>
      expect(backendList).toHaveBeenLastCalledWith('/products', {
        query: {
          search: 'cement',
          companyId: 'company-1',
          divisionId: 'division-1',
          branchId: 'branch-1',
          limit: 20,
        },
      }),
    );

    await user.click(screen.getByText('Portland Cement 42.5kg'));
    expect(onChange).toHaveBeenLastCalledWith('product-1', cement);
    expect(input).toHaveValue('Portland Cement 42.5kg - CEM-425');
  });

  it('shows the dropdown when the dedicated dropdown button is used', async () => {
    const user = userEvent.setup();
    render(<ProductPicker value="" onChange={vi.fn()} companyId="company-1" />);

    await user.click(screen.getByRole('button', { name: 'Show products' }));
    expect(await screen.findByRole('listbox', { name: 'Products' })).toBeInTheDocument();
  });
});
