import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import InventoryLive, {
  stockReservationShare,
  type LiveStockItem,
  type LiveStockResponse,
} from './inventory-live';
import { InventoryWorkspaceProvider } from './inventory-workspace-context';
const state = vi.hoisted(() => ({
  permissions: new Set<string>(),
  get: vi.fn(),
  page: vi.fn(),
  params: '',
  loading: false,
}));
vi.mock('next/navigation', () => ({ useSearchParams: () => new URLSearchParams(state.params) }));
vi.mock('@/hooks/use-auth', () => ({
  useAuth: () => ({
    user: {},
    loading: state.loading,
    hasPermission: (p: string) => state.permissions.has(p),
  }),
}));
vi.mock('@/lib/api-client', () => ({ backendGet: state.get, backendPage: state.page }));
const cement: LiveStockItem = {
  id: 'cement-stock',
  productId: 'cement',
  companyId: 'company',
  divisionId: 'division',
  branchId: 'branch',
  product: {
    id: 'cement',
    name: 'Twiga Cement 50kg',
    productCode: 'CEM-01',
    sku: 'C50',
    barcode: '12345678',
  },
  location: { id: 'branch', name: 'Central warehouse', code: 'HQ' },
  quantityOnHand: 10,
  quantityReserved: 15,
  quantityAvailable: -5,
  averageCost: 16000,
  totalValue: 160000,
  lastMovementAt: '2026-08-01T12:00:00Z',
  daysSinceMovement: 48,
  lowThreshold: 5,
  riskScore: 150,
  status: 'LOW',
};
const paint: LiveStockItem = {
  ...cement,
  id: 'paint-stock',
  productId: 'paint',
  product: { id: 'paint', name: 'Coral white', productCode: 'P-01' },
  quantityOnHand: 60,
  quantityReserved: 0,
  quantityAvailable: 60,
  averageCost: 0,
  totalValue: 0,
  status: 'OK',
  riskScore: 0,
  daysSinceMovement: null,
  lastMovementAt: null,
};
const unassigned: LiveStockItem = {
  ...cement,
  id: 'unassigned-stock',
  productId: 'roof',
  product: { id: 'roof', name: 'Roof sheets' },
  branchId: null,
  divisionId: null,
  location: null,
  quantityOnHand: -2,
  quantityReserved: 0,
  quantityAvailable: -2,
  averageCost: null,
  totalValue: null,
  status: 'OUT',
  riskScore: 100,
  lastMovementAt: null,
  daysSinceMovement: null,
};
const response: LiveStockResponse = {
  lowThreshold: 10,
  totals: {
    totalSkus: 3,
    out: 1,
    low: 1,
    ok: 1,
    totalValue: 160000,
    riskValue: 160000,
    negative: 1,
    oversold: 2,
    reservedSkus: 1,
  },
  locations: [
    {
      locationId: 'branch',
      locationName: 'Central warehouse',
      locationCode: 'HQ',
      branchId: 'branch',
      itemCount: 2,
      out: 0,
      low: 1,
      ok: 1,
      totalValue: 160000,
      riskValue: 160000,
      items: [cement, paint],
    },
    {
      locationId: 'unassigned',
      locationName: 'Unassigned branch/location',
      locationCode: '',
      branchId: null,
      itemCount: 1,
      out: 1,
      low: 0,
      ok: 0,
      totalValue: 0,
      riskValue: 0,
      items: [unassigned],
    },
  ],
};
const embed = (companyId = 'company', q = '') => (
  <InventoryWorkspaceProvider scope={{ companyId, divisionId: '', branchId: '' }} searchQuery={q}>
    <InventoryLive />
  </InventoryWorkspaceProvider>
);
const loaded = () => screen.findByRole('button', { name: 'Inspect Twiga Cement 50kg' });
const filters = () => fireEvent.click(screen.getByRole('button', { name: /Filters/ }));
const choose = (value: string) =>
  fireEvent.change(screen.getByLabelText('Show stock'), { target: { value } });
