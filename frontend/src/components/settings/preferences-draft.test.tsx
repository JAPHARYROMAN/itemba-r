import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, expect, it, vi } from 'vitest';
import PreferencesPage from '@/app/(dashboard)/settings/preferences/page';
import { UnsavedWorkProvider } from '@/components/workspace/unsaved-work-provider';

const state = vi.hoisted(() => ({
  router: { push: vi.fn() },
  fetch: vi.fn(),
  theme: vi.fn(),
  motion: vi.fn(),
}));
vi.mock('next/navigation', () => ({ useRouter: () => state.router }));
vi.mock('@/hooks/use-theme', () => ({ useTheme: () => ({ setMode: state.theme }) }));
vi.mock('@/hooks/use-motion-preference', () => ({
  useMotionPreference: () => ({ setMode: state.motion, mode: 'system', hydrated: true }),
}));
vi.mock('@/components/aurora/feedback', () => ({ showToast: vi.fn() }));
beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal('fetch', state.fetch);
  let saves = 0;
  state.fetch.mockImplementation(async (url: string, init?: RequestInit) => {
    if (init?.method === 'PUT') {
      saves += 1;
      return saves === 1
        ? { ok: false, json: async () => ({ message: 'Save interrupted' }) }
        : { ok: true, json: async () => ({ data: JSON.parse(init.body as string) }) };
    }
    return {
      ok: true,
      json: async () => ({
        data: url.includes('/companies') ? [] : { theme: 'light', timezone: 'Africa/Nairobi' },
      }),
    };
  });
  HTMLDialogElement.prototype.showModal = function () {
    this.setAttribute('open', '');
  };
  HTMLDialogElement.prototype.close = function () {
    this.removeAttribute('open');
  };
});

it('keeps edited preferences after failure and removes the navigation guard only after a successful save', async () => {
  const user = userEvent.setup();
  render(
    <UnsavedWorkProvider>
      <PreferencesPage />
    </UnsavedWorkProvider>,
  );
  await user.selectOptions(await screen.findByRole('combobox', { name: 'Timezone' }), 'UTC');
  await user.click(screen.getByRole('button', { name: 'Save settings' }));
  expect(await screen.findByText('Save interrupted')).toBeVisible();
  await user.click(screen.getByRole('link', { name: 'Settings', exact: true }));
  expect(screen.getByRole('dialog', { name: 'Keep your changes?' })).toBeVisible();
  await user.click(screen.getByRole('button', { name: 'Stay here' }));
  expect(screen.getByRole('combobox', { name: 'Timezone' })).toHaveValue('UTC');
  await user.click(screen.getByRole('button', { name: 'Save settings' }));
  await screen.findByText('Preferences saved.');
  const event = new Event('beforeunload', { cancelable: true });
  window.dispatchEvent(event);
  expect(event.defaultPrevented).toBe(false);
  await waitFor(() =>
    expect(state.fetch.mock.calls.filter((call) => call[1]?.method === 'PUT')).toHaveLength(2),
  );
});
