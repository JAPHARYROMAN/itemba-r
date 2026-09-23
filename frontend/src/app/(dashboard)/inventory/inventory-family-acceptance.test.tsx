import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import InventoryPage from '@/app/(dashboard)/inventory/page';
import MsaidiziPage from '@/app/(dashboard)/msaidizi/page';
import NotificationsPage from '@/app/(dashboard)/notifications/page';
import { MobilePosLite } from '@/components/westsides/mobile-pos-lite/mobile-pos-lite';
import { MobilePosActivation } from '@/components/westsides/mobile-pos-lite/mobile-pos-activation';

const state = vi.hoisted(() => ({
  permissions: new Set<string>(),
  fetch: vi.fn(),
  backendGet: vi.fn(),
  backendPage: vi.fn(),
  backendPost: vi.fn(),
}));

vi.mock('@/hooks/use-auth', () => ({
  useAuth: () => ({
    hasPermission: (permission: string) => state.permissions.has(permission),
    loading: false,
    user: null,
    logout: vi.fn(),
  }),
}));
vi.mock('@/lib/api-client', () => ({
  ApiError: class ApiError extends Error {},
  backendGet: state.backendGet,
  backendPage: state.backendPage,
  backendPost: state.backendPost,
  backendList: vi.fn(),
  backendDelete: vi.fn(),
  backendPatch: vi.fn(),
}));
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
  usePathname: () => '/inventory',
  useParams: () => ({}),
}));

beforeEach(() => {
  state.permissions = new Set();
  state.fetch.mockReset();
  state.backendGet.mockReset();
  state.backendPage.mockReset();
  state.backendPost.mockReset();
  vi.stubGlobal('fetch', state.fetch);
});

describe('inventory, mobile POS, Msaidizi, and notifications', () => {
  it('does not open an inventory workspace without an inventory view', () => {
    render(<InventoryPage />);
    expect(screen.getByText('Inventory access is restricted')).toBeInTheDocument();
    expect(state.fetch).not.toHaveBeenCalled();
    expect(state.backendGet).not.toHaveBeenCalled();
  });

  it('does not boot mobile POS without mobile_pos_lite.use', () => {
    render(<MobilePosLite />);
    expect(screen.getByText('Access Restricted')).toBeInTheDocument();
    expect(state.backendGet).not.toHaveBeenCalled();
    expect(state.fetch).not.toHaveBeenCalled();
  });

  it('does not activate a terminal without mobile_pos_lite.use', () => {
    render(<MobilePosActivation />);
    expect(screen.getByText('Access Restricted')).toBeInTheDocument();
    expect(state.backendPost).not.toHaveBeenCalled();
  });

  it('does not open Msaidizi without msaidizi.use', () => {
    render(<MsaidiziPage />);
    expect(screen.getByText('Msaidizi is not available to your role')).toBeInTheDocument();
    expect(state.fetch).not.toHaveBeenCalled();
    expect(state.backendGet).not.toHaveBeenCalled();
  });

  it('does not read notifications without notifications.view', () => {
    render(<NotificationsPage />);
    expect(screen.getByText('Access Restricted')).toBeInTheDocument();
    expect(state.backendPage).not.toHaveBeenCalled();
    expect(state.backendGet).not.toHaveBeenCalled();
  });

  it('retries a failed notification list', async () => {
    state.permissions = new Set(['notifications.view']);
    state.backendPage.mockRejectedValue(new Error('Notes offline'));
    state.backendGet.mockRejectedValue(new Error('Count offline'));
    const user = userEvent.setup();
    render(<NotificationsPage />);
    expect(await screen.findByRole('button', { name: 'Try again' })).toBeInTheDocument();
    expect(state.backendPage).toHaveBeenCalledTimes(1);
    await user.click(screen.getByRole('button', { name: 'Try again' }));
    expect(state.backendPage).toHaveBeenCalledTimes(2);
  });
});
