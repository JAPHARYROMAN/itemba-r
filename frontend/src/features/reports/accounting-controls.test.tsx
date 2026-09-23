import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AccountingControlsWorkspace } from './accounting-controls-workspace';
import { AccountingDraftBoundary } from './accounting-drafts';
import {
  controlActions,
  controlDefinitions,
  isControlKind,
  type ControlKind,
  type ControlRecord,
  type DepreciationEntry,
} from './accounting-controls-types';
import { WorkspaceSessionProvider } from '@/components/workspace/workspace-session';
import { WorkspaceDraftsProvider } from '@/components/workspace/workspace-drafts';
import {
  UnsavedWorkProvider,
  UnsavedWorkScope,
} from '@/components/workspace/unsaved-work-provider';
import {
  WorkspaceNavigationProvider,
  WorkspaceLink,
  useWorkspacePathname,
} from '@/components/workspace/workspace-navigation';
import { ApiError } from '@/lib/api-client';
import { setDateField } from '@/test/date-field';

const state = vi.hoisted(() => ({
  get: vi.fn(),
  page: vi.fn(),
  post: vi.fn(),
  permissions: new Set<string>(),
  record: {} as ControlRecord,
  entries: [] as DepreciationEntry[],
  companies: [
    { id: 'company', name: 'Itemba One' },
    { id: 'other', name: 'Itemba Two' },
  ],
}));
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  usePathname: () => '/accounting-engine/posting-runs',
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock('@/hooks/use-auth', () => ({
  useAuth: () => ({
    user: { id: 'operator', companyId: 'company' },
    hasPermission: (p: string) => state.permissions.has(p),
  }),
}));
vi.mock('@/lib/api-client', async (original) => ({
  ...(await original<typeof import('@/lib/api-client')>()),
  backendGet: state.get,
  backendPage: state.page,
  backendPost: state.post,
}));
function Pages() {
  const kind = useWorkspacePathname().split('/').at(-1)!;
  return (
    <AccountingDraftBoundary>
      <WorkspaceLink href="/reports">Reports home</WorkspaceLink>
      {isControlKind(kind) ? <AccountingControlsWorkspace kind={kind} /> : <h1>Reports home</h1>}
    </AccountingDraftBoundary>
  );
}
function Pane({ kind, id = 'main' }: { kind: ControlKind; id?: string }) {
  return (
    <section aria-label={`${id} window`}>
      <UnsavedWorkScope id={id}>
        <WorkspaceNavigationProvider
          appId={`reports-${id}`}
          initialHref={`/accounting-engine/${kind}`}
          ownsPath={(p) => p === '/reports' || p.startsWith('/accounting-engine/')}
        >
          <Pages />
        </WorkspaceNavigationProvider>
      </UnsavedWorkScope>
    </section>
  );
}
function Providers({ children }: { children: React.ReactNode }) {
  return (
    <WorkspaceSessionProvider>
      <UnsavedWorkProvider>
        <WorkspaceDraftsProvider>{children}</WorkspaceDraftsProvider>
      </UnsavedWorkProvider>
    </WorkspaceSessionProvider>
  );
}
function App({ kind = 'posting-runs' }: { kind?: ControlKind }) {
  return (
    <Providers>
      <Pane kind={kind} />
    </Providers>
  );
}
const list = (data: unknown[], total = data.length) => ({ data, total, page: 1, limit: 100 });
const paged = async (path: string, options?: { query?: Record<string, unknown> }) => {
  if (path === '/companies') return list(state.companies);
  const companyId = String(options?.query?.companyId || 'company');
  if (path === '/fiscal-years')
    return list([{ id: 'year', name: '2026', companyId, status: 'OPEN' }]);
  if (path === '/accounting-periods')
    return list([
      { id: 'period', name: 'September', companyId, fiscalYearId: 'year', status: 'OPEN' },
    ]);
  if (path === '/chart-of-accounts')
    return list([
      { id: 'debit', accountCode: '1000', accountName: 'Expense', companyId, isActive: true },
      { id: 'credit', accountCode: '2000', accountName: 'Liability', companyId, isActive: true },
    ]);
  if (path === '/fixed-assets')
    return list([
      {
        id: 'asset',
        name: 'Machine',
        companyId,
        acquisitionCost: '1000',
        residualValue: '0',
        usefulLifeYears: 5,
      },
    ]);
  return list([structuredClone(state.record)]);
};
beforeEach(() => {
  HTMLDialogElement.prototype.showModal = function () {
    this.setAttribute('open', '');
  };
  HTMLDialogElement.prototype.close = function () {
    this.removeAttribute('open');
  };
  state.permissions = new Set([
    'companies.view',
    'fiscal_years.view',
    'accounting_periods.view',
    'chart_of_accounts.view',
    'fixed-assets.read',
    ...Object.values(controlDefinitions).flatMap((d) =>
      ['list', 'view', 'create'].map((a) => `${d.permission}.${a}`),
    ),
    ...Object.values(controlActions).flatMap((rows) => rows.map((a) => a.permission)),
  ]);
  state.record = {
    id: 'record',
    companyId: 'company',
    status: 'DRAFT',
    postingRunNumber: 'PR-01',
    closeNumber: 'PC-01',
    lockCode: 'LOCK-01',
    adjustmentNumber: 'AA-01',
    scheduleNumber: 'DEP-01',
    sourceType: 'MANUAL',
    sourceId: 'SOURCE-01',
    totalDebit: '12.3456',
    totalCredit: '12.3456',
    currency: 'TZS',
    fiscalYearId: 'year',
    accountingPeriodId: 'period',
    fixedAssetId: 'asset',
    depreciationMethod: 'STRAIGHT_LINE',
    startDate: '2026-09-01',
    totalDepreciableAmount: '1000',
    accumulatedDepreciation: '0',
    updatedAt: 'v1',
  };
  state.entries = [
    {
      id: 'entry',
      depreciationDate: '2026-09-01',
      amount: '10',
      accumulatedDepreciationAfter: '10',
      status: 'DRAFT',
    },
  ];
  state.page.mockReset().mockImplementation(paged);
  state.get
    .mockReset()
    .mockImplementation(async (path: string) =>
      path.endsWith('/entries') ? structuredClone(state.entries) : structuredClone(state.record),
    );
  state.post.mockReset().mockResolvedValue({ id: 'saved', created: 2 });
});
async function create(kind: ControlKind) {
  fireEvent.click(
    await screen.findByRole('button', { name: `New ${controlDefinitions[kind].singular}` }),
  );
  await screen.findByRole('textbox', { name: 'Reference' });
  await waitFor(() =>
    expect(screen.queryByText('Loading available choices…')).not.toBeInTheDocument(),
  );
}
function change(label: string, value: string) {
  fireEvent.change(
    within(screen.getByRole('dialog')).getByLabelText(new RegExp(`^${label}\\s*\\*?$`)),
    { target: { value } },
  );
}
async function ack() {
  const dialog = within(screen.getByRole('dialog'));
  for (const box of await dialog.findAllByRole('checkbox'))
    if (!(box as HTMLInputElement).checked) fireEvent.click(box);
}
async function action(kind: ControlKind, actionId: string) {
  fireEvent.click(
    await screen.findByRole('button', {
      name: `Review ${state.record[controlDefinitions[kind].number]}`,
    }),
  );
  const label = controlActions[kind].find((a) => a.id === actionId)!.label;
  fireEvent.click(await screen.findByRole('button', { name: label }));
  await within(screen.getByRole('dialog')).findByRole('checkbox');
  return label;
}
function submit(label: string) {
  fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: label }));
}

