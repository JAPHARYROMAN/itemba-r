import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import CustomerProfile from '@/app/(dashboard)/westsides/customers/[id]/page';
import QuotationPrint from '@/app/(dashboard)/westsides/quotations/[id]/print/page';
import DeliveryNotes from '@/app/(dashboard)/westsides/delivery-notes/page';

const state = vi.hoisted(() => ({
  permissions: new Set<string>(),
  get: vi.fn(),
  page: vi.fn(),
}));

vi.mock('@/hooks/use-auth', () => ({
  useAuth: () => ({
    hasPermission: (permission: string) => state.permissions.has(permission),
    loading: false,
    user: null,
  }),
}));
vi.mock('next/navigation', () => ({
  useParams: () => ({ id: 'record-1' }),
  useRouter: () => ({ push: vi.fn() }),
  usePathname: () => '/westsides',
}));
vi.mock('@/lib/api-client', () => ({
  backendGet: (...args: unknown[]) => state.get(...args),
  backendList: vi.fn().mockResolvedValue([]),
  backendPage: (...args: unknown[]) => state.page(...args),
  backendPatch: vi.fn(),
  backendPost: vi.fn(),
  backendDelete: vi.fn(),
  ApiError: class ApiError extends Error {},
}));

beforeEach(() => {
  state.permissions = new Set();
  state.get.mockReset();
  state.page.mockReset();
  vi.stubGlobal('fetch', vi.fn());
});

describe('westsides route gates', () => {
  it('does not read a customer profile without customers.view', () => {
    render(<CustomerProfile />);
    expect(screen.getByText('Access Restricted')).toBeInTheDocument();
    expect(fetch).not.toHaveBeenCalled();
  });

  it('does not read delivery notes without delivery_notes.view', () => {
    render(<DeliveryNotes />);
    expect(screen.getByText('Access restricted')).toBeInTheDocument();
    expect(fetch).not.toHaveBeenCalled();
  });

  it('retries a failed quotation print', async () => {
    state.permissions = new Set(['quotations.view']);
    state.get.mockRejectedValue(new Error('Print source unavailable'));
    const user = userEvent.setup();
    render(<QuotationPrint />);
    expect(await screen.findByRole('button', { name: 'Try again' })).toBeInTheDocument();
    expect(screen.getByText('Print source unavailable')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Try again' }));
    expect(state.get).toHaveBeenCalledTimes(2);
  });
});
