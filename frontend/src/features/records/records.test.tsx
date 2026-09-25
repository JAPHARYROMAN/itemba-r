import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useState } from 'react';
import userEvent from '@testing-library/user-event';
import { WindowModalProvider } from '@/components/ui/modal';
import { RecordsApp } from './records-app';
import { RecordsEditor } from './records-editor';
import { emptyDirectory, emptyScope, Entry, paymentRemaining } from './types';
import { RecordsStatement } from './records-statement';
import {
  WorkspaceInstanceProvider,
  WorkspaceSessionProvider,
} from '@/components/workspace/workspace-session';
import { WorkspaceNavigationProvider } from '@/components/workspace/workspace-navigation';
const api = vi.hoisted(() => ({
  get: vi.fn(),
  post: vi.fn(),
  patch: vi.fn(),
  permissions: new Set<string>(),
}));
vi.mock('@/hooks/use-auth', () => ({
  useAuth: () => ({
    user: { id: 'person', permissions: [...api.permissions] },
    hasPermission: (p: string) => api.permissions.has(p),
  }),
}));
vi.mock('@/lib/api-client', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  backendGet: api.get,
  backendPost: api.post,
  backendPatch: api.patch,
}));
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn(), forward: vi.fn() }),
  usePathname: () => '/records',
  useSearchParams: () => new URLSearchParams(),
}));
beforeEach(() => {
  vi.clearAllMocks();
  api.permissions = new Set(['records.view', 'records.manage', 'records.export']);
  window.matchMedia = vi
    .fn()
    .mockReturnValue({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() });
  api.get.mockImplementation(async (path: string) =>
    path.endsWith('directory')
      ? emptyDirectory
      : path.endsWith('summary')
        ? []
        : { rows: [], total: 0, pageSize: 25 },
  );
  api.post.mockResolvedValue({ id: 'saved' });
});
describe('Records app', () => {
  it('returns keyboard focus to New record after closing a form opened through the picker', async () => {
    function HostedRecords() {
      const [target, setTarget] = useState<HTMLDivElement | null>(null);
      return (
        <div ref={setTarget}>
          <WindowModalProvider target={target} active>
            <RecordsApp />
          </WindowModalProvider>
        </div>
      );
    }
    const user = userEvent.setup();
    render(<HostedRecords />);
    const trigger = screen.getByRole('button', { name: 'New record', exact: true });
    await user.click(trigger);
    await user.click(screen.getByRole('button', { name: 'Debtors Money owed to you' }));
    expect(screen.getByLabelText('Title*')).toHaveFocus();
    await user.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(trigger).toHaveFocus();
  });
  it('does not read records without its own permission', () => {
    api.permissions.clear();
    render(<RecordsApp />);
    expect(screen.getByText(/need Records access/)).toBeInTheDocument();
    expect(api.get).not.toHaveBeenCalled();
  });
  it('offers all requested registers and notes with independent endpoints', async () => {
    render(<RecordsApp />);
    await screen.findByText('Your notebook starts here');
    for (const name of [
      'Add debtor',
      'Add creditor',
      'Add sale',
      'Add purchase',
      'Add expense',
      'Add note',
    ])
      expect(screen.getByRole('button', { name })).toBeInTheDocument();
    expect(api.get.mock.calls.every(([url]) => url.startsWith('/records'))).toBe(true);
  });
  it('keeps two window filters and navigation independent', async () => {
    render(
      <WorkspaceSessionProvider>
        {['one', 'two'].map((id) => (
          <WorkspaceInstanceProvider key={id} id={id} appId="records">
            <WorkspaceNavigationProvider
              appId="records"
              initialHref="/records"
              ownsPath={(p) => p === '/records'}
            >
              <section aria-label={id}>
                <RecordsApp />
              </section>
            </WorkspaceNavigationProvider>
          </WorkspaceInstanceProvider>
        ))}
      </WorkspaceSessionProvider>,
    );
    const first = within(screen.getByRole('region', { name: 'one' })),
      second = within(screen.getByRole('region', { name: 'two' }));
    fireEvent.change(first.getByLabelText('Search records'), { target: { value: 'Alice' } });
    fireEvent.change(second.getByLabelText('Search records'), { target: { value: 'Bob' } });
    fireEvent.click(
      within(first.getByRole('navigation', { name: 'Records registers' })).getByText('Debtors'),
    );
    expect(first.getByRole('heading', { level: 1 })).toHaveTextContent('Debtors');
    expect(second.getByRole('heading', { level: 1 })).toHaveTextContent('Overview');
    expect(first.getByLabelText('Search records')).toHaveValue('Alice');
    expect(second.getByLabelText('Search records')).toHaveValue('Bob');
  });
  it('retains request identity and original payload for an uncertain save retry', async () => {
    api.post
      .mockRejectedValueOnce(new TypeError('Network failed'))
      .mockResolvedValueOnce({ id: 'saved' });
    const saved = vi.fn();
    render(
      <RecordsEditor
        editor={{ mode: 'create', kind: 'DEBTOR' }}
        scope={emptyScope}
        directory={emptyDirectory}
        onClose={vi.fn()}
        onSaved={saved}
      />,
    );
    fireEvent.change(screen.getByLabelText(/^Title/), { target: { value: 'Personal advance' } });
    fireEvent.change(screen.getByLabelText(/^Debtor name/), { target: { value: 'Alice' } });
    fireEvent.change(screen.getByLabelText(/^Debt amount/), {
      target: { value: '100.30' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save record' }));
    await screen.findByRole('button', { name: 'Retry same request' });
    expect(screen.getByLabelText(/^Title/)).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'Retry same request' }));
    await waitFor(() => expect(saved).toHaveBeenCalledWith('saved'));
    expect(api.post.mock.calls[0]).toEqual(api.post.mock.calls[1]);
    expect(api.post.mock.calls[0][1]).toMatchObject({
      companyId: null,
      divisionId: null,
      branchId: null,
      amount: '100.30',
      kind: 'DEBTOR',
    });
  });
  it('keeps optional details discoverable and includes them when saving', async () => {
    render(
      <RecordsEditor
        editor={{ mode: 'create', kind: 'DEBTOR' }}
        scope={emptyScope}
        directory={emptyDirectory}
        onClose={vi.fn()}
        onSaved={vi.fn()}
      />,
    );
    expect(screen.getByLabelText('Contact (optional)')).not.toBeVisible();
    fireEvent.click(screen.getByText('Additional details', { exact: false, selector: 'summary' }));
    expect(screen.getByLabelText('Contact (optional)')).toBeVisible();
    fireEvent.change(screen.getByLabelText('Contact (optional)'), {
      target: { value: 'Contact at branch' },
    });
    fireEvent.change(screen.getByLabelText(/^Title/), { target: { value: 'Advance' } });
    fireEvent.change(screen.getByLabelText(/^Debtor name/), { target: { value: 'Test account' } });
    fireEvent.change(screen.getByLabelText(/^Debt amount/), { target: { value: '120.00' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save record' }));
    await waitFor(() =>
      expect(api.post).toHaveBeenCalledWith(
        '/records',
        expect.objectContaining({
          contact: 'Contact at branch',
          companyId: null,
          amount: '120.00',
        }),
      ),
    );
  });
  it.each(['DEBTOR', 'CREDITOR'] as const)(
    'records a partial %s payment and shows the remaining balance',
    async (kind) => {
      const saved = vi.fn();
      const entry = {
        id: 'debt',
        kind,
        title: 'Advance',
        currency: 'TZS',
        balance: '100.30',
        amount: '100.30',
        recordDate: '2026-01-01',
        version: 2,
      } as Entry;
      render(
        <RecordsEditor
          editor={{ mode: 'settle', kind, entry }}
          scope={emptyScope}
          directory={emptyDirectory}
          onClose={vi.fn()}
          onSaved={saved}
        />,
      );
      const amount = screen.getByLabelText(kind === 'DEBTOR' ? /^Amount received/ : /^Amount paid/);
      expect(amount).toHaveValue('');
      fireEvent.change(amount, { target: { value: '30.10' } });
      expect(screen.getByRole('status')).toHaveTextContent('Remaining balance: TZS 70.20');
      fireEvent.click(screen.getByRole('button', { name: 'Record payment' }));
      await waitFor(() => expect(saved).toHaveBeenCalled());
      expect(api.post).toHaveBeenCalledWith(
        '/records/debt/settlements',
        expect.objectContaining({ amount: '30.10', version: 2, requestId: expect.any(String) }),
      );
    },
  );
  it('validates partial payments with exact minor units', () => {
    expect(paymentRemaining('100.30', '0.10')).toBe('100.20');
    expect(paymentRemaining('100.30', '100.30')).toBe('0.00');
    for (const v of ['101', '0', '-1', '0.001', '1e2'])
      expect(paymentRemaining('100.30', v)).toBeNull();
  });
  it('shows statement columns without exposing export actions to a read-only user', async () => {
    api.get.mockResolvedValue({
      openingBalance: '0.00',
      closingBalance: '70.20',
      totalDebit: '100.30',
      totalCredit: '30.10',
      balanceSide: 'Dr',
      from: null,
      to: '2026-01-04',
      startsOn: null,
      rows: [
        {
          id: 'payment',
          date: '2026-01-03',
          description: 'Payment received',
          reference: 'R-1',
          debit: '0.00',
          credit: '30.10',
          balance: '70.20',
        },
      ],
    });
    render(
      <RecordsStatement
        entry={{ id: 'debt', kind: 'DEBTOR', currency: 'TZS', version: 2 } as Entry}
        canExport={false}
      />,
    );
    await screen.findByText('Payment received');
    expect(screen.getByRole('columnheader', { name: 'Debit' })).toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: 'Credit' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Export PDF' })).not.toBeInTheDocument();
    expect(api.get).toHaveBeenCalledWith('/records/debt/statement', expect.any(Object));
  });
});
