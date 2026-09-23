import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { RecordBrowser } from './record-browser';
import { WorkspaceSessionProvider } from './workspace-session';

const user = vi.hoisted(() => ({
  id: 'alice',
  companyId: 'company',
  permissions: ['inventory.view'],
}));
vi.mock('@/hooks/use-auth', () => ({ useAuth: () => ({ user }) }));
const row = { id: 'count', name: 'September count', quantity: 20 };
function Browser({ scope = 'branch', quantity = 20, loading = false, retained = true } = {}) {
  return (
    <RecordBrowser
      records={[{ ...row, quantity }]}
      title="Counts"
      name={(record) => record.name}
      fields={[{ label: 'Quantity', value: (record) => record.quantity }]}
      loading={loading}
      stateKey={retained ? 'inventory.selection' : undefined}
      selectionScope={scope}
    />
  );
}
beforeEach(() => {
  user.id = 'alice';
  window.matchMedia = vi.fn().mockReturnValue({ matches: false });
});

describe('Record browser continuity', () => {
  it('does not steal focus from another control when a selected record refreshes', () => {
    window.matchMedia = vi.fn().mockReturnValue({ matches: true });
    const tree = (loading: boolean) => (
      <>
        <button>Another app action</button>
        <Browser loading={loading} />
      </>
    );
    const view = render(tree(false));
    fireEvent.click(screen.getByRole('button', { name: 'Inspect September count' }));
    expect(screen.getByLabelText('Record details')).toHaveFocus();
    const other = screen.getByRole('button', { name: 'Another app action' });
    other.focus();
    view.rerender(tree(true));
    view.rerender(tree(false));
    expect(other).toHaveFocus();
  });
  it('restores the record ID after remount and displays only freshly loaded details', () => {
    const tree = (mounted: boolean, loading = false, quantity = 43) => (
      <WorkspaceSessionProvider>
        {mounted && <Browser quantity={quantity} loading={loading} />}
      </WorkspaceSessionProvider>
    );
    const view = render(tree(true, false, 20));
    fireEvent.click(screen.getByRole('button', { name: 'Inspect September count' }));
    view.rerender(tree(false));
    view.rerender(tree(true, true));
    expect(
      within(screen.getByLabelText('Record details')).queryByRole('heading', { name: row.name }),
    ).not.toBeInTheDocument();
    view.rerender(tree(true));
    expect(within(screen.getByLabelText('Record details')).getByText('43')).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'Close details' }));
    view.rerender(tree(false));
    view.rerender(tree(true));
    expect(screen.queryByRole('button', { name: 'Close details' })).not.toBeInTheDocument();
  });
  it('does not restore a selection into another branch or account', () => {
    const tree = (scope: string) => (
      <WorkspaceSessionProvider>
        <Browser scope={scope} />
      </WorkspaceSessionProvider>
    );
    const view = render(tree('branch'));
    fireEvent.click(screen.getByRole('button', { name: 'Inspect September count' }));
    view.rerender(tree('other-branch'));
    expect(screen.queryByRole('button', { name: 'Close details' })).not.toBeInTheDocument();
    user.id = 'bob';
    view.rerender(tree('branch'));
    expect(screen.queryByRole('button', { name: 'Close details' })).not.toBeInTheDocument();
  });
  it('focuses the inspector in a narrow pane and returns to the correct instance of a repeated record', async () => {
    const rect = vi
      .spyOn(HTMLElement.prototype, 'getBoundingClientRect')
      .mockReturnValue({ width: 640 } as DOMRect);
    try {
      render(
        <WorkspaceSessionProvider>
          <div className="os-workspace-pane">
            <Browser retained={false} />
          </div>
          <div className="os-workspace-pane">
            <Browser retained={false} />
          </div>
        </WorkspaceSessionProvider>,
      );
      const buttons = screen.getAllByRole('button', { name: 'Inspect September count' });
      expect(buttons[0].id).not.toBe(buttons[1].id);
      fireEvent.click(buttons[1]);
      const inspectors = screen.getAllByLabelText('Record details');
      expect(inspectors[1]).toHaveFocus();
      expect(
        within(inspectors[0]).queryByRole('button', { name: 'Close details' }),
      ).not.toBeInTheDocument();
      fireEvent.keyDown(inspectors[1], { key: 'Escape' });
      await waitFor(() => expect(buttons[1]).toHaveFocus());
    } finally {
      rect.mockRestore();
    }
  });
});