function capture(name: string) {
  const dir = process.env.ITEMBA_PAYROLL_VISUAL_DIR;
  if (dir) {
    document.querySelectorAll('input').forEach((input) => {
      input.setAttribute('value', input.value);
      input.toggleAttribute('checked', input.checked);
    });
    document
      .querySelectorAll('select')
      .forEach((select) =>
        Array.from(select.options).forEach((option) =>
          option.toggleAttribute('selected', option.selected),
        ),
      );
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, name + '.html'), document.body.innerHTML);
  }
}
beforeEach(() => {
  vi.resetAllMocks();
  state.params = '';
  state.loading = false;
  state.permissions = new Set([
    'inventory.view',
    'products.view',
    'inventory.movements.view',
    'product_batches.view',
    'stock_damage.view',
    'operations.reports.view',
  ]);
  state.get.mockResolvedValue(response);
  state.page.mockResolvedValue({ data: [], total: 0 });
  window.matchMedia = vi
    .fn()
    .mockReturnValue({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() });
});
afterEach(() => vi.useRealTimers());
describe('Live stock workspace', () => {
  it('waits for auth, exact read permission and company selection before any stock reads', async () => {
    state.loading = true;
    const view = render(embed());
    expect(state.get).not.toHaveBeenCalled();
    expect(state.page).not.toHaveBeenCalled();
    state.loading = false;
    state.permissions.clear();
    view.rerender(embed());
    await screen.findByText('Permission required');
    expect(state.get).not.toHaveBeenCalled();
    state.permissions.add('inventory.view');
    view.rerender(embed(''));
    await screen.findByText('Select a company to start');
    expect(state.get).not.toHaveBeenCalled();
    view.rerender(embed());
    fireEvent.click(await loaded());
    expect(screen.queryByRole('link')).not.toBeInTheDocument();
    expect(state.page).not.toHaveBeenCalled();
  });
  it('preserves complete stock facts, missing values and distinct negative/over-reserved states', async () => {
    render(embed());
    fireEvent.click(await loaded());
    const detail = screen.getByRole('complementary', { name: 'Record details' });
    for (const text of [
      '-5',
      '10',
      '15',
      '150%',
      'TZS 16,000.00',
      '5',
      'C50',
      '12345678',
      '48 days',
    ])
      expect(within(detail).getByText(text)).toBeVisible();
    expect(within(detail).getByText(/Over.reserved/i)).toBeVisible();
    expect(screen.getByLabelText('Scope stock summary')).toHaveTextContent('Stock positions3');
    capture('inventory-live-details');
    fireEvent.click(screen.getByRole('button', { name: 'Close details' }));
    capture('inventory-live');
    fireEvent.click(screen.getByRole('button', { name: 'Inspect Roof sheets' }));
    expect(within(detail).getByText('Negative On Hand')).toBeVisible();
    expect(within(detail).getByText('No movement recorded')).toBeVisible();
    expect(within(detail).getAllByText('—')).not.toHaveLength(0);
    expect(stockReservationShare({ quantityOnHand: 0, quantityReserved: 4 })).toBe('—');
    expect(stockReservationShare({ quantityOnHand: null, quantityReserved: 4 })).toBe('—');
    fireEvent.click(screen.getByRole('button', { name: 'Inspect Coral white' }));
    expect(within(detail).getAllByText('TZS 0.00')).toHaveLength(2);
  });
  it('keeps actual row scope in permitted destinations, including unassigned locations', async () => {
    render(embed());
    fireEvent.click(await loaded());
    expect(screen.getByRole('link', { name: 'Movements', exact: true })).toHaveAttribute(
      'href',
      '/inventory?tab=stock&view=movements&companyId=company&divisionId=division&branchId=branch&productId=cement',
    );
    expect(screen.getByRole('link', { name: 'Batches', exact: true })).toHaveAttribute(
      'href',
      '/inventory?tab=stock&view=batches&companyId=company&divisionId=division&branchId=branch&productId=cement',
    );
    expect(screen.getByRole('link', { name: 'Damage register', exact: true })).toHaveAttribute(
      'href',
      '/inventory?tab=controls&view=damage&companyId=company&divisionId=division&branchId=branch',
    );
    fireEvent.click(screen.getByRole('button', { name: 'Inspect Roof sheets' }));
    expect(screen.getByRole('link', { name: 'Open product' })).toHaveAttribute(
      'href',
      '/inventory/products/roof?companyId=company',
    );
  });
  it('uses real location groups and applies local review filters without extra API calls', async () => {
    render(embed());
    await loaded();
    filters();
    choose('oversold');
    expect(screen.queryByRole('button', { name: 'Inspect Coral white' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Inspect Roof sheets' })).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: /Central warehouse HQ/ }));
    expect(screen.queryByRole('button', { name: 'Inspect Roof sheets' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Show all locations' }));
    choose('slow');
    expect(screen.getByRole('button', { name: 'Inspect Twiga Cement 50kg' })).toBeVisible();
    expect(screen.queryByRole('button', { name: 'Inspect Coral white' })).not.toBeInTheDocument();
    choose('unmoved');
    expect(screen.getByRole('button', { name: 'Inspect Coral white' })).toBeVisible();
    expect(screen.queryByRole('button', { name: 'Inspect Roof sheets' })).not.toBeInTheDocument();
    expect(state.get).toHaveBeenCalledTimes(1);
    capture('inventory-live-filters');
  });
  it('makes every location and critical row available beyond preview limits and preserves pagination', async () => {
    const many = {
      ...response,
      locations: Array.from({ length: 8 }, (_, i) => ({
        ...response.locations[0],
        locationId: 'location-' + i,
        locationName: 'Warehouse ' + i,
        items: Array.from({ length: 3 }, (_, j) => ({
          ...cement,
          id: i + '-' + j,
          product: { ...cement.product, name: 'Item ' + i + '-' + j },
        })),
      })),
    };
    state.get.mockResolvedValue(many);
    render(embed());
    await screen.findByRole('button', { name: 'Inspect Item 0-0' });
    fireEvent.click(screen.getByRole('button', { name: /Needs attention/ }));
    expect(screen.getByLabelText('Stock positions')).toHaveTextContent('24 records');
    fireEvent.click(screen.getByRole('button', { name: 'Next', exact: true }));
    expect(screen.getByRole('button', { name: 'Inspect Item 7-2' })).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'Next locations' }));
    expect(screen.getByRole('button', { name: /Warehouse 7/ })).toBeVisible();
    filters();
    fireEvent.change(screen.getByLabelText('Location in this view'), {
      target: { value: 'location-7' },
    });
    expect(screen.getByLabelText('Stock positions')).toHaveTextContent('3 records');
    expect(screen.getByRole('button', { name: 'Inspect Item 7-0' })).toBeVisible();
    expect(state.get).toHaveBeenCalledTimes(1);
  });
  it('hydrates standalone scope/search URLs on the first read and follows subsequent URL changes', async () => {
    state.params =
      'companyId=company&divisionId=division&branchId=branch&search=cement&lowThreshold=4';
    const view = render(<InventoryLive />);
    await loaded();
    expect(state.get.mock.calls[0][1].query).toMatchObject({
      companyId: 'company',
      divisionId: 'division',
      branchId: 'branch',
      search: 'cement',
      lowThreshold: 4,
    });
    state.params = 'companyId=second&search=paint';
    view.rerender(<InventoryLive />);
    await waitFor(() =>
      expect(state.get).toHaveBeenLastCalledWith(
        '/inventory-balances/live',
        expect.objectContaining({
          query: expect.objectContaining({
            companyId: 'second',
            search: 'paint',
            branchId: '',
            lowThreshold: 10,
          }),
        }),
      ),
    );
  });
  it('rejects empty/negative thresholds, accepts zero, and explains the fallback rule', async () => {
    render(embed());
    await loaded();
    filters();
    fireEvent.change(screen.getByLabelText('Fallback low-stock threshold'), {
      target: { value: '-1' },
    });
    await screen.findByText('Enter a finite, non-negative fallback threshold.');
    expect(screen.queryByLabelText('Scope stock summary')).not.toBeInTheDocument();
    expect(state.get).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('button', { name: 'Refresh stock' })).toBeDisabled();
    fireEvent.change(screen.getByLabelText('Fallback low-stock threshold'), {
      target: { value: '' },
    });
    expect(state.get).toHaveBeenCalledTimes(1);
    fireEvent.change(screen.getByLabelText('Fallback low-stock threshold'), {
      target: { value: '0' },
    });
    await loaded();
    expect(state.get.mock.calls.at(-1)![1].query.lowThreshold).toBe(0);
    expect(screen.getByText(/Reorder level takes precedence/)).toBeVisible();
  });
  it('cancels reads on search/scope changes and never presents a previous company as current', async () => {
    let resolve!: (value: unknown) => void;
    state.get.mockImplementationOnce(
      () =>
        new Promise((r) => {
          resolve = r;
        }),
    );
    const view = render(embed());
    const oldSignal = state.get.mock.calls[0][1].signal;
    fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'paint' } });
    expect(oldSignal.aborted).toBe(true);
    view.rerender(embed('second', 'new'));
    await act(async () => resolve(response));
    expect(screen.queryByLabelText('Scope stock summary')).not.toBeInTheDocument();
    await loaded();
    expect(state.get.mock.calls.at(-1)![1].query).toMatchObject({
      companyId: 'second',
      search: 'new',
    });
  });
  it('removes stale metrics after a failed refresh and preserves a clear retry path', async () => {
    render(embed());
    await loaded();
    state.get.mockRejectedValueOnce(new Error('Stock service unavailable'));
    fireEvent.click(screen.getByRole('button', { name: 'Refresh stock' }));
    await screen.findByText('Stock service unavailable');
    expect(screen.queryByLabelText('Scope stock summary')).not.toBeInTheDocument();
    expect(screen.queryByText(/No stock positions match/)).not.toBeInTheDocument();
    expect(screen.getByText(/Last successful update/)).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    await loaded();
  });
  it('polls every 30 seconds only when enabled, preserves local view and stops on unmount', async () => {
    vi.useFakeTimers();
    const view = render(embed());
    await act(async () => {
      await Promise.resolve();
    });
    filters();
    choose('reserved');
    fireEvent.click(screen.getByRole('checkbox', { name: 'Auto-refresh every 30s' }));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(29999);
    });
    expect(state.get).toHaveBeenCalledTimes(1);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1);
    });
    expect(state.get).toHaveBeenCalledTimes(2);
    expect(screen.getByLabelText('Show stock')).toHaveValue('reserved');
    fireEvent.click(screen.getByRole('checkbox', { name: 'Auto-refresh every 30s' }));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(60000);
    });
    expect(state.get).toHaveBeenCalledTimes(2);
    view.unmount();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(60000);
    });
    expect(state.get).toHaveBeenCalledTimes(2);
  });
  it('ages the last successful update even with automatic refresh off', async () => {
    vi.useFakeTimers();
    render(embed());
    await act(async () => {
      await Promise.resolve();
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(315000);
    });
    expect(screen.getByText(/More than five minutes old/)).toBeVisible();
    expect(state.get).toHaveBeenCalledTimes(1);
  });
});
