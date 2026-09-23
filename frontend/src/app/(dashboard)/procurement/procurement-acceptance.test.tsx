import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import ProcurementDashboard from '@/app/(dashboard)/procurement/page';
import Requisitions from '@/app/(dashboard)/procurement/requisitions/page';
import Grns from '@/app/(dashboard)/procurement/grns/page';
import SupplierInvoices from '@/app/(dashboard)/procurement/supplier-invoices/page';
import ThreeWay from '@/app/(dashboard)/procurement/three-way-matching/page';

const state = vi.hoisted(() => ({
  permissions: new Set<string>(),
  fetch: vi.fn(),
}));

vi.mock('@/hooks/use-auth', () => ({
  useAuth: () => ({
    hasPermission: (permission: string) => state.permissions.has(permission),
    loading: false,
    user: null,
  }),
}));
vi.mock('@/lib/api-client', () => ({
  ApiError: class ApiError extends Error {},
  backendGet: vi.fn(),
  backendPage: vi.fn(),
  backendList: vi.fn(),
  backendPost: vi.fn(),
  backendPut: vi.fn(),
  backendDelete: vi.fn(),
}));

beforeEach(() => {
  state.permissions = new Set();
  state.fetch.mockReset();
  vi.stubGlobal('fetch', state.fetch);
});

describe('procurement route gates', () => {
  it('does not read the dashboard without procurement.dashboard', () => {
    render(<ProcurementDashboard />);
    expect(screen.getByText('Access Restricted')).toBeInTheDocument();
    expect(state.fetch).not.toHaveBeenCalled();
  });

  it('does not read requisitions without purchase_requisitions.list', () => {
    render(<Requisitions />);
    expect(screen.getByText('Permission required')).toBeInTheDocument();
    expect(state.fetch).not.toHaveBeenCalled();
  });

  it('does not read goods received notes without grn.list', () => {
    render(<Grns />);
    expect(screen.getByText('Access Restricted')).toBeInTheDocument();
    expect(state.fetch).not.toHaveBeenCalled();
  });

  it('does not read supplier invoices without a supplier-invoice view', () => {
    render(<SupplierInvoices />);
    expect(screen.getByText('Access Restricted')).toBeInTheDocument();
    expect(state.fetch).not.toHaveBeenCalled();
  });

  it('does not read three-way matching without three_way_match.list', () => {
    render(<ThreeWay />);
    expect(screen.getByText('Access Restricted')).toBeInTheDocument();
    expect(state.fetch).not.toHaveBeenCalled();
  });

  it('retries a failed procurement dashboard load', async () => {
    state.permissions = new Set(['procurement.dashboard']);
    state.fetch.mockRejectedValue(new Error('Procurement offline'));
    const user = userEvent.setup();
    render(<ProcurementDashboard />);
    expect(await screen.findByRole('button', { name: 'Try again' })).toBeInTheDocument();
    expect(screen.getByText('Procurement offline')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Try again' }));
    expect(state.fetch).toHaveBeenCalledTimes(2);
  });
});
