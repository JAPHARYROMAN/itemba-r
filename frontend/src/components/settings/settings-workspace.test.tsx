import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { SettingsWorkspace, type SettingEntry } from './settings-workspace';
import { WorkspaceControls } from './workspace-controls';
import { Modal } from '@/components/ui/modal';

const state = vi.hoisted(() => ({ permissions: new Set(['companies.read']), fetch: vi.fn() }));
vi.mock('@/hooks/use-auth', () => ({
  useAuth: () => ({
    user: { id: 'settings-user', fullName: 'Test Account', email: 'test@example.test' },
    hasPermission: (permission: string) => state.permissions.has(permission),
  }),
}));
vi.mock('@/components/aurora/feedback', () => ({ showToast: vi.fn() }));
const entries: SettingEntry[] = [
  {
    id: 'companies',
    category: 'ORGANIZATION',
    name: 'Companies',
    description: 'Company identity',
    href: '/companies',
    permission: 'companies.read',
    scope: 'GROUP',
    status: 'BUILT_IN',
  },
  {
    id: 'roles',
    category: 'USERS_ACCESS',
    name: 'Roles',
    description: 'Manage access',
    href: '/roles',
    permission: 'roles.manage',
    scope: 'GROUP',
    status: 'BUILT_IN',
  },
  {
    id: 'prefs',
    category: 'PREFERENCES',
    name: 'My preferences',
    description: 'Formatting',
    href: '/settings/preferences',
    scope: 'USER',
    status: 'BUILT_IN',
  },
  {
    id: 'future',
    category: 'SYSTEM',
    name: 'Future setting',
    description: 'Not yet available',
    href: '/future',
    scope: 'COMPANY',
    status: 'PLANNED',
  },
];
const ok = () => Promise.resolve({ ok: true, json: async () => ({ data: { entries } }) });
beforeEach(() => {
  vi.stubGlobal(
    'matchMedia',
    vi.fn(() => ({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() })),
  );
  vi.stubGlobal('fetch', state.fetch);
  state.fetch.mockReset().mockImplementation(ok);
  localStorage.clear();
  document.documentElement.classList.remove('dark', 'motion-reduced');
});

describe('Settings workspace', () => {
  it('filters permissions, searches the catalog, and keeps planned entries inert', async () => {
    const user = userEvent.setup();
    render(<SettingsWorkspace />);
    await user.click(await screen.findByRole('button', { name: 'All settings', exact: true }));
    expect(await screen.findByRole('link', { name: /Companies/ })).toHaveAttribute(
      'href',
      '/companies',
    );
    expect(screen.queryByRole('link', { name: /Roles/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'People & access' })).not.toBeInTheDocument();
    expect(screen.getByText('Future setting').closest('[aria-disabled]')).toHaveAttribute(
      'aria-disabled',
      'true',
    );
    expect(screen.queryByRole('link', { name: /Future/ })).not.toBeInTheDocument();
    await user.type(screen.getByRole('searchbox', { name: 'Search settings' }), 'identity');
    expect(screen.getByRole('link', { name: /Companies/ })).toBeVisible();
    expect(screen.queryByText('Future setting')).not.toBeInTheDocument();
    await user.selectOptions(screen.getByLabelText('Scope'), 'USER');
    expect(screen.getByRole('heading', { name: 'No settings found' })).toBeVisible();
    await user.click(screen.getByRole('button', { name: 'Clear filters' }));
    expect(screen.getByRole('link', { name: /Companies/ })).toBeVisible();
  });
  it('leaves personal controls available on service failure and retries the catalog', async () => {
    state.fetch.mockResolvedValueOnce({ ok: false });
    const user = userEvent.setup();
    render(<SettingsWorkspace />);
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'personal controls are still available',
    );
    await user.click(screen.getByRole('button', { name: 'Dark', exact: true }));
    expect(document.documentElement).toHaveClass('dark');
    await user.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByRole('button', { name: 'Organization' })).toBeVisible();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });
  it('keeps appearance and motion synchronized across mounted settings surfaces', async () => {
    const user = userEvent.setup();
    render(
      <>
        <section aria-label="Page">
          <WorkspaceControls />
        </section>
        <section aria-label="Dock">
          <WorkspaceControls />
        </section>
      </>,
    );
    const page = within(screen.getByRole('region', { name: 'Page' }));
    const dock = within(screen.getByRole('region', { name: 'Dock' }));
    await user.click(page.getByRole('button', { name: 'Dark', exact: true }));
    expect(dock.getByRole('button', { name: 'Dark', exact: true })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    await user.selectOptions(page.getByRole('combobox', { name: /Motion/ }), 'reduced');
    expect(dock.getByRole('combobox', { name: /Motion/ })).toHaveValue('reduced');
    expect(document.documentElement).toHaveClass('motion-reduced');
    await user.selectOptions(
      page.getByRole('combobox', { name: /When ITEMBA OS opens/ }),
      'resume',
    );
    expect(dock.getByRole('combobox', { name: /When ITEMBA OS opens/ })).toHaveValue('resume');
  });
  it('requires confirmation, handles reset failure, and Escape leaves the Settings window open', async () => {
    const close = vi.fn();
    const user = userEvent.setup();
    render(
      <Modal open onClose={close} title="System settings">
        <SettingsWorkspace embedded />
      </Modal>,
    );
    await screen.findByRole('button', { name: 'Organization' });
    await user.click(screen.getByRole('button', { name: 'Restore defaults', exact: true }));
    expect(state.fetch).toHaveBeenCalledTimes(1);
    await user.keyboard('{Escape}');
    expect(close).not.toHaveBeenCalled();
    await waitFor(() =>
      expect(
        screen.queryByRole('dialog', { name: 'Restore personal defaults?' }),
      ).not.toBeInTheDocument(),
    );
    await user.click(screen.getByRole('button', { name: 'Restore defaults', exact: true }));
    state.fetch.mockResolvedValueOnce({ ok: false });
    await user.click(
      within(screen.getByRole('dialog', { name: 'Restore personal defaults?' })).getByRole(
        'button',
        { name: 'Restore defaults' },
      ),
    );
    expect(
      await screen.findByText('Your preferences could not be reset. Please try again.'),
    ).toBeVisible();
    expect(close).not.toHaveBeenCalled();
  });
});
