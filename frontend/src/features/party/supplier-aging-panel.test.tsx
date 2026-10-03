import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { SupplierAgingPanel } from './supplier-aging-panel';

const api = vi.hoisted(() => ({ get: vi.fn() }));
vi.mock('@/lib/api-client', () => ({ backendGet: api.get }));

beforeEach(() => {
  vi.resetAllMocks();
});

describe('SupplierAgingPanel', () => {
  it('reads the supplier aging detail for the company and shows every bucket', async () => {
    api.get.mockResolvedValue({
      supplierName: 'Mwanjalisi Station',
      asOf: '2026-10-03T12:00:00.000Z',
      current: 100,
      days1_30: 0,
      days31_60: 150,
      days61_90: 0,
      over90: 0,
      total: 250,
      oldestDaysOverdue: 45,
      payableCount: 2,
    });
    render(<SupplierAgingPanel companyId="c 1" supplierId="sup-1" currency="TZS" />);
    expect(await screen.findByText('Total TZS 250.00')).toBeInTheDocument();
    expect(screen.getByText('31–60 TZS 150.00')).toBeInTheDocument();
    expect(
      screen.getByText(/2 open payables · oldest 45 days overdue · as of 2026-10-03/),
    ).toBeInTheDocument();
    expect(api.get.mock.calls[0][0]).toBe('/financial-reports/supplier-aging-detail/c%201/sup-1');
  });

  it('shows a failed read as unavailable rather than zero', async () => {
    api.get.mockRejectedValue(new Error('Reports offline'));
    render(<SupplierAgingPanel companyId="c1" supplierId="sup-1" />);
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Aging unavailable: Reports offline',
    );
  });
});
