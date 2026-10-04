import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PosDraftWorkspace } from './pos-draft-workspace';
import { contextFixture, draftFixture } from './test-fixtures';
const h = vi.hoisted(() => ({
  params: new URLSearchParams(),
  getDrafts: vi.fn(),
  getDraft: vi.fn(),
  get: vi.fn(),
  permissions: ['pos_drafts.view'],
  devices: vi.fn(),
}));
vi.mock('@/hooks/use-auth', () => ({
  useAuth: () => ({
    loading: false,
    user: { id: 'admin', permissions: h.permissions },
    hasPermission: (permission: string) => h.permissions.includes(permission),
  }),
}));
vi.mock('@/lib/api-client', () => ({
  backendGet: (...args: unknown[]) => h.get(...args),
  backendPatch: vi.fn(),
}));
vi.mock('./api', () => ({
  getDrafts: (...args: unknown[]) => h.getDrafts(...args),
  getDraft: (...args: unknown[]) => h.getDraft(...args),
  getDraftContext: vi.fn(async () => contextFixture),
  decideDraft: vi.fn(),
  submitDraft: vi.fn(),
}));
vi.mock('./pos-devices', () => ({
  PosDevices: () => {
    h.devices();
    return <p>Device management</p>;
  },
}));
vi.mock('@/features/pos/hardware/scanner', () => ({ useScanner: () => undefined }));
vi.mock('@/components/workspace/workspace-navigation', () => {
  const router = { push: vi.fn() };
  return {
    useWorkspacePathname: () => '/pos-draft',
    useWorkspaceSearchParams: () => h.params,
    useWorkspaceRouter: () => router,
    WorkspaceLink: ({ children, ...props }: React.AnchorHTMLAttributes<HTMLAnchorElement>) => (
      <a {...props}>{children}</a>
    ),
  };
});
beforeEach(() => {
  h.params = new URLSearchParams();
  h.permissions = ['pos_drafts.view'];
  h.devices.mockClear();
  h.get.mockReset();
  h.get.mockResolvedValue({
    companies: [{ id: 'company', name: 'Authorized Company' }],
    divisions: [],
    branches: [
      { id: 'branch', name: 'Authorized Branch', companyId: 'company', divisionId: 'division' },
    ],
  });
  h.getDrafts.mockReset();
  h.getDraft.mockReset();
  h.getDrafts.mockImplementation(async (query: { page: number }) => ({
    data: [draftFixture],
    total: 101,
    page: query.page,
    limit: 25,
    capabilities: contextFixture.capabilities,
    summary: { pendingMoney: 100, awaitingApproval: 1, awaitingStockist: 0, readyFinal: 0 },
  }));
});
afterEach(() => vi.restoreAllMocks());
describe('scoped POS Draft review', () => {
  it('loads its own authorized company choices without unrelated master permissions', async () => {
    render(<PosDraftWorkspace />);
    await screen.findByRole('option', { name: 'Authorized Company' });
    expect(h.get).toHaveBeenCalledWith('/pos-drafts/scopes', expect.anything());
    expect(h.get.mock.calls.some((call) => ['/companies', '/branches'].includes(call[0]))).toBe(
      false,
    );
  });
  it('searches the server across pages and resets pagination after the debounce', async () => {
    const user = userEvent.setup();
    render(<PosDraftWorkspace />);
    await screen.findByRole('link', { name: /^Sale / });
    await user.click(screen.getByRole('button', { name: 'Next' }));
    await waitFor(() =>
      expect(h.getDrafts).toHaveBeenLastCalledWith(
        expect.objectContaining({ page: 2 }),
        expect.anything(),
      ),
    );
    await user.type(screen.getByLabelText('Search requests'), 'Customer A');
    await waitFor(() =>
      expect(h.getDrafts).toHaveBeenLastCalledWith(
        expect.objectContaining({ page: 1, search: 'Customer A' }),
        expect.anything(),
      ),
    );
    expect(await screen.findByRole('link', { name: /^Sale / })).toBeVisible();
  });
  it('opens Devices for a manager with the actual onboarding permission and no review access', async () => {
    h.permissions = ['mobile_pos_onboarding.manage'];
    render(<PosDraftWorkspace />);
    await screen.findByText('Device management');
    expect(h.getDrafts).not.toHaveBeenCalled();
    expect(screen.getByRole('link', { name: 'Devices' })).toBeVisible();
    expect(screen.queryByRole('link', { name: 'Pending' })).not.toBeInTheDocument();
  });
  it('keeps rejected requests with unreturned funds in Pending', async () => {
    h.getDrafts.mockResolvedValue({
      data: [{ ...draftFixture, status: 'REJECTED' }],
      total: 1,
      page: 1,
      limit: 25,
      capabilities: contextFixture.capabilities,
      summary: { pendingMoney: 100, awaitingApproval: 0, awaitingStockist: 0, readyFinal: 0 },
    });
    render(<PosDraftWorkspace />);
    expect(await screen.findByText('Rejected · funds to return')).toBeVisible();
  });
  it.each([false, true])(
    'keeps the requested Sales Desk focused when a restored POS detail finishes loading (initially active: %s)',
    async (initiallyActive) => {
      h.params = new URLSearchParams({ record: draftFixture.id, view: 'history' });
      let complete!: (draft: typeof draftFixture) => void;
      h.getDraft.mockReturnValue(new Promise((resolve) => (complete = resolve)));
      const frames: FrameRequestCallback[] = [];
      vi.spyOn(window, 'requestAnimationFrame').mockImplementation((callback) => {
        frames.push(callback);
        return frames.length;
      });
      const activatePos = vi.fn(() =>
        history.replaceState({}, '', `/pos-draft/sales/${draftFixture.id}?view=history`),
      );
      history.replaceState({}, '', '/sales-desk/sales/canonical');
      render(
        <>
          <button>Current Sales Desk</button>
          <section
            className="desktop-window"
            data-active={initiallyActive}
            aria-hidden="false"
            onFocusCapture={activatePos}
          >
            <PosDraftWorkspace />
          </section>
        </>,
      );
      const foreground = screen.getByRole('button', { name: 'Current Sales Desk' });
      foreground.focus();
      await act(async () => complete(draftFixture));
      expect(await screen.findByRole('region', { name: 'Request details' })).toBeVisible();
      await waitFor(() => expect(frames).toHaveLength(1));
      // The explicit route can take focus after the response, before its queued frame.
      screen
        .getByRole('region', { name: 'Request details' })
        .closest('.desktop-window')!
        .setAttribute('data-active', 'false');
      act(() => frames.shift()!(0));
      expect(foreground).toHaveFocus();
      expect(activatePos).not.toHaveBeenCalled();
      expect(location.pathname).toBe('/sales-desk/sales/canonical');
    },
  );
  it.each(['foreground window', 'standalone'])(
    'focuses a loaded detail in the %s',
    async (mode) => {
      h.params = new URLSearchParams({ record: draftFixture.id });
      let complete!: (draft: typeof draftFixture) => void;
      h.getDraft.mockReturnValue(new Promise((resolve) => (complete = resolve)));
      const frames: FrameRequestCallback[] = [];
      vi.spyOn(window, 'requestAnimationFrame').mockImplementation((callback) => {
        frames.push(callback);
        return frames.length;
      });
      const { container } = render(
        mode === 'foreground window' ? (
          <section className="desktop-window" data-active="true" aria-hidden="false">
            <PosDraftWorkspace />
          </section>
        ) : (
          <PosDraftWorkspace />
        ),
      );
      await act(async () => complete(draftFixture));
      await screen.findByRole('region', { name: 'Request details' });
      await waitFor(() => expect(frames).toHaveLength(1));
      act(() => frames.shift()!(0));
      expect(container.querySelector('.pd-detail-pane')).toHaveFocus();
    },
  );
});