describe('Accounting control workspaces', () => {
  it.each(Object.keys(controlDefinitions) as ControlKind[])(
    'renders %s with a keyboard-operable record and fresh detail',
    async (kind) => {
      render(<App kind={kind} />);
      const button = await screen.findByRole('button', {
        name: `Review ${state.record[controlDefinitions[kind].number]}`,
      });
      button.focus();
      await userEvent.setup().keyboard('{Enter}');
      expect(
        await screen.findByRole('heading', {
          name: String(state.record[controlDefinitions[kind].number]),
        }),
      ).toBeVisible();
      expect(state.get).toHaveBeenCalledWith(
        `/${kind}/record`,
        expect.objectContaining({ signal: expect.any(AbortSignal) }),
      );
    },
  );
  it('does not request registers or company directories without list permission', async () => {
    state.permissions.clear();
    render(<App />);
    expect(screen.getByText('Your role cannot list posting runs.')).toBeVisible();
    await act(async () => {});
    expect(state.page).not.toHaveBeenCalled();
    expect(screen.queryByRole('button', { name: 'New posting run' })).not.toBeInTheDocument();
  });
  it('distinguishes a failed register from an empty register and allows retry', async () => {
    state.page.mockImplementationOnce(async () => {
      throw new Error('Register unavailable');
    });
    render(<App />);
    await screen.findByText('Register unavailable');
    expect(screen.queryByText('No records match these filters.')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Retry register' }));
    await screen.findByRole('button', { name: 'Review PR-01' });
  });
  it('reads later pages and searches the complete register', async () => {
    state.page.mockImplementation(async (path, options) =>
      path !== '/posting-runs'
        ? paged(path, options)
        : list(
            options.query.page === 1
              ? Array.from({ length: 100 }, (_, i) => ({
                  ...state.record,
                  id: `r${i}`,
                  postingRunNumber: `PR-${i}`,
                }))
              : [{ ...state.record, id: 'last', postingRunNumber: 'LAST-101' }],
            101,
          ),
    );
    render(<App />);
    await screen.findByText('101 records · Page 1 of 5');
    fireEvent.change(screen.getByLabelText('Search register'), { target: { value: 'LAST-101' } });
    expect(screen.getByRole('button', { name: 'Review LAST-101' })).toBeVisible();
    expect(screen.getByText('1 records · Page 1 of 1')).toBeVisible();
  });
  it('retains independent search input in two windows', async () => {
    render(
      <Providers>
        <Pane kind="posting-runs" id="one" />
        <Pane kind="posting-runs" id="two" />
      </Providers>,
    );
    const one = within(screen.getByRole('region', { name: 'one window' })),
      two = within(screen.getByRole('region', { name: 'two window' }));
    fireEvent.change(one.getByLabelText('Search register'), { target: { value: 'missing' } });
    expect(two.getByLabelText('Search register')).toHaveValue('');
    await two.findByRole('button', { name: 'Review PR-01' });
  });
  it('hides old details when the company changes', async () => {
    render(<App />);
    fireEvent.click(await screen.findByRole('button', { name: 'Review PR-01' }));
    await screen.findByRole('heading', { name: 'PR-01' });
    fireEvent.change(screen.getByLabelText('Company'), { target: { value: 'other' } });
    expect(screen.queryByRole('heading', { name: 'PR-01' })).not.toBeInTheDocument();
  });
  it('retains a posting form through Reports navigation and resumes without writing', async () => {
    render(<App />);
    await create('posting-runs');
    change('Reference', 'PR-RETAINED');
    change('Source reference', 'purchase-123');
    fireEvent.click(screen.getByRole('button', { name: 'Keep draft' }));
    fireEvent.click(screen.getByRole('link', { name: 'Reports home' }));
    await screen.findByRole('heading', { name: 'Reports home' });
    fireEvent.click(screen.getByRole('button', { name: 'Resume New posting run' }));
    expect(await screen.findByRole('textbox', { name: 'Reference' })).toHaveValue('PR-RETAINED');
    expect(screen.getByRole('textbox', { name: 'Source reference' })).toHaveValue('purchase-123');
    expect(state.post).not.toHaveBeenCalled();
  });
  it('retries a rejected create with retained input and a fresh acknowledgement', async () => {
    render(<App />);
    await create('posting-runs');
    change('Reference', 'PR-NEW');
    state.post.mockRejectedValueOnce(new ApiError('Source rejected', 400, {}));
    await ack();
    submit('Create posting run');
    await screen.findByText('Source rejected');
    expect(screen.getByRole('textbox', { name: 'Reference' })).toHaveValue('PR-NEW');
    await ack();
    submit('Create posting run');
    await waitFor(() => expect(state.post).toHaveBeenCalledTimes(2));
    expect(state.post.mock.calls[1][1]).toMatchObject({
      postingRunNumber: 'PR-NEW',
      companyId: 'company',
      sourceType: 'MANUAL',
    });
  });
  it('blocks blind create retries after an uncertain save outcome', async () => {
    render(<App />);
    await create('posting-runs');
    state.post.mockRejectedValueOnce(new Error('Connection lost'));
    await ack();
    submit('Create posting run');
    await screen.findByText('Connection lost');
    expect(screen.getByRole('button', { name: 'Create posting run' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'Keep draft' }));
    fireEvent.click(screen.getByRole('button', { name: 'Resume New posting run' }));
    expect(await screen.findByText(/A save was attempted/)).toBeVisible();
    expect(state.post).toHaveBeenCalledTimes(1);
  });
  it('creates a period-close record with scoped choices and review notes', async () => {
    render(<App kind="period-close" />);
    await create('period-close');
    change('Reference', 'PC-NEW');
    change('Fiscal year', 'year');
    change('Accounting period', 'period');
    change('Review notes', 'Reconciliations reviewed');
    await ack();
    submit('Create period close');
    await waitFor(() =>
      expect(state.post).toHaveBeenCalledWith('/period-close', {
        closeNumber: 'PC-NEW',
        companyId: 'company',
        fiscalYearId: 'year',
        accountingPeriodId: 'period',
        reviewNotes: 'Reconciliations reviewed',
      }),
    );
  });
  it('clears dependent selections when the company changes', async () => {
    render(<App kind="period-close" />);
    await create('period-close');
    change('Fiscal year', 'year');
    change('Accounting period', 'period');
    change('Company', 'other');
    await waitFor(() =>
      expect(screen.queryByText('Loading available choices…')).not.toBeInTheDocument(),
    );
    expect(
      within(screen.getByRole('dialog')).getByRole('combobox', { name: 'Fiscal year' }),
    ).toHaveValue('');
    expect(
      within(screen.getByRole('dialog')).getByRole('combobox', { name: 'Accounting period' }),
    ).toHaveValue('');
  });
  it('rejects a source choice that changed before save', async () => {
    render(<App kind="period-close" />);
    await create('period-close');
    change('Fiscal year', 'year');
    change('Accounting period', 'period');
    state.page.mockImplementation(async (path, options) =>
      path === '/accounting-periods'
        ? list([
            {
              id: 'period',
              name: 'September',
              companyId: 'company',
              fiscalYearId: 'year',
              status: 'CLOSED',
            },
          ])
        : paged(path, options),
    );
    await ack();
    submit('Create period close');
    await screen.findByText(/A selected company, period, account or asset changed/);
    expect(state.post).not.toHaveBeenCalled();
  });
  it('creates an immediately active lock only after the user reviews its scope', async () => {
    render(<App kind="accounting-locks" />);
    await create('accounting-locks');
    change('Reference', 'LOCK-NEW');
    await setDateField(/Locked from/, '2026-09-01', userEvent, screen.getByRole('dialog'));
    await setDateField(/Locked to/, '2026-09-30', userEvent, screen.getByRole('dialog'));
    change('Reason', 'Month-end review');
    expect(screen.getByRole('button', { name: 'Create accounting lock' })).toBeDisabled();
    await ack();
    submit('Create accounting lock');
    await waitFor(() =>
      expect(state.post).toHaveBeenCalledWith(
        '/accounting-locks',
        expect.objectContaining({
          lockCode: 'LOCK-NEW',
          lockedFrom: '2026-09-01',
          lockedTo: '2026-09-30',
          reason: 'Month-end review',
        }),
      ),
    );
  });
  it('creates a balanced audit adjustment with named, scoped accounts', async () => {
    render(<App kind="audit-adjustments" />);
    await create('audit-adjustments');
    change('Description', 'Accrual');
    change('Reason', 'Services received');
    change('Account 1', 'debit');
    change('Debit 1', '120.25');
    change('Account 2', 'credit');
    change('Credit 2', '120.25');
    await ack();
    submit('Create audit adjustment');
    await waitFor(() =>
      expect(state.post).toHaveBeenCalledWith(
        '/audit-adjustments',
        expect.objectContaining({
          description: 'Accrual',
          lines: [
            { accountId: 'debit', description: undefined, debit: 120.25, credit: 0 },
            { accountId: 'credit', description: undefined, debit: 0, credit: 120.25 },
          ],
        }),
      ),
    );
  });
  it('creates an asset schedule using ISO dates and six-place annual rates', async () => {
    render(<App kind="depreciation" />);
    await create('depreciation');
    change('Fixed asset', 'asset');
    await setDateField(/Start date/, '2026-09-01', userEvent, screen.getByRole('dialog'));
    change('Depreciable amount', '1000');
    change('Annual rate', '0.123456');
    await ack();
    submit('Create depreciation schedule');
    await waitFor(() =>
      expect(state.post).toHaveBeenCalledWith(
        '/depreciation',
        expect.objectContaining({
          fixedAssetId: 'asset',
          startDate: '2026-09-01T00:00:00.000Z',
          depreciationRate: 0.123456,
          totalDepreciableAmount: 1000,
        }),
      ),
    );
  });
});

describe('Accounting create read boundaries', () => {
  it('does not expose incomplete company choices after a later page fails', async () => {
    state.page.mockImplementation(async (path, options) => {
      if (path !== '/companies') return paged(path, options);
      if (options.query.page === 2) throw new Error('Company directory unavailable');
      return list(
        Array.from({ length: 100 }, (_, i) => ({ id: `c${i}`, name: `Company ${i}` })),
        101,
      );
    });
    render(<App />);
    await create('posting-runs');
    expect(
      within(screen.getByRole('dialog')).queryByRole('option', { name: 'Company 0' }),
    ).not.toBeInTheDocument();
    expect(
      within(screen.getByRole('dialog')).getByRole('button', { name: 'Create posting run' }),
    ).toBeDisabled();
    state.page.mockImplementation(paged);
    fireEvent.click(screen.getByRole('button', { name: 'Retry choices' }));
    await within(screen.getByRole('dialog')).findByRole('option', { name: 'Itemba One' });
  });
  it('uses the assigned company without requiring the company directory', async () => {
    state.permissions.delete('companies.view');
    render(<App />);
    await create('posting-runs');
    expect(
      within(screen.getByRole('dialog')).getByRole('combobox', { name: 'Company' }),
    ).toHaveValue('company');
    await ack();
    submit('Create posting run');
    await waitFor(() => expect(state.post).toHaveBeenCalledTimes(1));
    expect(state.page.mock.calls.some(([path]) => path === '/companies')).toBe(false);
  });
  it('prevents a write when create permission is revoked during the final directory read', async () => {
    const view = render(<App />);
    await create('posting-runs');
    let resolve!: (value: unknown) => void;
    state.page.mockImplementationOnce(
      () =>
        new Promise((r) => {
          resolve = r;
        }),
    );
    await ack();
    submit('Create posting run');
    // The write saves its draft before it verifies the source, so the read this
    // test controls is a microtask behind the click.
    await waitFor(() => expect(resolve).toBeDefined());
    state.permissions.delete('posting_runs.create');
    view.rerender(<App />);
    await act(async () => resolve(list(state.companies)));
    await screen.findByText(
      'Your current role no longer permits this action. Your input is retained.',
    );
    expect(state.post).not.toHaveBeenCalled();
  });
});

describe('Current accounting action review', () => {
  it('retains an action draft and requires a fresh review after resuming', async () => {
    state.record.status = 'POSTED';
    render(<App kind="audit-adjustments" />);
    await action('audit-adjustments', 'reverse');
    change('Reason for reversal', 'Retained reason');
    await ack();
    fireEvent.click(screen.getByRole('button', { name: 'Keep draft' }));
    fireEvent.click(screen.getByRole('link', { name: 'Reports home' }));
    state.record.updatedAt = 'v2';
    fireEvent.click(screen.getByRole('button', { name: 'Resume Reverse adjustment' }));
    expect(await screen.findByRole('textbox', { name: 'Reason for reversal' })).toHaveValue(
      'Retained reason',
    );
    expect(
      within(screen.getByRole('dialog')).getByRole('button', { name: 'Reverse adjustment' }),
    ).toBeDisabled();
    expect(state.post).not.toHaveBeenCalled();
    await ack();
    submit('Reverse adjustment');
    await waitFor(() =>
      expect(state.post).toHaveBeenCalledWith('/audit-adjustments/record/reverse', {
        reason: 'Retained reason',
      }),
    );
  });
  it.each([
    ['posting-runs', 'post', 'DRAFT'],
    ['posting-runs', 'reverse', 'POSTED'],
    ['period-close', 'close', 'DRAFT'],
    ['period-close', 'reopen', 'CLOSED'],
    ['accounting-locks', 'release', 'ACTIVE'],
    ['audit-adjustments', 'submit', 'DRAFT'],
    ['audit-adjustments', 'approve', 'SUBMITTED'],
    ['audit-adjustments', 'post', 'APPROVED'],
  ] as const)('reviews %s/%s before sending the exact action', async (kind, actionId, status) => {
    state.record.status = status;
    render(<App kind={kind} />);
    const label = await action(kind, actionId);
    expect(within(screen.getByRole('dialog')).getByRole('button', { name: label })).toBeDisabled();
    await ack();
    submit(label);
    await waitFor(() =>
      expect(state.post).toHaveBeenCalledWith(`/${kind}/record/${actionId}`, undefined),
    );
    expect(
      state.get.mock.calls.filter(([p]) => p === `/${kind}/record`).length,
    ).toBeGreaterThanOrEqual(3);
  });
  it('refreshes a changed period-close record without acting on stale details', async () => {
    render(<App kind="period-close" />);
    const label = await action('period-close', 'close');
    state.record.status = 'CLOSED';
    state.record.updatedAt = 'v2';
    await ack();
    submit(label);
    await within(screen.getByRole('dialog')).findByText(
      'This action is unavailable for the current record. Review its latest status before continuing.',
    );
    expect(state.post).not.toHaveBeenCalled();
  });
  it('retains the audit reversal reason through a rejected action', async () => {
    state.record.status = 'POSTED';
    render(<App kind="audit-adjustments" />);
    const label = await action('audit-adjustments', 'reverse');
    change('Reason for reversal', 'Duplicate accrual');
    state.post.mockRejectedValueOnce(new ApiError('Period is locked', 400, {}));
    await ack();
    submit(label);
    await screen.findByText('Period is locked');
    expect(screen.getByRole('textbox', { name: 'Reason for reversal' })).toHaveValue(
      'Duplicate accrual',
    );
    expect(state.post).toHaveBeenCalledWith('/audit-adjustments/record/reverse', {
      reason: 'Duplicate accrual',
    });
  });
  it('prevents duplicate action clicks while refreshing the source', async () => {
    render(<App />);
    const label = await action('posting-runs', 'post');
    let resolve!: (record: ControlRecord) => void;
    state.get.mockImplementationOnce(
      () =>
        new Promise((r) => {
          resolve = r;
        }),
    );
    await ack();
    submit(label);
    submit(label);
    await waitFor(() => expect(resolve).toBeDefined());
    await act(async () => resolve(structuredClone(state.record)));
    await waitFor(() => expect(state.post).toHaveBeenCalledTimes(1));
  });
  it('rechecks action permission after the last source read', async () => {
    const view = render(<App />);
    const label = await action('posting-runs', 'post');
    let resolve!: (record: ControlRecord) => void;
    state.get.mockImplementationOnce(
      () =>
        new Promise((r) => {
          resolve = r;
        }),
    );
    await ack();
    submit(label);
    await waitFor(() => expect(resolve).toBeDefined());
    state.permissions.delete('posting_runs.post');
    view.rerender(<App />);
    await act(async () => resolve(structuredClone(state.record)));
    await screen.findByText(
      'Your current role no longer permits this action. Your input is still here.',
    );
    expect(state.post).not.toHaveBeenCalled();
  });
  it('aborts an outstanding review read on unmount without writing', async () => {
    const view = render(<App />);
    const label = await action('posting-runs', 'post');
    let resolve!: (record: ControlRecord) => void, signal!: AbortSignal;
    state.get.mockImplementationOnce((_, options) => {
      signal = options.signal;
      return new Promise((r) => {
        resolve = r;
      });
    });
    await ack();
    submit(label);
    // Let the verification read reach the network before unmounting out from
    // under it; the abort is the whole subject here.
    await waitFor(() => expect(signal).toBeDefined());
    view.unmount();
    expect(signal.aborted).toBe(true);
    await act(async () => resolve(structuredClone(state.record)));
    expect(state.post).not.toHaveBeenCalled();
  });
  it('reviews both the schedule and existing entries before generating more months', async () => {
    state.record.status = 'ACTIVE';
    render(<App kind="depreciation" />);
    const label = await action('depreciation', 'generate');
    change('Months to generate', '6');
    await ack();
    submit(label);
    await waitFor(() =>
      expect(state.post).toHaveBeenCalledWith('/depreciation/record/generate', { months: 6 }),
    );
    expect(
      state.get.mock.calls.filter(([p]) => p === '/depreciation/record/entries').length,
    ).toBeGreaterThanOrEqual(3);
  });
  it('detects entries added by another operator before generation', async () => {
    state.record.status = 'ACTIVE';
    render(<App kind="depreciation" />);
    const label = await action('depreciation', 'generate');
    state.entries.push({ ...state.entries[0], id: 'other-entry', depreciationDate: '2026-10-01' });
    await ack();
    submit(label);
    await within(screen.getByRole('dialog')).findByText(/2 existing entries/);
    expect(state.post).not.toHaveBeenCalled();
  });
  it('adds a manual entry with the schedule scope and reviewed total', async () => {
    state.record.status = 'ACTIVE';
    render(<App kind="depreciation" />);
    const label = await action('depreciation', 'entries');
    await setDateField(/Depreciation date/, '2026-10-01', userEvent, screen.getByRole('dialog'));
    change('Entry amount', '10');
    change('Accumulated depreciation after', '20');
    await ack();
    submit(label);
    await waitFor(() =>
      expect(state.post).toHaveBeenCalledWith('/depreciation/record/entries', {
        companyId: 'company',
        fixedAssetId: 'asset',
        depreciationDate: '2026-10-01T00:00:00.000Z',
        amount: 10,
        accumulatedDepreciationAfter: 20,
      }),
    );
  });
  it('blocks a manual entry with an inconsistent accumulated amount', async () => {
    state.record.status = 'ACTIVE';
    render(<App kind="depreciation" />);
    const label = await action('depreciation', 'entries');
    await setDateField(/Depreciation date/, '2026-10-01', userEvent, screen.getByRole('dialog'));
    change('Entry amount', '10');
    change('Accumulated depreciation after', '10');
    await ack();
    submit(label);
    await screen.findByText(
      'The accumulated total must equal posted depreciation plus existing draft entries and this amount.',
    );
    expect(state.post).not.toHaveBeenCalled();
  });
  it('posts only a currently draft depreciation entry', async () => {
    state.record.status = 'ACTIVE';
    render(<App kind="depreciation" />);
    fireEvent.click(await screen.findByRole('button', { name: 'Review DEP-01' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Post entry 2026-09-01' }));
    await within(screen.getByRole('dialog')).findByRole('checkbox');
    await ack();
    submit('Post depreciation entry');
    await waitFor(() =>
      expect(state.post).toHaveBeenCalledWith('/depreciation/entries/entry/post'),
    );
  });
});
