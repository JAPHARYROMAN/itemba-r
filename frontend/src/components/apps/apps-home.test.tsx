import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { AppsHome } from './apps-home';
import { DEFAULT_WORKSPACE, updateWorkspace, workspaceKey } from '@/lib/workspace-preferences';
const auth = vi.hoisted(() => ({ allowed: true, loading: false, id: 'apps-reader' }));
vi.mock('@/hooks/use-auth', () => ({
  useAuth: () => ({
    user: { id: auth.id },
    loading: auth.loading,
    hasPermission: (permission: string) => auth.allowed && permission === 'fuel_grid.access',
  }),
}));
beforeEach(() => {
  auth.allowed = true;
  auth.loading = false;
  auth.id = 'apps-reader';
  localStorage.clear();
});
describe('Apps workspace', () => {
  it('opens the launcher and searches by purpose', async () => {
    render(<AppsHome />);
    expect(screen.getByRole('link', { name: 'Open Fuel Grid' })).toHaveAttribute(
      'href',
      '/fuel-grid',
    );
    await userEvent.type(screen.getByRole('searchbox', { name: 'Search apps' }), 'petroleum');
    expect(screen.getByRole('link', { name: 'Open Fuel Grid' })).toBeVisible();
    await userEvent.clear(screen.getByRole('searchbox'));
    await userEvent.type(screen.getByRole('searchbox'), 'notes');
    expect(screen.getByText('No matching apps')).toBeVisible();
    await userEvent.click(screen.getByRole('button', { name: 'Clear search' }));
    expect(screen.getByRole('link', { name: 'Open Fuel Grid' })).toBeVisible();
  });
  it('persists app pins for the current account and supports pinning the ERP', async () => {
    updateWorkspace(auth.id, (value) => ({ ...value, pinnedApps: [] }));
    render(<AppsHome onOpenErp={vi.fn()} />);
    await userEvent.click(screen.getByRole('button', { name: 'Pin ITEMBA-R', exact: true }));
    await userEvent.click(screen.getByRole('button', { name: 'Pin Fuel Grid', exact: true }));
    expect(JSON.parse(localStorage.getItem(workspaceKey(auth.id))!).pinnedApps).toEqual([
      'itemba-r',
      'fuel-grid',
    ]);
    await userEvent.click(screen.getByRole('button', { name: 'Pinned', exact: true }));
    expect(screen.getByRole('button', { name: 'Launch ITEMBA-R' })).toBeVisible();
    await userEvent.click(screen.getByRole('button', { name: 'Unpin Fuel Grid' }));
    expect(screen.queryByRole('link', { name: 'Open Fuel Grid' })).not.toBeInTheDocument();
  });
  it('never uses another account’s pins or recent apps', () => {
    localStorage.setItem(
      workspaceKey('other-user'),
      JSON.stringify({ ...DEFAULT_WORKSPACE, pinnedApps: ['settings'], recentApps: ['fuel-grid'] }),
    );
    render(<AppsHome />);
    expect(screen.queryByRole('region', { name: 'Recently opened apps' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Unpin Fuel Grid' })).toBeVisible();
  });
  it('filters inaccessible and unregistered apps from saved recents', () => {
    updateWorkspace(auth.id, (value) => ({ ...value, recentApps: ['unregistered', 'fuel-grid'] }));
    const { rerender } = render(<AppsHome />);
    const recent = screen.getByRole('region', { name: 'Recently opened apps' });
    expect(within(recent).getByRole('link', { name: 'Fuel Grid' })).toBeVisible();
    expect(within(recent).queryByText('unregistered')).not.toBeInTheDocument();
    auth.allowed = false;
    rerender(<AppsHome />);
    expect(screen.getByRole('link', { name: 'Open Reports' })).toBeVisible();
    expect(screen.queryByRole('region', { name: 'Recently opened apps' })).not.toBeInTheDocument();
    expect(screen.queryByText('Fuel Grid')).not.toBeInTheDocument();
  });
  it('waits for permissions before showing apps', () => {
    auth.loading = true;
    render(<AppsHome />);
    expect(screen.getByText('Getting your apps ready')).toBeVisible();
    expect(screen.queryByRole('link', { name: 'Open Fuel Grid' })).not.toBeInTheDocument();
  });
});
