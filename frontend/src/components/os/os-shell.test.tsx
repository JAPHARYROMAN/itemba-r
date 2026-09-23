import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { OsShell } from './os-shell';
import { updateWorkspace } from '@/lib/workspace-preferences';
import { Modal } from '@/components/ui/modal';

const state = vi.hoisted(() => ({
  permissions: new Set<string>(),
  push: vi.fn(),
  replace: vi.fn(),
  pathname: '/finance',
}));
vi.mock('next/navigation', () => ({
  usePathname: () => state.pathname,
  useRouter: () => ({ push: state.push, replace: state.replace }),
}));
vi.mock('@/hooks/use-auth', () => ({
  useAuth: () => ({
    user: {
      id: 'os-test-user',
      fullName: 'Test User',
      email: 'test@example.test',
      roles: [],
      companyId: null,
    },
    hasPermission: (p: string) => state.permissions.has(p),
    loading: false,
    logout: vi.fn(),
  }),
}));
vi.mock('@/components/msaidizi/msaidizi-launcher', () => ({ MsaidiziTopbarButton: () => null }));
vi.mock('@/components/apps/app-launcher', () => ({
  AppLauncher: () => <h1>Fuel workspace</h1>,
}));
vi.mock('./os-companion-app', () => ({
  supportsCompanion: (id: string) =>
    ['invoice-desk', 'cash-desk', 'sales-desk', 'documents'].includes(id),
  OsCompanionApp: ({ appId }: { appId: string }) => (
    <input aria-label={`${appId} companion entry`} defaultValue="" />
  ),
}));
vi.mock('@/components/aurora/command/CommandPaletteProvider', () => ({
  useCommandPalette: () => ({ open: vi.fn() }),
}));
vi.mock('@/hooks/use-theme', () => ({ useTheme: () => ({ mode: 'system', setMode: vi.fn() }) }));

beforeEach(() => {
  vi.stubGlobal(
    'matchMedia',
    vi.fn((media: string) => ({
      matches: false,
      media,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })),
  );
  state.pathname = '/finance';
  state.permissions = new Set(['fuel_grid.access', 'finance.view']);
  state.push.mockReset();
  state.replace.mockReset();
  localStorage.clear();
});

