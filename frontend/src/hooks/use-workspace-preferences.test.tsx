import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { useWorkspacePreferences } from './use-workspace-preferences';
import { DEFAULT_WORKSPACE, workspaceKey } from '@/lib/workspace-preferences';
function Example({ userId, label }: { userId: string; label: string }) {
  const { preferences, update } = useWorkspacePreferences(userId);
  return (
    <button onClick={() => update((current) => ({ ...current, maximized: !current.maximized }))}>
      {label}: {preferences.maximized ? 'large' : 'normal'}
    </button>
  );
}
describe('Workspace preference subscriptions', () => {
  it('synchronizes same-account surfaces, switches accounts, and handles cross-tab changes', async () => {
    localStorage.clear();
    const user = userEvent.setup();
    const { rerender } = render(
      <>
        <Example userId="subscription-a" label="one" />
        <Example userId="subscription-a" label="two" />
      </>,
    );
    await user.click(screen.getByRole('button', { name: 'one: normal' }));
    expect(screen.getByRole('button', { name: 'two: large' })).toBeVisible();
    rerender(
      <>
        <Example userId="subscription-b" label="one" />
        <Example userId="subscription-a" label="two" />
      </>,
    );
    expect(screen.getByRole('button', { name: 'one: normal' })).toBeVisible();
    expect(screen.getByRole('button', { name: 'two: large' })).toBeVisible();
    act(() => {
      localStorage.setItem(workspaceKey('subscription-a'), JSON.stringify(DEFAULT_WORKSPACE));
      window.dispatchEvent(new StorageEvent('storage', { key: workspaceKey('subscription-a') }));
    });
    expect(screen.getByRole('button', { name: 'two: normal' })).toBeVisible();
  });
});
