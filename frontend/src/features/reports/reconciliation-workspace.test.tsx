import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import BankReconciliationsPage from '@/app/(dashboard)/accounting-engine/bank-reconciliations/page';
import { AccountingDraftBoundary } from './accounting-drafts';
import {
  reconciliationActions,
  type Reconciliation,
  type ReconciliationEvidence,
  type MatchingResult,
} from './reconciliation-types';
import { WorkspaceSessionProvider } from '@/components/workspace/workspace-session';
import { WorkspaceDraftsProvider } from '@/components/workspace/workspace-drafts';
import {
  UnsavedWorkProvider,
  UnsavedWorkScope,
} from '@/components/workspace/unsaved-work-provider';
import {
  WorkspaceLink,
  WorkspaceNavigationProvider,
  useWorkspacePathname,
} from '@/components/workspace/workspace-navigation';
import { setDateField } from '@/test/date-field';

const state = vi.hoisted(() => ({
  get: vi.fn(),
  page: vi.fn(),
  post: vi.fn(),
  permissions: new Set<string>(),
  record: {} as Reconciliation,
  evidence: {} as ReconciliationEvidence,
  matching: {} as MatchingResult,
}));
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  usePathname: () => '/accounting-engine/bank-reconciliations',
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
const path = '/bank-reconciliations/rec',
  route = '/accounting-engine/bank-reconciliations';
