import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const backendGet = vi.fn();
const backendList = vi.fn();

vi.mock('@/lib/api-client', () => ({
  backendGet: (path: string) => backendGet(path),
  backendList: (path: string, options?: unknown) => backendList(path, options),
}));

import { CustomerPicker, SupplierPicker } from './business-party-picker';

const alphaCustomer = {
  id: 'customer-alpha',
  name: 'Alpha Builders',
  customerCode: 'CUS-001',
  phone: '0712 000 001',
  tin: '100-200-300',
};
const zebraCustomer = {
  id: 'customer-zebra',
  name: 'Zebra Contractors',
  customerCode: 'CUS-099',
};

function ControlledCustomerPicker({ onChange }: { onChange: ReturnType<typeof vi.fn> }) {
  const [value, setValue] = useState('');
  return (
    <CustomerPicker
      label="Customer"
      value={value}
      onChange={(customerId, customer) => {
        setValue(customerId);
        onChange(customerId, customer);
      }}
      companyId="company-1"
      divisionId="division-1"
      branchId="branch-1"
    />
  );
}

describe('BusinessPartyPicker', () => {
  beforeEach(() => {
    backendGet.mockReset();
    backendList.mockReset();
  });

  it('loads scoped customers, sorts them alphabetically and searches the API', async () => {
    backendList.mockResolvedValue([zebraCustomer, alphaCustomer]);
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<ControlledCustomerPicker onChange={onChange} />);

    const input = screen.getByLabelText('Customer');
    await user.click(input);

    const listbox = await screen.findByRole('listbox', { name: 'Customers' });
    expect(listbox).toHaveStyle({ zIndex: '1600' });
    await waitFor(() => expect(within(listbox).getAllByRole('option')).toHaveLength(2));
    const options = within(listbox).getAllByRole('option');
    expect(options[0]).toHaveTextContent('Alpha Builders');
    expect(options[1]).toHaveTextContent('Zebra Contractors');
    expect(backendList).toHaveBeenCalledWith('/customers', {
      query: {
        search: undefined,
        companyId: 'company-1',
        divisionId: 'division-1',
        branchId: 'branch-1',
        status: 'ACTIVE',
        limit: 50,
      },
    });

    await user.type(input, 'alpha');
    await waitFor(() =>
      expect(backendList).toHaveBeenLastCalledWith('/customers', {
        query: {
          search: 'alpha',
          companyId: 'company-1',
          divisionId: 'division-1',
          branchId: 'branch-1',
          status: 'ACTIVE',
          limit: 50,
        },
      }),
    );

    await user.click(screen.getByText('Alpha Builders'));
    expect(onChange).toHaveBeenLastCalledWith('customer-alpha', alphaCustomer);
    expect(input).toHaveValue('Alpha Builders - CUS-001');
  });

  it('searches suppliers by the selected company and division', async () => {
    const supplier = {
      id: 'supplier-1',
      name: 'Amani Cement Supplies',
      supplierCode: 'SUP-001',
      email: 'sales@amani.example',
    };
    backendList.mockResolvedValue([supplier]);
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(
      <SupplierPicker
        label="Supplier"
        value=""
        onChange={onChange}
        companyId="company-1"
        divisionId="division-1"
      />,
    );

    await user.type(screen.getByLabelText('Supplier'), 'amani');
    await waitFor(() =>
      expect(backendList).toHaveBeenLastCalledWith('/suppliers', {
        query: {
          search: 'amani',
          companyId: 'company-1',
          divisionId: 'division-1',
          branchId: undefined,
          status: 'ACTIVE',
          limit: 50,
        },
      }),
    );
    await user.click(await screen.findByText('Amani Cement Supplies'));
    expect(onChange).toHaveBeenCalledWith('supplier-1', supplier);
  });

  it('resolves the label and details for a saved customer selection', async () => {
    backendGet.mockResolvedValue(alphaCustomer);
    const onResolved = vi.fn();
    render(
      <CustomerPicker
        label="Customer"
        value="customer-alpha"
        onChange={vi.fn()}
        onResolved={onResolved}
        companyId="company-1"
      />,
    );

    await waitFor(() =>
      expect(screen.getByLabelText('Customer')).toHaveValue('Alpha Builders - CUS-001'),
    );
    expect(backendGet).toHaveBeenCalledWith('/customers/customer-alpha');
    expect(onResolved).toHaveBeenCalledWith(alphaCustomer);
  });
});
