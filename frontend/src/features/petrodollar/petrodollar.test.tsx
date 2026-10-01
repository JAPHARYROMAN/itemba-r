import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { UnsavedWorkProvider, useUnsavedWork } from '@/components/workspace/unsaved-work-provider';
import { ApiError } from '@/lib/api-client';
import { PetroDollarApp, petrodollarView } from './petrodollar-app';

const state = vi.hoisted(() => ({
  get: vi.fn(),
  push: vi.fn(),
  permissions: new Set<string>(),
  search: new URLSearchParams(),
  lock: undefined as undefined | ((locked: boolean) => void),
}));
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: state.push, replace: vi.fn(), back: vi.fn(), forward: vi.fn() }),
  usePathname: () => '/petrodollar',
  useSearchParams: () => state.search,
}));
vi.mock('@/hooks/use-auth', () => ({
  useAuth: () => ({
    loading: false,
    hasPermission: (permission: string) => state.permissions.has(permission),
  }),
}));
vi.mock('@/lib/api-client', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  backendGet: state.get,
}));
// The editor and summary are Fuel Reporting's own, covered by its tests. Here they are probes.
vi.mock('@/components/fuel-reporting/report-editor', () => ({
  ReportEditor: ({
    mode,
    branch,
    onLock,
    apiBase,
  }: {
    mode: string;
    branch: { name: string };
    onLock: (locked: boolean) => void;
    apiBase?: string;
  }) => {
    state.lock = onLock;
    return (
      <section aria-label="Report editor" data-api-base={apiBase}>
        {mode} editor for {branch.name}
      </section>
    );
  },
}));
vi.mock('@/components/fuel-reporting/report-summary', () => ({
  DailySummary: ({ branchName }: { branchName: string }) => <p>Daily for {branchName}</p>,
}));

const mpemba = {
  id: 'a0000000-0000-4000-8000-000000000001',
  name: 'Mpemba',
  companyId: 'mwanjalisi',
  companyName: 'Mwanjalisi Oil',
  companyCode: 'MWANJALISI',
};
const uzunguni = { ...mpemba, id: 'a0000000-0000-4000-8000-000000000002', name: 'Uzunguni' };
const bootstrap = (branches = [mpemba], canAdmin = false) => ({
  company: { id: 'mwanjalisi', code: 'MWANJALISI', name: 'Mwanjalisi Oil' },
  canManage: true,
  canAdmin,
  branches,
});
const workspace = (configured = true) => ({
  catalog: configured
    ? {
        tanks: [
          { id: 't', tankName: 'Tank 1', productId: 'p', capacityLitres: 1, productName: 'x' },
        ],
        nozzles: [
          {
            id: 'n',
            nozzleCode: 'N1',
            pumpId: 'u',
            pumpName: 'P1',
            productId: 'p',
            productName: 'x',
          },
        ],
      }
    : { tanks: [], nozzles: [] },
  report: null,
  previous: null,
  daily: [],
  products: [],
  pumps: [],
});
const history = (count: number) =>
  Array.from({ length: count }, (_, i) => ({
    id: `report-${i}`,
    businessDate: `2026-09-${String(30 - i).padStart(2, '0')}T00:00:00.000Z`,
    shift: 'DAY',
    status: 'CLOSED',
    version: 2,
    summary: { sales: 1500000, flagged: 0 },
  }));
const serve = (overrides: Record<string, unknown> = {}) =>
  state.get.mockImplementation(async (path: string) => {
    if (path in overrides) {
      const value = overrides[path];
      if (value instanceof Error) throw value;
      return value;
    }
    if (path === '/petrodollar/bootstrap') return bootstrap();
    if (path === '/petrodollar/workspace') return workspace();
    if (path === '/petrodollar/history') return [];
    throw new Error(`Unexpected request ${path}`);
  });

beforeEach(() => {
  vi.clearAllMocks();
  state.permissions = new Set(['fuel_reporting.read', 'fuel_reporting.manage']);
  state.search = new URLSearchParams();
  state.lock = undefined;
  window.matchMedia = vi
    .fn()
    .mockReturnValue({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() });
  serve();
});

