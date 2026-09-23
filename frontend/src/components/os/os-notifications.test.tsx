import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { OsNotifications } from './os-notifications';

const state = vi.hoisted(() => ({ allowed: true, get: vi.fn(), page: vi.fn(), patch: vi.fn() }));
vi.mock('@/hooks/use-auth', () => ({
  useAuth: () => ({ user: { id: 'reader' }, hasPermission: () => state.allowed }),
}));
vi.mock('@/lib/api-client', () => ({
  backendGet: state.get,
  backendPage: state.page,
  backendPatch: state.patch,
}));
const notice = {
  id: 'one',
  title: 'Invoice needs review',
  message: 'A purchase is ready to review.',
  priority: 'HIGH',
  status: 'UNREAD',
  actionUrl: '/invoice-desk',
  createdAt: '2026-09-19T10:00:00Z',
};
beforeEach(() => {
  state.allowed = true;
  state.get.mockReset().mockResolvedValue({ count: 1 });
  state.page.mockReset().mockResolvedValue({ data: [notice] });
  state.patch.mockReset().mockResolvedValue({});
});
describe('OS notification centre', () => {
  it('does not fetch or expose notifications without permission', () => {
    state.allowed = false;
    render(<OsNotifications onNavigate={vi.fn()} />);
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
    expect(state.get).not.toHaveBeenCalled();
    expect(state.page).not.toHaveBeenCalled();
  });
  it('opens a real scoped inbox and follows its safe source link', async () => {
    const navigate = vi.fn();
    render(<OsNotifications onNavigate={navigate} />);
    await userEvent.click(await screen.findByRole('button', { name: 'Notifications, 1 unread' }));
    expect(await screen.findByText('Invoice needs review')).toBeVisible();
    await userEvent.click(screen.getByRole('button', { name: 'Open details' }));
    expect(navigate).toHaveBeenCalledWith('/invoice-desk');
  });
  it('rejects unsafe links and keeps actions retryable after a failure', async () => {
    state.page.mockResolvedValue({ data: [{ ...notice, actionUrl: '//outside.example/collect' }] });
    state.patch.mockRejectedValueOnce(new Error('offline'));
    render(<OsNotifications onNavigate={vi.fn()} />);
    await userEvent.click(await screen.findByRole('button', { name: /Notifications/ }));
    await screen.findByText('Invoice needs review');
    expect(screen.queryByRole('button', { name: 'Open details' })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Mark read', exact: true }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Could not mark');
    expect(screen.getByRole('button', { name: 'Mark read', exact: true })).toBeEnabled();
    await userEvent.click(screen.getByRole('button', { name: 'Mark read', exact: true }));
    expect(state.patch).toHaveBeenLastCalledWith('/notifications/one/read');
  });
  it('shows an actionable load error rather than claiming an empty inbox', async () => {
    state.page.mockRejectedValueOnce(new Error('offline'));
    render(<OsNotifications onNavigate={vi.fn()} />);
    await userEvent.click(await screen.findByRole('button', { name: /Notifications/ }));
    const error = await screen.findByRole('alert');
    expect(error).toHaveTextContent('could not be loaded');
    state.page.mockResolvedValue({ data: [] });
    await userEvent.click(within(error).getByRole('button', { name: 'Try again' }));
    await waitFor(() => expect(screen.getByText('A clear workspace')).toBeVisible());
  });
  it('keeps keyboard focus inside the inbox when the read action disappears', async () => {
    render(<OsNotifications onNavigate={vi.fn()} />);
    await userEvent.click(await screen.findByRole('button', { name: /Notifications/ }));
    await screen.findByText('Invoice needs review');
    state.page.mockResolvedValue({ data: [{ ...notice, status: 'READ' }] });
    state.get.mockResolvedValue({ count: 0 });
    await userEvent.click(screen.getByRole('button', { name: 'Mark read', exact: true }));
    await waitFor(() =>
      expect(
        screen.queryByRole('button', { name: 'Mark read', exact: true }),
      ).not.toBeInTheDocument(),
    );
    expect(screen.getByRole('button', { name: 'Recent', exact: true })).toHaveFocus();
  });
});
