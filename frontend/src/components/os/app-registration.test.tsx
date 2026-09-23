import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { OsShell } from './os-shell';
import type { WorkspaceApp } from '@/lib/apps';

const state = vi.hoisted(() => ({ allowed: true, push: vi.fn() }));
vi.mock('@/lib/apps', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/apps')>();
  const future: WorkspaceApp = {
    id: 'field-notes',
    href: '/apps/field-notes',
    label: 'Field Notes',
    description: 'Site notebooks',
    category: 'Productivity',
    icon: 'document',
    iconKey: 'grid',
    appearance: 'default',
    permission: 'field_notes.access',
    keywords: ['notebooks'],
    launch: {
      kind: 'external',
      urlVariable: 'NOTES_URL',
      healthVariable: 'NOTES_HEALTH',
      authentication: 'Notes account',
    },
  };
  const registry = [...actual.APP_REGISTRY, future];
  return {
    ...actual,
    APP_REGISTRY: registry,
    getApp: (id: string) => registry.find((app) => app.id === id),
  };
});
vi.mock('next/navigation', () => ({
  usePathname: () => '/dashboard',
  useRouter: () => ({ push: state.push }),
}));
vi.mock('@/hooks/use-auth', () => ({
  useAuth: () => ({
    user: { id: 'future-reader', fullName: 'App Reader', roles: [] },
    hasPermission: (p: string) => state.allowed && p === 'field_notes.access',
    loading: false,
  }),
}));
vi.mock('@/components/msaidizi/msaidizi-launcher', () => ({ MsaidiziTopbarButton: () => null }));
vi.mock('@/components/aurora/command/CommandPaletteProvider', () => ({
  useCommandPalette: () => ({ open: vi.fn() }),
}));
vi.mock('@/hooks/use-theme', () => ({ useTheme: () => ({ mode: 'system', setMode: vi.fn() }) }));
vi.mock('@/components/apps/app-launcher', () => ({
  AppLauncher: ({ app, appUrl }: { app: WorkspaceApp; appUrl: string }) => (
    <section aria-label="External app">
      <h1>{app.label}</h1>
      <a href={appUrl}>Launch service</a>
    </section>
  ),
}));

beforeEach(() => {
  vi.stubGlobal('matchMedia', vi.fn((media: string) => ({
    matches: false, media, onchange: null,
    addListener: vi.fn(), removeListener: vi.fn(),
    addEventListener: vi.fn(), removeEventListener: vi.fn(), dispatchEvent: vi.fn(),
  })));
  localStorage.clear();
  state.allowed = true;
  state.push.mockReset();
});
describe('A newly registered app', () => {
  it('appears in the library, can be pinned to the dock, and opens through the common launcher', async () => {
    const user = userEvent.setup();
    render(
      <OsShell appUrls={{ 'field-notes': 'https://notes.example.test' }}>
        <input aria-label="ERP draft" defaultValue="Keep this" />
      </OsShell>,
    );
    await user.click(screen.getByRole('button', { name: 'Show Apps' }));
    await user.click(screen.getByRole('button', { name: 'Pin Field Notes' }));
    const dock = screen.getByRole('navigation', { name: 'Applications' });
    await user.click(within(dock).getByRole('button', { name: 'Open Field Notes' }));
    expect(screen.getByRole('region', { name: 'External app' })).toBeVisible();
    expect(screen.getByRole('link', { name: 'Launch service' })).toHaveAttribute(
      'href',
      'https://notes.example.test',
    );
    await user.click(within(dock).getByRole('button', { name: 'Open ITEMBA-R' }));
    expect(screen.getByRole('textbox', { name: 'ERP draft' })).toHaveValue('Keep this');
    expect(state.push).not.toHaveBeenCalled();
  });
  it('keeps the same app out of both surfaces when permission is absent', async () => {
    state.allowed = false;
    render(
      <OsShell appUrls={{}}>
        <p>ERP</p>
      </OsShell>,
    );
    await userEvent.click(screen.getByRole('button', { name: 'Show Apps' }));
    expect(screen.queryByRole('link', { name: 'Open Field Notes' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Open Field Notes' })).not.toBeInTheDocument();
  });
});
