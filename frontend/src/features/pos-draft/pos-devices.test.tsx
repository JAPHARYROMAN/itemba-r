import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PosDevices } from './pos-devices';

const h = vi.hoisted(() => ({
  params: new URLSearchParams(),
  post: vi.fn(),
  rows: [] as Array<{
    id: string;
    name: string;
    requestedRole: string;
    approvedRole: string | null;
    status: string;
    branchId: string;
  }>,
}));
vi.mock('@/hooks/use-auth', () => ({
  useAuth: () => ({
    hasPermission: (permission: string) => permission === 'mobile_pos_onboarding.manage',
  }),
}));
vi.mock('@/lib/api-client', () => ({
  backendGet: async (path: string) => (path.endsWith('/enrollments') ? h.rows : []),
  backendPost: (...args: unknown[]) => h.post(...args),
}));
vi.mock('./use-draft-scopes', () => ({
  useDraftScopes: () => ({ companies: [], divisions: [], branches: [], error: '' }),
}));
vi.mock('./legacy-quarantine', () => ({ LegacyQuarantine: () => null }));
vi.mock('@/components/westsides/mobile-pos-install/InstallQrCode', () => ({
  InstallQrCode: () => null,
}));
vi.mock('@/components/workspace/workspace-navigation', () => ({
  useWorkspaceSearchParams: () => h.params,
}));
beforeEach(() => {
  h.params = new URLSearchParams();
  h.post.mockReset();
  h.rows = [
    {
      id: 'admin',
      name: 'Admin A',
      requestedRole: 'ADMIN',
      approvedRole: null,
      status: 'PENDING',
      branchId: 'branch',
    },
    {
      id: 'cashier',
      name: 'Cashier B',
      requestedRole: 'CASHIER',
      approvedRole: null,
      status: 'PENDING',
      branchId: 'branch',
    },
  ];
  h.post.mockImplementation(async (path: string, body: { role?: string }) => {
    if (path.endsWith('/approve'))
      h.rows[0] = { ...h.rows[0], status: 'APPROVED', approvedRole: body.role! };
    return {};
  });
});
describe('review mobile access requests', () => {
  it('approves an Admin request as ADMIN before existing-account linking and keeps staff role review available', async () => {
    const user = userEvent.setup();
    render(<PosDevices />);
    const admin = await screen.findByRole('article', { name: 'Admin A' });
    expect(within(admin).queryByLabelText('Approved role')).not.toBeInTheDocument();
    expect(
      within(screen.getByRole('article', { name: 'Cashier B' })).getByLabelText('Approved role'),
    ).toBeVisible();
    await user.click(within(admin).getByRole('button', { name: 'Approve access' }));
    expect(h.post).toHaveBeenCalledWith('/mobile-pos-onboarding/enrollments/admin/approve', {
      role: 'ADMIN',
    });
    expect(
      await screen.findByText(/Waiting for the person to link an existing authorized OS account/),
    ).toBeVisible();
  });
  it('rejects Admin requests only with an explicit reason', async () => {
    const user = userEvent.setup();
    render(<PosDevices />);
    const admin = await screen.findByRole('article', { name: 'Admin A' });
    await user.click(within(admin).getByRole('button', { name: 'Reject request' }));
    expect(h.post).not.toHaveBeenCalled();
    await user.type(within(admin).getByLabelText('Reason'), 'Wrong branch');
    await user.click(within(admin).getByRole('button', { name: 'Reject request' }));
    expect(h.post).toHaveBeenCalledWith('/mobile-pos-onboarding/enrollments/admin/reject', {
      reason: 'Wrong branch',
    });
  });
  it('highlights the notification target without taking focus from another window', async () => {
    h.params = new URLSearchParams({ enrollmentId: 'admin' });
    render(
      <>
        <button>Foreground Sales Desk</button>
        <PosDevices />
      </>,
    );
    const foreground = screen.getByRole('button', { name: 'Foreground Sales Desk' });
    foreground.focus();
    await waitFor(() =>
      expect(screen.getByRole('article', { name: 'Admin A' })).toHaveAttribute(
        'aria-current',
        'true',
      ),
    );
    expect(screen.getByRole('article', { name: 'Cashier B' })).not.toHaveAttribute('aria-current');
    expect(foreground).toHaveFocus();
    expect(h.post).not.toHaveBeenCalled();
  });
});