const header = 'date,description,reference,debit,credit\n';
const csv = header + '2026-09-20,Supplier payment,P1,25.1250,0\n';
function Pages() {
  const pathname = useWorkspacePathname();
  return (
    <AccountingDraftBoundary>
      <nav>
        <WorkspaceLink href="/reports">Reports home</WorkspaceLink>
        <WorkspaceLink href={route}>Open reconciliations</WorkspaceLink>
      </nav>
      {pathname === route ? <BankReconciliationsPage /> : <h1>Reports home</h1>}
    </AccountingDraftBoundary>
  );
}
function Pane({ id = 'main' }: { id?: string }) {
  return (
    <section aria-label={`${id} window`}>
      <UnsavedWorkScope id={id}>
        <WorkspaceNavigationProvider
          appId={`reports-${id}`}
          initialHref={route}
          ownsPath={(p) => p === route || p === '/reports'}
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
function App() {
  return (
    <Providers>
      <Pane />
    </Providers>
  );
}
const read = async (url: string) => {
  if (url === path) return structuredClone(state.record);
  if (url === `${path}/evidence`) return structuredClone(state.evidence);
  throw new Error(`Unexpected read ${url}`);
};
beforeEach(() => {
  HTMLDialogElement.prototype.showModal = function () {
    this.setAttribute('open', '');
  };
  HTMLDialogElement.prototype.close = function () {
    this.removeAttribute('open');
  };
  state.permissions = new Set([
    'bank_reconciliations.list',
    'bank_reconciliations.view',
    'bank_reconciliations.create',
    'bank_reconciliations.update',
    'bank_reconciliations.approve',
    'bank_reconciliations.close',
    'companies.view',
    'cash_accounts.view',
  ]);
  state.record = {
    id: 'rec',
    reconciliationNumber: 'BR-01',
    companyId: 'company',
    cashAccountId: 'bank',
    currency: 'USD',
    status: 'DRAFT',
    updatedAt: 'v1',
    statementStartDate: '2026-09-01',
    statementEndDate: '2026-09-30',
    statementOpeningBalance: '0',
    statementClosingBalance: '25',
    bookOpeningBalance: '0',
    bookClosingBalance: '25',
    reconciledBalance: '0',
    differenceAmount: '25',
    statementLines: [
      {
        id: 'line',
        transactionDate: '2026-09-20',
        description: 'Existing line',
        reference: 'E1',
        debitAmount: '0',
        creditAmount: '25',
        matched: false,
      },
    ],
    matches: [],
  };
  state.evidence = {
    ready: true,
    issues: [],
    calculatedClose: '25.00',
    note: 'Exact statement and journal checks.',
  };
  state.matching = {
    summary: { totalLines: 1, autoMatched: 0, ambiguous: 1, stillUnmatched: 0 },
    perLine: [
      {
        lineId: 'line',
        suggestions: [
          {
            entityId: 'journal-line',
            date: '2026-09-20',
            description: 'Cash receipt journal',
            amount: 25,
          },
        ],
      },
    ],
  };
  state.get.mockReset().mockImplementation(read);
  state.page.mockReset().mockImplementation(async (url: string) => {
    const data =
      url === '/companies'
        ? [{ id: 'company', name: 'Company' }]
        : url === '/cash-accounts'
          ? [
              {
                id: 'bank',
                companyId: 'company',
                accountName: 'Main Bank',
                currency: 'USD',
                isActive: true,
              },
            ]
          : url === '/bank-reconciliations'
            ? [structuredClone(state.record)]
            : [];
    return { data, total: data.length, page: 1, limit: 25 };
  });
  state.post
    .mockReset()
    .mockImplementation(async (url: string) =>
      url.endsWith('/import')
        ? { imported: 1, skipped: 0 }
        : url.endsWith('/run-matching')
          ? structuredClone(state.matching)
          : { id: 'saved' },
    );
});
async function openDetail() {
  fireEvent.click(await screen.findByRole('button', { name: 'Review BR-01' }));
  await screen.findByRole('button', { name: 'Import CSV' });
}
async function openImport() {
  await openDetail();
  fireEvent.click(screen.getByRole('button', { name: 'Import CSV' }));
  await screen.findByLabelText('Choose statement CSV');
}
async function upload(text = csv, name = 'statement.csv') {
  const file = new File([text], name, { type: 'text/csv' });
  Object.defineProperty(file, 'text', { value: vi.fn().mockResolvedValue(text) });
  fireEvent.change(screen.getByLabelText('Choose statement CSV'), { target: { files: [file] } });
  await waitFor(() => expect(screen.queryByText('Reading statement CSV…')).not.toBeInTheDocument());
}
async function acknowledge() {
  const dialog = within(screen.getByRole('dialog'));
  for (const box of await dialog.findAllByRole('checkbox'))
    if (!(box as HTMLInputElement).checked) fireEvent.click(box);
}
async function fillCreate() {
  fireEvent.click(screen.getByRole('button', { name: 'New reconciliation' }));
  fireEvent.change(await screen.findByRole('textbox', { name: 'Reconciliation number' }), {
    target: { value: 'BR-NEW' },
  });
  const field = screen.getByRole('combobox', { name: 'Cash account' });
  await waitFor(() =>
    expect(within(field).getByRole('option', { name: 'Main Bank · USD' })).toBeInTheDocument(),
  );
  fireEvent.change(field, { target: { value: 'bank' } });
  await setDateField('Statement start', '2026-09-01');
  await setDateField('Statement end', '2026-09-30');
}
describe('Reconciliation register and drafts', () => {
  it('retains a new reconciliation through navigation and a failed save without changing its number', async () => {
    render(<App />);
    await fillCreate();
    fireEvent.change(screen.getByRole('textbox', { name: 'Statement opening balance' }), {
      target: { value: '-25.125' },
    });
    fireEvent.change(screen.getByRole('textbox', { name: 'Notes' }), {
      target: { value: 'Month-end checks' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Keep draft' }));
    fireEvent.click(screen.getByRole('link', { name: 'Reports home' }));
    await screen.findByRole('heading', { name: 'Reports home' });
    fireEvent.click(screen.getByRole('button', { name: 'Resume New reconciliation' }));
    expect(await screen.findByRole('textbox', { name: 'Reconciliation number' })).toHaveValue(
      'BR-NEW',
    );
    await waitFor(() =>
      expect(screen.getByRole('combobox', { name: 'Cash account' })).toHaveTextContent('Main Bank'),
    );
    state.post.mockRejectedValueOnce(new Error('Save unavailable'));
    fireEvent.click(screen.getByRole('button', { name: 'Create reconciliation' }));
    await screen.findByText('Save unavailable');
    expect(screen.getByRole('textbox', { name: 'Notes' })).toHaveValue('Month-end checks');
    fireEvent.click(screen.getByRole('button', { name: 'Create reconciliation' }));
    await waitFor(() => expect(state.post).toHaveBeenCalledTimes(2));
    expect(state.post.mock.calls[1]).toEqual([
      '/bank-reconciliations',
      expect.objectContaining({
        reconciliationNumber: 'BR-NEW',
        cashAccountId: 'bank',
        statementOpeningBalance: -25.125,
        notes: 'Month-end checks',
      }),
    ]);
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  });
  it('loads complete cash-account choices and preserves the form when a later choice page fails', async () => {
    const baseline = state.page.getMockImplementation()!;
    state.page.mockImplementation(async (url: string, options: { query: { page: number } }) => {
      if (url === '/cash-accounts') {
        if (options.query.page === 1)
          return {
            data: [
              { id: 'first', companyId: 'company', accountName: 'First account', currency: 'USD' },
            ],
            total: 2,
          };
        throw new Error('Second account page failed');
      }
      return baseline(url, options);
    });
    render(<App />);
    fireEvent.click(screen.getByRole('button', { name: 'New reconciliation' }));
    fireEvent.change(await screen.findByRole('textbox', { name: 'Reconciliation number' }), {
      target: { value: 'KEEP-CODE' },
    });
    await screen.findByRole('button', { name: 'Retry cash accounts' });
    expect(
      within(screen.getByRole('combobox', { name: 'Cash account' })).queryByRole('option', {
        name: 'First account · USD',
      }),
    ).not.toBeInTheDocument();
    state.page.mockImplementation(baseline);
    fireEvent.click(screen.getByRole('button', { name: 'Retry cash accounts' }));
    await screen.findByRole('option', { name: 'Main Bank · USD' });
    expect(screen.getByRole('textbox', { name: 'Reconciliation number' })).toHaveValue('KEEP-CODE');
  });
  it('validates periods and rejects numeric precision loss instead of rounding opening balances', async () => {
    render(<App />);
    await fillCreate();
    await setDateField('Statement end', '2026-08-31');
    fireEvent.click(screen.getByRole('button', { name: 'Create reconciliation' }));
    await screen.findByText(/valid statement period/);
    await setDateField('Statement end', '2026-09-30');
    fireEvent.change(screen.getByRole('textbox', { name: 'Statement opening balance' }), {
      target: { value: '99999999999999.9999' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Create reconciliation' }));
    await screen.findByText(/too precise/);
    expect(state.post).not.toHaveBeenCalled();
  });
  it('uses the assigned company without an unavailable organisation directory', async () => {
    state.permissions.delete('companies.view');
    render(<App />);
    await fillCreate();
    expect(
      within(screen.getByRole('dialog')).getByRole('combobox', { name: 'Company' }),
    ).toBeDisabled();
    expect(state.page.mock.calls.some(([url]) => url === '/companies')).toBe(false);
  });
  it('reports failed register reads and supports retry instead of showing an empty list', async () => {
    const baseline = state.page.getMockImplementation()!;
    state.page.mockImplementation(async (url: string, options: unknown) => {
      if (url === '/bank-reconciliations') throw new Error('Register unavailable');
      return baseline(url, options);
    });
    render(<App />);
    await screen.findByText('Register unavailable');
    expect(screen.queryByText('No reconciliations match these filters.')).not.toBeInTheDocument();
    state.page.mockImplementation(baseline);
    fireEvent.click(screen.getByRole('button', { name: 'Retry reconciliations' }));
    await screen.findByRole('button', { name: 'Review BR-01' });
  });
  it('retains each window’s filters and fetches later register pages', async () => {
    const baseline = state.page.getMockImplementation()!;
    state.page.mockImplementation(async (url: string, options: { query: { page: number } }) =>
      url === '/bank-reconciliations'
        ? { data: [structuredClone(state.record)], total: 26 }
        : baseline(url, options),
    );
    render(
      <Providers>
        <Pane id="left" />
        <Pane id="right" />
      </Providers>,
    );
    const left = within(screen.getByRole('region', { name: 'left window' })),
      right = within(screen.getByRole('region', { name: 'right window' }));
    await left.findByRole('button', { name: 'Review BR-01' });
    fireEvent.change(left.getByRole('combobox', { name: 'Status' }), {
      target: { value: 'DRAFT' },
    });
    expect(right.getByRole('combobox', { name: 'Status' })).toHaveValue('');
    fireEvent.click(await left.findByRole('button', { name: 'Next page' }));
    await waitFor(() =>
      expect(state.page).toHaveBeenCalledWith(
        '/bank-reconciliations',
        expect.objectContaining({ query: expect.objectContaining({ page: 2, status: 'DRAFT' }) }),
      ),
    );
  });
  it('does not read the register or expose write actions without permission', async () => {
    state.permissions.clear();
    render(<App />);
    await screen.findByText('Your role cannot list reconciliations.');
    expect(state.get).not.toHaveBeenCalled();
    expect(state.page).not.toHaveBeenCalled();
    expect(screen.queryByRole('button', { name: 'New reconciliation' })).not.toBeInTheDocument();
  });
});
describe('Statement CSV review', () => {
  it('keeps a parsed file through guarded navigation and resumes without importing it', async () => {
    const user = userEvent.setup();
    render(<App />);
    await openImport();
    await upload();
    await user.click(screen.getByRole('link', { name: 'Reports home' }));
    await user.click(screen.getByRole('button', { name: /Keep draft and continue/ }));
    await screen.findByRole('heading', { name: 'Reports home' });
    expect(state.post).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: 'Resume Statement CSV import' }));
    expect(await screen.findByText('statement.csv')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Import 1 lines' })).toBeDisabled();
    await acknowledge();
    fireEvent.click(screen.getByRole('button', { name: 'Import 1 lines' }));
    await waitFor(() =>
      expect(state.post).toHaveBeenCalledWith(`${path}/import`, {
        rows: [
          {
            transactionDate: '2026-09-20',
            description: 'Supplier payment',
            reference: 'P1',
            debitAmount: '25.1250',
            creditAmount: '0',
          },
        ],
      }),
    );
    await screen.findByText('1 lines imported; 0 exact duplicate lines skipped.');
  });
  it('previews all rows, references and exact file totals across pages', async () => {
    render(<App />);
    await openImport();
    await upload(
      header +
        Array.from(
          { length: 30 },
          (_, index) =>
            `2026-09-20,Row ${index},P${index},${index === 0 ? '99999999999999.9999' : '0.0001'},0`,
        ).join('\n'),
    );
    expect(screen.getByText(/100,000,000,000,000.0028/)).toBeInTheDocument();
    expect(screen.queryByText('Row 29')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Next lines' }));
    expect(screen.getByText('Row 29')).toBeVisible();
    expect(screen.getByText('P29')).toBeVisible();
    expect(screen.getByRole('button', { name: 'Next lines' })).toBeDisabled();
  });
  it.each([
    ['wrong dates', header + '2026-08-31,Outside,P1,10,0\n', 'outside this statement period'],
    ['malformed file', header + '2026-09-20,Both sides,P1,10,10\n', 'exactly one positive'],
  ])('blocks $0 without losing a previous valid selection', async (_name, input, feedback) => {
    render(<App />);
    await openImport();
    await upload();
    await acknowledge();
    await upload(input, 'replacement.csv');
    expect(await screen.findByText(new RegExp(feedback))).toBeInTheDocument();
    expect(state.post).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Import 1 lines' })).toBeDisabled();
    if (_name === 'malformed file') {
      expect(screen.getByText('statement.csv')).toBeInTheDocument();
      expect(screen.getByRole('checkbox', { name: /I reviewed these lines/ })).not.toBeChecked();
    }
  });
  it('rejects an oversized file before reading it', async () => {
    render(<App />);
    await openImport();
    const file = new File([''], 'large.csv', { type: 'text/csv' }),
      text = vi.fn();
    Object.defineProperty(file, 'size', { value: 2_000_001 });
    Object.defineProperty(file, 'text', { value: text });
    fireEvent.change(screen.getByLabelText('Choose statement CSV'), { target: { files: [file] } });
    await screen.findByText(/smaller than 2 MB/);
    expect(text).not.toHaveBeenCalled();
  });
  it('ignores a late file read when another file has been chosen', async () => {
    render(<App />);
    await openImport();
    let resolve!: (value: string) => void;
    const slow = new File([''], 'slow.csv', { type: 'text/csv' });
    Object.defineProperty(slow, 'text', {
      value: () =>
        new Promise<string>((done) => {
          resolve = done;
        }),
    });
    fireEvent.change(screen.getByLabelText('Choose statement CSV'), { target: { files: [slow] } });
    expect(screen.getByRole('button', { name: 'Keep draft' })).toBeDisabled();
    await upload(csv, 'latest.csv');
    await act(async () => resolve(header + '2026-09-20,Old choice,P1,1,0\n'));
    expect(screen.getByText('latest.csv')).toBeInTheDocument();
    expect(screen.queryByText('Old choice')).not.toBeInTheDocument();
  });
  it('requires new review when the statement changes before import', async () => {
    render(<App />);
    await openImport();
    await upload();
    await acknowledge();
    state.record.updatedAt = 'v2';
    fireEvent.click(screen.getByRole('button', { name: 'Import 1 lines' }));
    await screen.findByText('The source record has changed.');
    expect(state.post).not.toHaveBeenCalled();
    await acknowledge();
    fireEvent.click(screen.getByRole('button', { name: 'Import 1 lines' }));
    await waitFor(() => expect(state.post).toHaveBeenCalledTimes(1));
  });
  it('retains a failed import and reviews a changed source before retrying through server deduplication', async () => {
    state.post
      .mockRejectedValueOnce(new Error('Uncertain import response'))
      .mockResolvedValueOnce({ imported: 0, skipped: 1 });
    render(<App />);
    await openImport();
    await upload();
    await acknowledge();
    fireEvent.click(screen.getByRole('button', { name: 'Import 1 lines' }));
    await screen.findByText('Uncertain import response');
    fireEvent.click(screen.getByRole('button', { name: 'Keep draft' }));
    state.record.updatedAt = 'v2';
    fireEvent.click(screen.getByRole('button', { name: 'Resume Statement CSV import' }));
    await screen.findByText('The source record has changed.');
    await acknowledge();
    fireEvent.click(screen.getByRole('button', { name: 'Import 1 lines' }));
    await screen.findByText('0 lines imported; 1 exact duplicate lines skipped.');
    expect(state.post.mock.calls[1][1]).toEqual(state.post.mock.calls[0][1]);
  });
  it('blocks imports into an approved source and keeps the file recoverable', async () => {
    render(<App />);
    await openImport();
    await upload();
    fireEvent.click(screen.getByRole('button', { name: 'Keep draft' }));
    state.record.status = 'APPROVED';
    fireEvent.click(screen.getByRole('button', { name: 'Resume Statement CSV import' }));
    await screen.findByText(/This reconciliation is approved/);
    expect(screen.getByRole('button', { name: 'Import 1 lines' })).toBeDisabled();
    expect(screen.getByText('statement.csv')).toBeInTheDocument();
  });
  it('rechecks import permission after a pending verification read and prevents duplicate clicks', async () => {
    const view = render(<App />);
    await openImport();
    await upload();
    await acknowledge();
    let resolve!: (value: unknown) => void;
    state.get.mockImplementationOnce(
      () =>
        new Promise((done) => {
          resolve = done;
        }),
    );
    const action = screen.getByRole('button', { name: 'Import 1 lines' });
    fireEvent.click(action);
    fireEvent.click(action);
    expect(screen.getByRole('button', { name: 'Keep draft' })).toBeDisabled();
    // The verification read starts a microtask after the click it belongs to.
    await waitFor(() => expect(resolve).toBeDefined());
    state.permissions.delete('bank_reconciliations.update');
    view.rerender(<App />);
    await act(async () => resolve(structuredClone(state.record)));
    await screen.findByText(/current role no longer permits/);
    expect(state.post).not.toHaveBeenCalled();
  });
  it('aborts pending source verification when its window unmounts', async () => {
    const view = render(<App />);
    await openImport();
    await upload();
    await acknowledge();
    let resolve!: (value: unknown) => void;
    state.get.mockImplementationOnce(
      () =>
        new Promise((done) => {
          resolve = done;
        }),
    );
    fireEvent.click(screen.getByRole('button', { name: 'Import 1 lines' }));
    // submit() saves the draft before it verifies the source, so the read is a
    // microtask behind the click. Flush to the point where it is in flight,
    // which is the state this test unmounts out from under.
    await act(async () => {});
    const request = state.get.mock.calls.at(-1)![1];
    view.unmount();
    expect(request.signal.aborted).toBe(true);
    await act(async () => resolve(structuredClone(state.record)));
    expect(state.post).not.toHaveBeenCalled();
  });
});
describe('Statement lines, matching and final review', () => {
  it('keeps a statement line, validates its dates and direction and sends the numeric endpoint contract', async () => {
    render(<App />);
    await openDetail();
    fireEvent.click(screen.getByRole('button', { name: 'Add line' }));
    fireEvent.change(await screen.findByRole('textbox', { name: 'Description' }), {
      target: { value: 'Bank fee' },
    });
    await setDateField('Transaction date', '2026-09-20');
    fireEvent.change(screen.getByRole('textbox', { name: 'Debit · money out' }), {
      target: { value: '10.125' },
    });
    fireEvent.change(screen.getByRole('textbox', { name: 'Credit · money in' }), {
      target: { value: '1' },
    });
    await acknowledge();
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Add line' }));
    await screen.findByText('Enter exactly one positive debit or credit.');
    expect(state.post).not.toHaveBeenCalled();
    fireEvent.change(screen.getByRole('textbox', { name: 'Credit · money in' }), {
      target: { value: '0' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Keep draft' }));
    fireEvent.click(screen.getByRole('button', { name: 'Resume New statement line' }));
    expect(await screen.findByRole('textbox', { name: 'Description' })).toHaveValue('Bank fee');
    await acknowledge();
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Add line' }));
    await waitFor(() =>
      expect(state.post).toHaveBeenCalledWith(
        `${path}/lines`,
        expect.objectContaining({
          transactionDate: '2026-09-20',
          description: 'Bank fee',
          debitAmount: 10.125,
          creditAmount: 0,
        }),
      ),
    );
  });
  it('runs matching explicitly, shows candidates and keeps a selected match for later review', async () => {
    render(<App />);
    await openDetail();
    fireEvent.click(screen.getByRole('button', { name: 'Run matching' }));
    await screen.findByRole('dialog', { name: 'Review automatic matching' });
    await acknowledge();
    fireEvent.click(
      within(screen.getByRole('dialog')).getByRole('button', { name: 'Run matching' }),
    );
    const select = await screen.findByRole('combobox', { name: 'Journal match for Existing line' });
    fireEvent.change(select, { target: { value: 'journal-line' } });
    fireEvent.click(screen.getByRole('button', { name: 'Review selected match' }));
    await screen.findByRole('dialog', { name: 'Review selected match' });
    fireEvent.click(screen.getByRole('button', { name: 'Keep draft' }));
    fireEvent.click(screen.getByRole('button', { name: 'Resume Review selected match' }));
    await screen.findByRole('dialog', { name: 'Review selected match' });
    await screen.findByText(/selected journal candidate/i);
    await acknowledge();
    fireEvent.click(screen.getByRole('button', { name: 'Match selected entry' }));
    await waitFor(() =>
      expect(state.post).toHaveBeenCalledWith(`${path}/match`, {
        statementLineId: 'line',
        journalEntryLineId: 'journal-line',
      }),
    );
    expect(state.post.mock.calls[0]).toEqual([
      `${path}/run-matching`,
      { dateWindowDays: 3, amountToleranceCents: 0 },
    ]);
  });
  it.each(['approve', 'close', 'unmatch'] as const)(
    'retains the %s confirmation and obeys the current record state',
    async (action) => {
      state.record.status = action === 'close' ? 'APPROVED' : 'DRAFT';
      if (action === 'unmatch') state.record.statementLines![0].matched = true;
      render(<App />);
      fireEvent.click(await screen.findByRole('button', { name: 'Review BR-01' }));
      const opener =
        action === 'approve'
          ? 'Review approval'
          : action === 'close'
            ? 'Review closure'
            : 'Review match removal';
      fireEvent.click(await screen.findByRole('button', { name: opener }));
      await screen.findByRole('dialog', { name: reconciliationActions[action].label });
      await within(screen.getByRole('dialog')).findByText('Current statement');
      fireEvent.click(screen.getByRole('button', { name: 'Keep draft' }));
      fireEvent.click(
        screen.getByRole('button', { name: `Resume ${reconciliationActions[action].label}` }),
      );
      await within(await screen.findByRole('dialog')).findByText('Current statement');
      await acknowledge();
      await waitFor(() =>
        expect(
          screen.getByRole('button', { name: reconciliationActions[action].submit }),
        ).toBeEnabled(),
      );
      fireEvent.click(screen.getByRole('button', { name: reconciliationActions[action].submit }));
      await waitFor(() =>
        expect(state.post).toHaveBeenCalledWith(
          `${path}/${action}`,
          action === 'unmatch' ? { statementLineId: 'line' } : undefined,
        ),
      );
    },
  );
  it('shows approval issues, refreshes evidence and keeps a rejected approval available for correction', async () => {
    state.evidence = {
      ready: false,
      issues: ['Every statement line must be matched.'],
      calculatedClose: '25.00',
    };
    render(<App />);
    await openDetail();
    fireEvent.click(screen.getByRole('button', { name: 'Review approval' }));
    await screen.findByRole('dialog');
    await acknowledge();
    expect(screen.getByRole('button', { name: 'Approve reconciliation' })).toBeDisabled();
    state.evidence = { ready: true, issues: [], calculatedClose: '25.00' };
    fireEvent.click(screen.getByRole('button', { name: 'Refresh approval checks' }));
    state.post.mockRejectedValueOnce(new Error('Maker-checker: another user must approve'));
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Approve reconciliation' })).toBeEnabled(),
    );
    fireEvent.click(screen.getByRole('button', { name: 'Approve reconciliation' }));
    await screen.findByText('Maker-checker: another user must approve');
    expect(screen.getByRole('button', { name: 'Keep draft' })).toBeEnabled();
  });
});
