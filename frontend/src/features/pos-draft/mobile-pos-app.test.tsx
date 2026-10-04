import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '@/lib/api-client';
import { contextFixture, draftFixture } from './test-fixtures';
import { MobilePosApp } from './mobile-pos-app';
const h = vi.hoisted(() => ({
  api: vi.fn(),
  get: vi.fn(),
  list: vi.fn(),
  device: {
    enrollmentId: 'enrollment',
    deviceSecret: 'a'.repeat(64),
    ownerId: 'operator',
    credentialVersion: 1,
  },
  local: [] as unknown[],
  profile: null as any,
}));
vi.mock('./mobile-api', () => ({
  mobileApi: (...args: unknown[]) => h.api(...args),
  isInstalled: () => true,
  readDevice: () => h.device,
  saveDevice: vi.fn(),
  readPendingEnrollment: () => null,
  readAdminInstallation: () => null,
}));
vi.mock('next/navigation', () => {
  const router = { replace: vi.fn(), push: vi.fn() };
  return { useRouter: () => router };
});
vi.mock('@/lib/api-client', async () => {
  const actual = await vi.importActual<typeof import('@/lib/api-client')>('@/lib/api-client');
  return {
    ...actual,
    backendGet: (...args: unknown[]) => h.get(...args),
    backendList: (...args: unknown[]) => h.list(...args),
  };
});
vi.mock('./capture-store', () => ({
  capturePartition: async (device: typeof h.device) =>
    `${device.enrollmentId}:${device.ownerId}:${device.credentialVersion}`,
  getCaptures: async () => h.local,
  getCachedSession: async () => undefined,
  cacheMobileSession: async () => undefined,
  clearCachedSession: async () => undefined,
  saveCapture: vi.fn(),
  updateCapture: vi.fn(),
}));
vi.mock('@/features/pos/hardware/use-pos-printer', () => ({
  usePosPrinter: () => ({ settings: { paper: '80' }, print: vi.fn() }),
}));
vi.mock('@/features/pos/ui/PrinterPanel', () => ({ PrinterPanel: () => null }));
vi.mock('@/features/pos/ui/ReceiptPrint', () => ({ ReceiptPrint: () => null }));
vi.mock('@/components/westsides/mobile-pos-lite/pos-i18n', () => ({
  usePosLang: () => ({ t: (value: string) => value }),
}));
vi.mock('@/features/pos/hardware/scanner', () => ({ useScanner: () => undefined }));
vi.mock('./pos-devices', () => ({ PosDevices: () => null }));
const page = {
  data: [],
  total: 0,
  page: 1,
  limit: 100,
  capabilities: contextFixture.capabilities,
  summary: { pendingMoney: 0, awaitingApproval: 0, awaitingStockist: 0, readyFinal: 0 },
};
const profile = {
  user: { id: 'operator' },
  operator: { id: 'operator', name: 'Operator A', role: 'CASHIER', credentialVersion: 1 },
  enrollmentId: 'enrollment',
  terminalCode: 'terminal',
  role: 'CASHIER',
  company: { id: 'company', name: 'Company A' },
  division: { id: 'division', name: 'Division A' },
  branch: { id: 'branch', name: 'Branch A' },
  capabilities: { captureSales: true, captureStock: false, dispatchStock: false, approve: false },
};
beforeEach(() => {
  h.api.mockReset();
  h.get.mockReset();
  h.list.mockReset();
  h.list.mockResolvedValue([]);
  h.device = {
    enrollmentId: 'enrollment',
    deviceSecret: 'a'.repeat(64),
    ownerId: 'operator',
    credentialVersion: 1,
  };
  h.profile = profile;
  h.local = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(
      async () =>
        new Response(
          JSON.stringify({ data: { id: 'admin', permissions: ['pos_drafts.approve'] } }),
          { status: 200 },
        ),
    ),
  );
  h.api.mockImplementation(async (path: string) =>
    path.endsWith('/me')
      ? h.profile
      : path.endsWith('/context')
        ? contextFixture
        : path === '/pos-drafts'
          ? page
          : {},
  );
});
describe('mobile session boundaries', () => {
  it('keeps a failed bound staff sign-in on the PIN flow until an explicit admin switch', async () => {
    h.api.mockRejectedValue(new ApiError('Revoked', 403, null));
    render(<MobilePosApp />);
    await screen.findByLabelText('Six-digit PIN');
    expect(fetch).not.toHaveBeenCalled();
    await userEvent
      .setup()
      .click(screen.getByRole('button', { name: 'Use an authorized OS admin account' }));
    await waitFor(() => expect(fetch).toHaveBeenCalledWith('/api/auth/me', expect.anything()));
  });
  it('never submits a locally saved capture automatically when the network session opens', async () => {
    h.local = [
      {
        key: 'capture',
        partition: 'enrollment:operator:1',
        requestId: 'saved',
        state: 'LOCAL',
        submission: { ...draftFixture, requestId: 'saved' },
      },
    ];
    render(<MobilePosApp />);
    await screen.findByText('Operator A');
    expect(
      h.api.mock.calls.some((call) => call[0].includes('/outcome/') || call[1]?.method === 'POST'),
    ).toBe(false);
    await userEvent.setup().click(screen.getByRole('button', { name: 'Requests', exact: true }));
    expect(await screen.findByText('On device · pending submission')).toBeVisible();
    expect(screen.getByText('Request · saved')).toBeVisible();
  });
  it('discards an old request response after device ownership changes', async () => {
    let resolveOld: (value: unknown) => void = () => undefined;
    const oldResponse = new Promise((resolve) => {
      resolveOld = resolve;
    });
    h.api.mockImplementation(async (path: string) =>
      path.endsWith('/me')
        ? h.profile
        : path.endsWith('/context')
          ? contextFixture
          : path === '/pos-drafts'
            ? h.profile.user.id === 'operator'
              ? oldResponse
              : {
                  ...page,
                  data: [
                    {
                      ...draftFixture,
                      id: 'new',
                      requestId: 'new',
                      originUserId: 'other',
                      kind: 'COLLECTION',
                      payload: { amount: 25 },
                      amount: 25,
                    },
                  ],
                }
            : {},
    );
    render(<MobilePosApp />);
    await screen.findByText('Operator A');
    await waitFor(() => expect(h.api).toHaveBeenCalledWith('/pos-drafts', expect.anything()));
    h.device = { ...h.device, ownerId: 'other', enrollmentId: 'new-enrollment' };
    h.profile = {
      ...profile,
      user: { id: 'other' },
      enrollmentId: 'new-enrollment',
      operator: { ...profile.operator, id: 'other', name: 'Operator B' },
    };
    act(() => window.dispatchEvent(new StorageEvent('storage', { key: 'itemba.pos.device.v2' })));
    await screen.findByText('Operator B');
    await userEvent.setup().click(screen.getByRole('button', { name: 'Requests', exact: true }));
    await screen.findByText('Collection');
    await act(async () => {
      resolveOld({ ...page, data: [draftFixture] });
      await oldResponse;
    });
    expect(screen.queryByText('Sale', { exact: true })).not.toBeInTheDocument();
    expect(screen.getByText('Collection')).toBeVisible();
  });
  it('loads every preparation page from the server while retaining the full pending-money summary', async () => {
    h.profile = { ...profile, role: 'STOCKIST' };
    h.api.mockImplementation(
      async (path: string, options?: { query?: Record<string, unknown> }) => {
        if (path.endsWith('/me')) return h.profile;
        if (path.endsWith('/context')) return contextFixture;
        if (path === '/pos-drafts') {
          if (options?.query?.status === 'AWAITING_STOCKIST')
            return {
              ...page,
              page: options.query.page,
              limit: 25,
              total: 26,
              data: [{ ...draftFixture, status: 'AWAITING_STOCKIST' }],
              summary: { ...page.summary, pendingMoney: 100 },
            };
          return { ...page, summary: { ...page.summary, pendingMoney: 999 } };
        }
        return {};
      },
    );
    const user = userEvent.setup();
    render(<MobilePosApp />);
    await screen.findByText('Operator A');
    await user.click(screen.getByRole('button', { name: 'Prepare', exact: true }));
    expect(await screen.findByText('Awaiting preparation')).toBeVisible();
    await screen.findByText(/Page 1 of 2/);
    expect(screen.getByText(/999/)).toBeVisible();
    await user.click(screen.getByRole('button', { name: 'Next', exact: true }));
    await waitFor(() =>
      expect(h.api).toHaveBeenCalledWith('/pos-drafts', {
        query: { page: 2, limit: 25, status: 'AWAITING_STOCKIST' },
      }),
    );
    expect(screen.getByText(/999/)).toBeVisible();
  });
});