describe('ITEMBA OS shell', () => {
  it('starts a fresh app search after dismissal and opens the best match with Enter', async () => {
    const user = userEvent.setup();
    render(
      <OsShell appUrls={{}}>
        <input aria-label="Kept draft" defaultValue="In progress" />
      </OsShell>,
    );
    const trigger = screen.getByRole('button', { name: 'Switch apps', exact: true });
    await user.click(trigger);
    await user.type(
      screen.getByRole('searchbox', { name: 'Find an app to switch to' }),
      'petroleum',
    );
    await user.keyboard('{Escape}');
    await user.click(trigger);
    const search = screen.getByRole('searchbox', { name: 'Find an app to switch to' });
    expect(search).toHaveValue('');
    await user.type(search, 'petroleum{Enter}');
    expect(screen.getByRole('heading', { name: 'Fuel workspace' })).toBeVisible();
    expect(screen.getByRole('main', { name: 'Fuel Grid content' })).toHaveFocus();
    expect(screen.queryByRole('dialog', { name: 'Switch apps' })).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Open ITEMBA-R', exact: true }));
    expect(screen.getByLabelText('Kept draft')).toHaveValue('In progress');
    expect(screen.getByRole('main', { name: 'ITEMBA-R content' })).toHaveFocus();
  });

  it('recovers an empty app search and navigates the result list from either end', async () => {
    const user = userEvent.setup();
    render(
      <OsShell appUrls={{}}>
        <p>Workspace</p>
      </OsShell>,
    );
    await user.click(screen.getByRole('button', { name: 'Switch apps', exact: true }));
    const search = screen.getByRole('searchbox', { name: 'Find an app to switch to' });
    await user.type(search, 'does-not-exist{Enter}');
    expect(screen.getByRole('status')).toHaveTextContent('0 apps');
    expect(state.push).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: 'Show all apps' }));
    expect(search).toHaveValue('');
    expect(search).toHaveFocus();
    const buttons = Array.from(document.querySelectorAll('.os-switcher-results > button'));
    await user.keyboard('{ArrowUp}');
    expect(buttons.at(-1)).toHaveFocus();
    await user.keyboard('{Home}');
    expect(buttons[0]).toHaveFocus();
    await user.keyboard('{End}{ArrowDown}');
    expect(buttons[0]).toHaveFocus();
    await user.click(search);
    await user.type(search, 'Fuel');
    await user.click(screen.getByRole('button', { name: 'Clear app search' }));
    expect(search).toHaveFocus();
    expect(search).toHaveValue('');
  });

  it('ignores repeated and composing switcher shortcuts, and toggles the switcher normally', async () => {
    render(
      <OsShell appUrls={{}}>
        <input aria-label="Entry" />
      </OsShell>,
    );
    const input = screen.getByLabelText('Entry');
    act(() => input.focus());
    const shortcut = { key: ' ', code: 'Space', ctrlKey: true, shiftKey: true };
    fireEvent.keyDown(input, { ...shortcut, repeat: true });
    fireEvent.keyDown(input, { ...shortcut, isComposing: true });
    fireEvent.keyDown(input, { ...shortcut, altKey: true });
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    fireEvent.keyDown(input, shortcut);
    const search = await screen.findByRole('searchbox', { name: 'Find an app to switch to' });
    expect(search).toHaveFocus();
    fireEvent.keyDown(search, shortcut);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(input).toHaveFocus();
  });

  it('does not let the switcher shortcut interrupt a financial review dialog', () => {
    render(
      <OsShell appUrls={{}}>
        <Modal open title="Review supplier payment" onClose={vi.fn()}>
          <input autoFocus aria-label="Payment reference" defaultValue="PAY-100" />
        </Modal>
      </OsShell>,
    );
    const input = screen.getByLabelText('Payment reference');
    fireEvent.keyDown(input, { key: ' ', code: 'Space', ctrlKey: true, shiftKey: true });
    expect(screen.queryByRole('dialog', { name: 'Switch apps' })).not.toBeInTheDocument();
    expect(input).toHaveFocus();
    expect(input).toHaveValue('PAY-100');
  });

  it('does not open an app while the search input is composing text', async () => {
    render(
      <OsShell appUrls={{}}>
        <p>Workspace</p>
      </OsShell>,
    );
    await userEvent.click(screen.getByRole('button', { name: 'Switch apps', exact: true }));
    const search = screen.getByRole('searchbox', { name: 'Find an app to switch to' });
    fireEvent.change(search, { target: { value: 'Fuel' } });
    fireEvent.keyDown(search, { key: 'Enter', isComposing: true });
    expect(screen.getByRole('dialog', { name: 'Switch apps' })).toBeVisible();
    expect(screen.queryByRole('heading', { name: 'Fuel workspace' })).not.toBeInTheDocument();
  });

  it('restores the open companion from the dock and removes it when its main route opens', async () => {
    const user = userEvent.setup();
    state.pathname = '/invoice-desk';
    state.permissions = new Set(['invoice_desk.view', 'cash_desk.view']);
    const view = render(
      <OsShell appUrls={{}}>
        <input aria-label="Main invoice entry" defaultValue="" />
      </OsShell>,
    );
    await user.type(screen.getByLabelText('Main invoice entry'), 'Invoice draft');
    await user.click(screen.getByRole('button', { name: 'Work side by side', exact: true }));
    await user.click(screen.getByRole('button', { name: /Open Cash Desk alongside/ }));
    await user.type(screen.getByLabelText('cash-desk companion entry'), 'Cash draft');
    await user.click(screen.getByRole('button', { name: 'Return to desktop', exact: true }));
    await user.click(screen.getByRole('button', { name: 'Open Cash Desk', exact: true }));
    expect(state.push).not.toHaveBeenCalled();
    expect(screen.getAllByLabelText('cash-desk companion entry')).toHaveLength(1);
    expect(screen.getByLabelText('cash-desk companion entry')).toHaveValue('Cash draft');
    expect(screen.getByLabelText('Main invoice entry')).toHaveValue('Invoice draft');
    state.pathname = '/cash-desk';
    view.rerender(
      <OsShell appUrls={{}}>
        <h1>Main cash workspace</h1>
      </OsShell>,
    );
    expect(screen.queryByLabelText('cash-desk companion entry')).not.toBeInTheDocument();
    expect(screen.getByText('Main cash workspace')).toBeVisible();
  });
  it('switches only to permitted apps and restores keyboard focus when dismissed', async () => {
    const user = userEvent.setup();
    render(
      <OsShell appUrls={{}}>
        <p>Workspace</p>
      </OsShell>,
    );
    const trigger = screen.getByRole('button', { name: 'Switch apps', exact: true });
    await user.click(trigger);
    const dialog = screen.getByRole('dialog', { name: 'Switch apps' });
    expect(within(dialog).queryByRole('button', { name: /Invoice Desk/ })).not.toBeInTheDocument();
    await user.type(within(dialog).getByRole('searchbox'), 'petroleum');
    const fuel = within(dialog).getByRole('button', { name: /Fuel Grid/ });
    await user.keyboard('{ArrowDown}');
    expect(fuel).toHaveFocus();
    await user.keyboard('{Escape}');
    expect(trigger).toHaveFocus();
  });

  it('supports dock arrow keys without navigating until an app is activated', async () => {
    const user = userEvent.setup();
    render(
      <OsShell appUrls={{}}>
        <p>Workspace</p>
      </OsShell>,
    );
    const dock = screen.getByRole('navigation', { name: 'Applications' });
    const apps = within(dock).getByRole('button', { name: 'Show Apps' });
    act(() => apps.focus());
    await user.keyboard('{ArrowRight}');
    expect(within(dock).getByRole('button', { name: 'Open ITEMBA-R', exact: true })).toHaveFocus();
    expect(state.push).not.toHaveBeenCalled();
    await user.keyboard('{End}');
    expect(within(dock).getByRole('button', { name: 'Open OS settings' })).toHaveFocus();
  });

  it('opens an account menu with keyboard support and returns focus on Escape', async () => {
    const user = userEvent.setup();
    render(
      <OsShell appUrls={{}}>
        <p>Workspace</p>
      </OsShell>,
    );
    const account = screen.getByRole('button', { name: 'Account menu' });
    act(() => account.focus());
    await user.keyboard('{ArrowDown}');
    expect(await screen.findByRole('menu', { name: 'Account menu' })).toBeVisible();
    expect(screen.getByRole('menuitem', { name: 'Appearance' })).toHaveFocus();
    await user.keyboard('{Escape}');
    await waitFor(() => expect(account).toHaveFocus());
  });

  it('applies personal workspace presentation preferences', () => {
    updateWorkspace('os-test-user', (value) => ({
      ...value,
      density: 'compact',
      backdrop: 'mist',
      transparency: 'reduced',
    }));
    render(
      <OsShell appUrls={{}}>
        <p>Workspace</p>
      </OsShell>,
    );
    const shell = document.querySelector('.itemba-os');
    expect(shell).toHaveAttribute('data-density', 'compact');
    expect(shell).toHaveAttribute('data-backdrop', 'mist');
    expect(shell).toHaveAttribute('data-transparency', 'reduced');
  });
  it('returns to the account trigger after closing settings opened through its menu', async () => {
    const user = userEvent.setup();
    render(
      <OsShell appUrls={{}}>
        <p>Workspace</p>
      </OsShell>,
    );
    const account = screen.getByRole('button', { name: 'Account menu' });
    await user.click(account);
    await user.click(await screen.findByRole('menuitem', { name: 'Appearance' }));
    const dialog = await screen.findByRole('dialog', { name: 'System settings' });
    await user.click(within(dialog).getByRole('button', { name: 'Close', exact: true }));
    await waitFor(() => expect(account).toHaveFocus());
  });
  it('returns to the app switcher trigger after closing settings launched from its temporary list', async () => {
    const user = userEvent.setup();
    render(
      <OsShell appUrls={{}}>
        <p>Workspace</p>
      </OsShell>,
    );
    const trigger = screen.getByRole('button', { name: 'Switch apps', exact: true });
    await user.click(trigger);
    const switcher = screen.getByRole('dialog', { name: 'Switch apps' });
    await user.click(within(switcher).getByRole('button', { name: /Settings/ }));
    const settings = await screen.findByRole('dialog', { name: 'System settings' });
    await user.click(within(settings).getByRole('button', { name: 'Close', exact: true }));
    await waitFor(() => expect(trigger).toHaveFocus());
  });
  it('opens employee records in Payroll for an employee-only role without exposing pay tools', () => {
    state.pathname = '/hr/employees/employee';
    state.permissions = new Set(['employees.view']);
    render(
      <OsShell appUrls={{}}>
        <p>Employee profile content</p>
      </OsShell>,
    );
    expect(screen.getByRole('link', { name: 'Employees', exact: true })).toHaveAttribute(
      'aria-current',
      'page',
    );
    expect(screen.getByRole('button', { name: 'Open Payroll', exact: true })).toBeInTheDocument();
    expect(
      screen.queryByRole('link', { name: 'Payroll runs', exact: true }),
    ).not.toBeInTheDocument();
  });
  it('keeps legacy payroll pages inside the Payroll app with permitted navigation', () => {
    state.pathname = '/hr/payroll-runs';
    state.permissions = new Set(['payroll.view']);
    render(
      <OsShell appUrls={{}}>
        <p>Payroll run content</p>
      </OsShell>,
    );
    expect(screen.getByRole('navigation', { name: 'Payroll workspace' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Payroll runs', exact: true })).toHaveAttribute(
      'aria-current',
      'page',
    );
    expect(screen.getByRole('button', { name: 'Open Payroll', exact: true })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Payments', exact: true })).not.toBeInTheDocument();
  });
  it('restores a route app from its desktop tile without navigating away from its draft', async () => {
    state.pathname = '/invoice-desk';
    state.permissions.add('invoice_desk.view');
    render(
      <OsShell appUrls={{}}>
        <input aria-label="Invoice draft" defaultValue="Keep this invoice" />
      </OsShell>,
    );
    await userEvent.click(screen.getByRole('button', { name: 'Show Apps' }));
    expect(screen.queryByRole('textbox', { name: 'Invoice draft' })).not.toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Apps desktop' })).toHaveFocus();
    await userEvent.click(screen.getByRole('link', { name: 'Open Invoice Desk', exact: true }));
    expect(screen.getByRole('textbox', { name: 'Invoice draft' })).toHaveValue('Keep this invoice');
    expect(screen.getByRole('main', { name: 'Invoice Desk content' })).toHaveFocus();
    expect(state.push).not.toHaveBeenCalled();
  });
  it('restores window size and resumes the last permitted ERP route', async () => {
    state.pathname = '/apps';
    updateWorkspace('os-test-user', (value) => ({
      ...value,
      lastErpPath: '/finance',
      startup: 'resume',
      maximized: true,
    }));
    render(
      <OsShell appUrls={{}}>
        <p>Workspace</p>
      </OsShell>,
    );
    expect(state.replace).toHaveBeenCalledWith('/finance');
    expect(document.querySelector('.itemba-os')).toHaveClass('os-maximized');
    await userEvent.click(screen.getByRole('button', { name: 'Open ITEMBA-R', exact: true }));
    expect(state.push).toHaveBeenCalledWith('/finance');
  });
  it('does not restore a saved child route after its permission has been removed', () => {
    state.pathname = '/apps';
    state.permissions = new Set(['finance.view']);
    updateWorkspace('os-test-user', (value) => ({
      ...value,
      lastErpPath: '/finance/payables',
      startup: 'resume',
    }));
    render(
      <OsShell appUrls={{}}>
        <p>Workspace</p>
      </OsShell>,
    );
    expect(state.replace).toHaveBeenCalledWith('/dashboard');
  });
  it('preserves an ERP draft while minimizing and switching to Fuel Grid', async () => {
    const user = userEvent.setup();
    render(
      <OsShell appUrls={{}}>
        <input aria-label="Unsaved draft" />
      </OsShell>,
    );
    await user.type(screen.getByRole('textbox', { name: 'Unsaved draft' }), 'Keep this draft');
    await user.click(screen.getByRole('button', { name: 'Minimize window' }));
    expect(screen.queryByRole('textbox', { name: 'Unsaved draft' })).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Open Fuel Grid', exact: true }));
    expect(screen.getByRole('heading', { name: 'Fuel workspace' })).toBeVisible();
    await user.click(screen.getByRole('button', { name: 'Open ITEMBA-R', exact: true }));
    expect(screen.getByRole('textbox', { name: 'Unsaved draft' })).toHaveValue('Keep this draft');
    expect(state.push).not.toHaveBeenCalled();
  });

  it('filters unavailable apps and inherits permissions for module pages', async () => {
    state.permissions = new Set(['finance.view']);
    render(
      <OsShell appUrls={{}}>
        <p>Finance</p>
      </OsShell>,
    );
    expect(screen.queryByRole('button', { name: 'Open Fuel Grid' })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'All modules' }));
    await userEvent.type(screen.getByRole('textbox', { name: 'Search modules' }), 'posting rules');
    expect(screen.getByText('No pages match your search.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Posting Rules' })).not.toBeInTheDocument();
  });

  it('searches the ERP app and restores it from the desktop', async () => {
    render(
      <OsShell appUrls={{}}>
        <p>ERP document</p>
      </OsShell>,
    );
    await userEvent.click(screen.getByRole('button', { name: 'Show Apps' }));
    await userEvent.type(screen.getByRole('searchbox', { name: 'Search apps' }), 'finance');
    const library = screen.getByRole('region', { name: 'App library' });
    expect(within(library).getByRole('button', { name: 'Launch ITEMBA-R' })).toBeVisible();
    expect(within(library).queryByRole('link', { name: 'Open Fuel Grid' })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Launch ITEMBA-R' }));
    expect(screen.getByText('ERP document')).toBeVisible();
  });
});
