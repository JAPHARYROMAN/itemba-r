import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { RecordsApp } from './records-app';
import {
  WorkspaceInstanceProvider,
  WorkspaceSessionProvider,
} from '@/components/workspace/workspace-session';
import { WorkspaceNavigationProvider } from '@/components/workspace/workspace-navigation';
import {
  UnsavedWorkProvider,
  UnsavedWorkScope,
} from '@/components/workspace/unsaved-work-provider';
import { notifyRecordBookChanged } from './record-book-refresh';
import type { DesktopViewState } from '@/lib/desktop-view-state';
const state = vi.hoisted(() => ({
  permissions: new Set<string>(),
  get: vi.fn(),
  page: vi.fn(),
  post: vi.fn(),
  patch: vi.fn(),
  remove: vi.fn(),
  path: '/records',
  query: new URLSearchParams(),
}));
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn() }),
  usePathname: () => state.path,
  useSearchParams: () => state.query,
}));
vi.mock('@/hooks/use-auth', () => ({
  useAuth: () => ({
    user: { id: 'user', permissions: [...state.permissions] },
    loading: false,
    hasPermission: (p: string) => state.permissions.has(p),
  }),
}));
vi.mock('@/lib/api-client', async (original) => ({
  ...(await original<object>()),
  backendGet: state.get,
  backendPage: state.page,
  backendList: vi.fn().mockResolvedValue([]),
  backendPost: state.post,
  backendPatch: state.patch,
  backendDelete: state.remove,
}));
const sale = {
  id: 'old-sale',
  companyId: 'company',
  recordDate: '2026-09-01',
  currency: 'TZS',
  totalSalesAmount: 1200,
  status: 'FINALIZED',
  notes: 'Preserved daily sale',
  receipts: [{ id: 'receipt', receiptType: 'CASH', amount: 1200 }],
  company: { id: 'company', name: 'Example Company', code: 'EX' },
};
beforeEach(() => {
  HTMLDialogElement.prototype.showModal = function () {
    this.setAttribute('open', '');
  };
  HTMLDialogElement.prototype.close = function () {
    this.removeAttribute('open');
  };
  vi.clearAllMocks();
  state.path = '/records';
  state.query = new URLSearchParams();
  state.permissions = new Set(['record_book.view']);
  state.get.mockImplementation(async (path: string) =>
    path === '/record-book/scope-options'
      ? { companies: [sale.company], divisions: [], branches: [] }
      : path === '/record-book/summary'
        ? {
            salesCount: 1,
            expenseCount: 0,
            draftRecords: 0,
            totalRecordedSales: 1200,
            summaryByCurrency: [],
            mixedCurrency: false,
          }
        : path === '/record-book/daily-sales/old-sale'
          ? sale
          : path === '/records/summary'
            ? []
            : path === '/records/directory'
              ? { companies: [], divisions: [], branches: [] }
              : { rows: [], total: 0, pageSize: 25 },
  );
  state.page.mockImplementation(async (path: string) => ({
    data: path === '/record-book/daily-sales' ? [sale] : [],
    total: path === '/record-book/daily-sales' ? 1 : 0,
    page: 1,
    limit: 20,
    totalPages: 1,
  }));
  window.matchMedia = vi
    .fn()
    .mockReturnValue({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() });
});
function AppWindow({
  id,
  href,
  viewState,
}: {
  id: string;
  href: string;
  viewState?: DesktopViewState;
}) {
  return (
    <section aria-label={id}>
      <WorkspaceInstanceProvider id={id} appId="records" viewState={viewState}>
        <UnsavedWorkScope id={id}>
          <WorkspaceNavigationProvider
            appId="records"
            initialHref={href}
            ownsPath={(p) => /^\/(records|record-book)(\/|$)/.test(p)}
          >
            <RecordsApp />
          </WorkspaceNavigationProvider>
        </UnsavedWorkScope>
      </WorkspaceInstanceProvider>
    </section>
  );
}
describe('Records Book inside Records', () => {
  it('returns an existing overview record link to the notebook after closing its detail', async () => {
    state.permissions = new Set(['records.view']);
    const read = state.get.getMockImplementation()!;
    state.get.mockImplementation((path: string) =>
      path === '/records/note'
        ? Promise.resolve({
            id: 'note',
            kind: 'NOTE',
            title: 'Existing note',
            status: 'ACTIVE',
            recordDate: '2026-09-01',
            notes: 'Keep this note',
          })
        : read(path),
    );
    const user = userEvent.setup();
    render(
      <WorkspaceSessionProvider>
        <AppWindow id="Notebook" href="/records?view=overview&record=note" />
      </WorkspaceSessionProvider>,
    );
    const detail = await screen.findByRole('dialog', { name: 'Existing note' });
    await user.click(within(detail).getByRole('button', { name: 'Close', exact: true }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(screen.getByRole('heading', { name: 'Overview', exact: true })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Notebook overview', exact: true })).toHaveAttribute(
      'aria-current',
      'page',
    );
  });
  it('restores a saved register page and filters without resetting them on mount', async () => {
    render(
      <WorkspaceSessionProvider>
        <AppWindow
          id="Restored"
          href="/records/daily-sales"
          viewState={{
            version: 1,
            values: {
              'records.book.filters': {
                companyId: 'company',
                divisionId: '',
                branchId: '',
                dateFrom: '',
                dateTo: '',
                status: 'DRAFT',
                currency: 'TZS',
                search: 'saved reference',
              },
              'records.book.sales.page': 3,
            },
          }}
        />
      </WorkspaceSessionProvider>,
    );
    await screen.findByRole('link', { name: 'View' });
    expect(screen.getByRole('textbox', { name: 'Search' })).toHaveValue('saved reference');
    const reads = state.page.mock.calls.filter(([path]) => path === '/record-book/daily-sales');
    expect(reads.length).toBeGreaterThan(0);
    expect(
      reads.every(
        ([, options]) => options.query.page === 3 && options.query.search === 'saved reference',
      ),
    ).toBe(true);
  });
  it('opens the existing register for an existing Records Book reader without copying or posting', async () => {
    state.path = '/record-book/daily-sales';
    render(<RecordsApp />);
    const link = await screen.findByRole('link', { name: 'View' });
    expect(link).toHaveAttribute('href', '/records/daily-sales/old-sale');
    expect(state.page).toHaveBeenCalledWith('/record-book/daily-sales', expect.anything());
    expect(state.get.mock.calls.some(([path]) => path.startsWith('/records/'))).toBe(false);
    expect(state.post).not.toHaveBeenCalled();
    expect(state.patch).not.toHaveBeenCalled();
    expect(state.remove).not.toHaveBeenCalled();
  });
  it.each([
    ['records.view', '/records/daily-sales'],
    ['record_book.view', '/records?view=debtors'],
  ])('does not broaden %s into the other register', async (permission, href) => {
    state.permissions = new Set([permission]);
    const url = new URL(href, 'https://local.test');
    state.path = url.pathname;
    state.query = url.searchParams;
    render(<RecordsApp />);
    expect(screen.getByText(/current role does not have access/)).toBeInTheDocument();
    expect(state.get).not.toHaveBeenCalled();
    expect(state.page).not.toHaveBeenCalled();
  });
  it('retains separate window searches when navigating to details and returning', async () => {
    const user = userEvent.setup();
    render(
      <WorkspaceSessionProvider>
        <UnsavedWorkProvider>
          <AppWindow id="First" href="/records/daily-sales" />
          <AppWindow id="Second" href="/record-book/daily-sales" />
        </UnsavedWorkProvider>
      </WorkspaceSessionProvider>,
    );
    const first = within(screen.getByRole('region', { name: 'First' })),
      second = within(screen.getByRole('region', { name: 'Second' }));
    const search = await first.findByRole('textbox', { name: 'Search' });
    await second.findByRole('link', { name: 'View' });
    await user.type(search, 'first only');
    expect(await second.findByRole('textbox', { name: 'Search' })).toHaveValue('');
    await user.click(await first.findByRole('link', { name: 'View' }));
    await first.findByText('Preserved daily sale');
    expect(state.get).toHaveBeenCalledWith('/record-book/daily-sales/old-sale', expect.anything());
    await user.click(first.getByRole('link', { name: 'Back to list' }));
    expect(await first.findByRole('textbox', { name: 'Search' })).toHaveValue('first only');
    expect(second.getByRole('textbox', { name: 'Search' })).toHaveValue('');
  });
  it('warns before discarding edited daily sales and defers sibling refresh until the form closes', async () => {
    state.permissions.add('record_book.create');
    const user = userEvent.setup();
    render(
      <WorkspaceSessionProvider>
        <UnsavedWorkProvider>
          <AppWindow id="Editor" href="/records/daily-sales" />
        </UnsavedWorkProvider>
      </WorkspaceSessionProvider>,
    );
    await user.click(await screen.findByRole('button', { name: '+ Daily Sales' }));
    const modal = screen.getByRole('dialog', { name: 'New Daily Sales Record' });
    const notes = within(modal).getAllByLabelText('Notes').at(-1)!;
    await user.type(notes, 'Unsaved daily note');
    const before = state.page.mock.calls.length;
    act(() => notifyRecordBookChanged());
    expect(notes).toHaveValue('Unsaved daily note');
    expect(state.page.mock.calls.length).toBe(before);
    await user.click(within(modal).getByRole('button', { name: 'Cancel' }));
    expect(await screen.findByRole('button', { name: 'Stay here' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Stay here' }));
    expect(notes).toHaveValue('Unsaved daily note');
    await user.click(within(modal).getByRole('button', { name: 'Cancel' }));
    await user.click(await screen.findByRole('button', { name: 'Discard changes' }));
    await waitFor(() =>
      expect(
        screen.queryByRole('dialog', { name: 'New Daily Sales Record' }),
      ).not.toBeInTheDocument(),
    );
    await waitFor(() => expect(state.page.mock.calls.length).toBeGreaterThan(before));
    expect(state.post).not.toHaveBeenCalled();
  });
});
