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

  /**
   * onResolved is held in a ref so it is not a dependency of the resolve
   * effect. The ref used to be assigned during render and is now re-synced in
   * an effect. This covers the asynchronous path, where the callback fires
   * from a .then() — ordering cannot matter there, because every effect in
   * the commit has run long before the promise settles. The test below covers
   * the path where ordering does matter.
   */
  it('calls the latest onResolved after a re-render, not the one from first render', async () => {
    backendGet.mockImplementation((path: string) =>
      Promise.resolve(path.endsWith('customer-zebra') ? zebraCustomer : alphaCustomer),
    );
    const first = vi.fn();
    const second = vi.fn();

    const { rerender } = render(
      <CustomerPicker
        label="Customer"
        value="customer-alpha"
        onChange={vi.fn()}
        onResolved={first}
        companyId="company-1"
      />,
    );
    await waitFor(() => expect(first).toHaveBeenCalledWith(alphaCustomer));

    // New callback AND a new value, so the resolve effect re-runs on a commit
    // in which the ref must already have been re-synced.
    rerender(
      <CustomerPicker
        label="Customer"
        value="customer-zebra"
        onChange={vi.fn()}
        onResolved={second}
        companyId="company-1"
      />,
    );

    await waitFor(() => expect(second).toHaveBeenCalledWith(zebraCustomer));
    expect(first).not.toHaveBeenCalledWith(zebraCustomer);
  });

  /**
   * Clearing the value is the one branch that calls onResolved *synchronously*
   * inside the resolve effect, so it is the only place the re-sync's position
   * is load-bearing: declared above, the ref already holds this render's
   * callback; declared below, the effect fires the previous render's one.
   * Nothing else in the suite distinguishes the two, which is why this exists.
   */
  it('clears through the latest onResolved, which requires the ref re-sync to run first', async () => {
    backendGet.mockResolvedValue(alphaCustomer);
    const first = vi.fn();
    const second = vi.fn();

    const { rerender } = render(
      <CustomerPicker
        label="Customer"
        value="customer-alpha"
        onChange={vi.fn()}
        onResolved={first}
        companyId="company-1"
      />,
    );
    await waitFor(() => expect(first).toHaveBeenCalledWith(alphaCustomer));
    first.mockClear();

    // value -> '' takes the synchronous branch, on the same commit that
    // swaps the callback.
    rerender(
      <CustomerPicker
        label="Customer"
        value=""
        onChange={vi.fn()}
        onResolved={second}
        companyId="company-1"
      />,
    );

    await waitFor(() => expect(second).toHaveBeenCalledWith(null));
    expect(first).not.toHaveBeenCalled();
  });
});
