import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { FuelGridLauncher } from './fuel-grid-launcher';

const auth = vi.hoisted(() => ({ allowed: true }));

vi.mock('@/hooks/use-auth', () => ({
  useAuth: () => ({
    loading: false,
    hasPermission: (permission: string) => permission === 'fuel_grid.access' && auth.allowed,
  }),
}));

beforeEach(() => {
  auth.allowed = true;
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('Fuel Grid launcher', () => {
  it('opens the configured app in an isolated browser tab', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          configured: true,
          available: true,
          checkedAt: '2026-08-20T10:00:00.000Z',
          latencyMs: 25,
        }),
      }),
    );

    render(<FuelGridLauncher appUrl="https://fuelgrid.example.com" />);

    const link = screen.getByRole('link', { name: /open fuel grid/i });
    expect(link).toHaveAttribute('href', 'https://fuelgrid.example.com');
    expect(link).toHaveAttribute('target', '_blank');
    expect(link).toHaveAttribute('rel', 'noopener noreferrer');
    expect(await screen.findByText('Available')).toBeInTheDocument();
  });

  it('keeps the launcher usable when the advisory status check fails', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')));
    render(<FuelGridLauncher appUrl="https://fuelgrid.example.com" />);

    expect(await screen.findByText('Unavailable')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /open fuel grid/i })).toHaveAttribute(
      'href',
      'https://fuelgrid.example.com',
    );
  });

  it('does not expose the external URL without the access permission', () => {
    auth.allowed = false;
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    render(<FuelGridLauncher appUrl="https://fuelgrid.example.com" />);

    expect(screen.getByText('Fuel Grid is not available to your role')).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /open fuel grid/i })).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('shows a clear configuration state and supports a manual recheck', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        configured: true,
        available: true,
        checkedAt: '2026-08-20T10:00:00.000Z',
        latencyMs: 12,
      }),
    });
    vi.stubGlobal('fetch', fetchMock);

    render(<FuelGridLauncher appUrl="https://fuelgrid.example.com" />);
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    await userEvent.click(screen.getByRole('button', { name: 'Check again' }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
  });
});
