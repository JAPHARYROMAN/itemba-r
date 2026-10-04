import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import {
  WorkspaceSessionProvider,
  WorkspaceInstanceProvider,
  useWorkspaceState,
} from '@/components/workspace/workspace-session';
import { parseDesktopSession } from '@/lib/desktop';
import { parseDesktopViewState } from '@/lib/desktop-view-state';
vi.mock('@/hooks/use-auth', () => ({
  useAuth: () => ({ user: { id: 'admin', permissions: ['pos_drafts.view'] } }),
}));
function Filters({ name }: { name: string }) {
  const [value, setValue] = useWorkspaceState('pos-draft.search', '');
  return (
    <input aria-label={name} value={value} onChange={(event) => setValue(event.target.value)} />
  );
}
describe('native POS Draft window continuity', () => {
  it('keeps filters independent between two windows and restores a window snapshot', async () => {
    const user = userEvent.setup(),
      save = vi.fn();
    render(
      <WorkspaceSessionProvider>
        <WorkspaceInstanceProvider
          id="first"
          appId="pos-draft"
          viewState={{ version: 1, values: { 'pos-draft.search': 'Cement' } }}
          onViewChange={save}
        >
          <Filters name="First requests" />
        </WorkspaceInstanceProvider>
        <WorkspaceInstanceProvider id="second" appId="pos-draft">
          <Filters name="Second requests" />
        </WorkspaceInstanceProvider>
      </WorkspaceSessionProvider>,
    );
    expect(screen.getByLabelText('First requests')).toHaveValue('Cement');
    expect(screen.getByLabelText('Second requests')).toHaveValue('');
    await user.type(screen.getByLabelText('Second requests'), 'Stock');
    expect(screen.getByLabelText('First requests')).toHaveValue('Cement');
    expect(save).not.toHaveBeenCalled();
    await user.clear(screen.getByLabelText('First requests'));
    await user.type(screen.getByLabelText('First requests'), 'Cashier');
    expect(save).toHaveBeenLastCalledWith('first', {
      version: 1,
      values: { 'pos-draft.search': 'Cashier' },
    });
  });
  it('restores both direct detail links and redirects the retired POS window', () => {
    const windows = [
      { id: 'old', appId: 'pos', href: '/pos?terminal=old', bounds: {}, mode: 'floating' },
      {
        id: 'detail',
        appId: 'pos-draft',
        href: '/pos-draft/requests/draft-id',
        bounds: {},
        mode: 'floating',
      },
    ];
    const restored = parseDesktopSession({ version: 1, windows }).windows;
    expect(restored).toHaveLength(2);
    expect(restored[0]).toMatchObject({ appId: 'pos-draft', href: '/pos-draft?view=pending' });
    expect(restored[1].href).toBe('/pos-draft/requests/draft-id');
  });
  it('preserves only safe view filters, never captured business details', () =>
    expect(
      parseDesktopViewState('pos-draft', {
        version: 1,
        values: {
          'pos-draft.scope': { companyId: 'company', branchId: 'branch' },
          'pos-draft.search': 'Cement',
          'pos-draft.payload': { customerId: 'secret' },
          'pos-draft.pin': '123456',
        },
      }).values,
    ).toEqual({
      'pos-draft.scope': { companyId: 'company', branchId: 'branch' },
      'pos-draft.search': 'Cement',
    }));
});