describe('PetroDollar', () => {
  it('opens only on a known view', () => {
    expect(petrodollarView('daily')).toBe('daily');
    expect(petrodollarView('history')).toBe('history');
    expect(petrodollarView('companies')).toBe('report');
    expect(petrodollarView(null)).toBe('report');
  });

  it('asks for access without fetching anything', () => {
    state.permissions = new Set();
    render(<PetroDollarApp />);
    expect(screen.getByText(/Ask your administrator for station reporting access/)).toBeVisible();
    expect(state.get).not.toHaveBeenCalled();
  });

  it('shows Mwanjalisi only, with no company choice and only PetroDollar requests', async () => {
    render(<PetroDollarApp />);
    expect(await screen.findByRole('region', { name: 'Report editor' })).toHaveTextContent(
      'report editor for Mpemba',
    );
    // Saves, reopens and revisions must go through the company-pinned endpoints too.
    expect(screen.getByRole('region', { name: 'Report editor' })).toHaveAttribute(
      'data-api-base',
      '/petrodollar',
    );
    expect(screen.getAllByText('Mwanjalisi Oil Co Ltd').length).toBeGreaterThan(0);
    expect(screen.queryByRole('combobox', { name: /company/i })).toBeNull();
    expect(screen.queryByRole('combobox', { name: /station/i })).toBeNull();
    const paths = state.get.mock.calls.map(([path]) => path as string);
    expect(paths.length).toBeGreaterThan(0);
    for (const path of paths) expect(path).toMatch(/^\/petrodollar\//);
    expect(state.get).toHaveBeenCalledWith(
      '/petrodollar/workspace',
      expect.objectContaining({
        query: expect.objectContaining({ branchId: mpemba.id, shift: 'DAY' }),
      }),
    );
  });

  it('offers a station choice only when there is more than one', async () => {
    serve({ '/petrodollar/bootstrap': bootstrap([mpemba, uzunguni]) });
    render(<PetroDollarApp />);
    const station = await screen.findByRole('combobox', { name: 'Station' });
    fireEvent.change(station, { target: { value: uzunguni.id } });
    expect(await screen.findByText('report editor for Uzunguni')).toBeVisible();
    expect(state.get).toHaveBeenLastCalledWith(
      '/petrodollar/workspace',
      expect.objectContaining({ query: expect.objectContaining({ branchId: uzunguni.id }) }),
    );
  });

  it('explains a missing company as a set-up problem and retries', async () => {
    serve({ '/petrodollar/bootstrap': new ApiError('not set up', 503, {}) });
    render(<PetroDollarApp />);
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'PetroDollar isn’t set up for Mwanjalisi Oil yet',
    );
    serve();
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(await screen.findByRole('region', { name: 'Report editor' })).toBeVisible();
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('does not offer Mwanjalisi’s absence as a permissions problem on other failures', async () => {
    serve({ '/petrodollar/bootstrap': new Error('Network down') });
    render(<PetroDollarApp />);
    expect(await screen.findByRole('alert')).toHaveTextContent('Network down');
    expect(screen.queryByText(/isn’t set up/)).toBeNull();
  });

  it('points an administrator to station set-up and everyone else to an administrator', async () => {
    serve({ '/petrodollar/bootstrap': bootstrap([], true) });
    const { unmount } = render(<PetroDollarApp />);
    expect(await screen.findByText('No station assigned')).toBeVisible();
    expect(screen.getByText(/No Mwanjalisi station is available to you/)).toBeVisible();
    expect(state.get).not.toHaveBeenCalledWith('/petrodollar/workspace', expect.anything());
    unmount();
    serve({ '/petrodollar/bootstrap': bootstrap([], false) });
    render(<PetroDollarApp />);
    expect(await screen.findByText(/needs to assign you an active Mwanjalisi/)).toBeVisible();
  });

  it('does not open an editor for a station without tanks and pumps', async () => {
    serve({ '/petrodollar/workspace': workspace(false) });
    render(<PetroDollarApp />);
    expect(await screen.findByText(/must set up this station’s tanks and pumps/)).toBeVisible();
    expect(screen.queryByRole('region', { name: 'Report editor' })).toBeNull();
  });

  it('keeps Day and Night and the sections inside the same window history', async () => {
    render(<PetroDollarApp />);
    await screen.findByRole('region', { name: 'Report editor' });
    fireEvent.click(screen.getByRole('button', { name: 'Daily summary' }));
    expect(state.push).toHaveBeenCalledWith('/petrodollar?view=daily');
    fireEvent.click(screen.getByRole('button', { name: 'Shift report' }));
    expect(state.push).toHaveBeenCalledWith('/petrodollar');
    fireEvent.click(screen.getByRole('button', { name: 'Night' }));
    await waitFor(() =>
      expect(state.get).toHaveBeenLastCalledWith(
        '/petrodollar/workspace',
        expect.objectContaining({ query: expect.objectContaining({ shift: 'NIGHT' }) }),
      ),
    );
  });

  it('shows the daily summary view', async () => {
    state.search = new URLSearchParams('view=daily');
    render(<PetroDollarApp />);
    expect(await screen.findByText('Daily for Mpemba')).toBeVisible();
    expect(screen.queryByRole('region', { name: 'Report editor' })).toBeNull();
    expect(screen.queryByRole('group', { name: 'Shift' })).toBeNull();
  });

  it('lists report history for the station and pages older reports', async () => {
    state.search = new URLSearchParams('view=history');
    serve({ '/petrodollar/history': history(50) });
    render(<PetroDollarApp />);
    const table = await screen.findByRole('table');
    expect(await within(table).findAllByText('Open report →')).toHaveLength(50);
    expect(within(table).getAllByText('1,500,000.00')[0]).toBeVisible();
    expect(state.get).toHaveBeenCalledWith('/petrodollar/history', {
      query: { branchId: mpemba.id },
    });
    serve({ '/petrodollar/history': history(2).map((r) => ({ ...r, id: `older-${r.id}` })) });
    fireEvent.click(screen.getByRole('button', { name: 'Load older reports' }));
    await waitFor(() => expect(within(table).getAllByText('Open report →')).toHaveLength(52));
    expect(state.get).toHaveBeenLastCalledWith('/petrodollar/history', {
      query: { branchId: mpemba.id, before: 'report-49' },
    });
    expect(screen.queryByRole('button', { name: 'Load older reports' })).toBeNull();
  });

  it('holds the window steady while a report has unsaved work or is saving', async () => {
    render(<PetroDollarApp />);
    await screen.findByRole('region', { name: 'Report editor' });
    act(() => state.lock!(true));
    expect(screen.getByRole('button', { name: 'Daily summary' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Report history' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Fuel received' })).toBeEnabled();
    expect(screen.getByRole('button', { name: 'Night' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Refresh PetroDollar' })).toBeDisabled();
    act(() => state.lock!(false));
    expect(screen.getByRole('button', { name: 'Daily summary' })).toBeEnabled();
    expect(screen.getByRole('button', { name: 'Night' })).toBeEnabled();
  });

  it('asks before the window is closed with unsaved work, and not once it is saved', async () => {
    const leave = vi.fn();
    function Closer() {
      const guard = useUnsavedWork();
      return <button onClick={() => guard.request(leave, undefined, 'close')}>Close window</button>;
    }
    HTMLDialogElement.prototype.showModal ??= vi.fn();
    HTMLDialogElement.prototype.close ??= vi.fn();
    render(
      <UnsavedWorkProvider>
        <PetroDollarApp />
        <Closer />
      </UnsavedWorkProvider>,
    );
    await screen.findByRole('region', { name: 'Report editor' });
    fireEvent.click(screen.getByRole('button', { name: 'Close window' }));
    expect(leave).toHaveBeenCalledTimes(1);
    leave.mockClear();
    act(() => state.lock!(true));
    fireEvent.click(screen.getByRole('button', { name: 'Close window' }));
    expect(leave).not.toHaveBeenCalled();
    fireEvent.click(await screen.findByRole('button', { name: 'Discard changes', hidden: true }));
    expect(leave).toHaveBeenCalledTimes(1);
    leave.mockClear();
    act(() => state.lock!(false));
    fireEvent.click(screen.getByRole('button', { name: 'Close window' }));
    expect(leave).toHaveBeenCalledTimes(1);
  });
});
