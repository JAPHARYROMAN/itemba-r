import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import {
  WorkspaceInstanceProvider,
  WorkspaceSessionProvider,
  useWorkspaceState,
} from './workspace-session';
import type { DesktopViewState } from '@/lib/desktop-view-state';
import { parseDesktopSession } from '@/lib/desktop';
vi.mock('@/hooks/use-auth', () => ({ useAuth: () => ({ user: { id: 'owner' } }) }));

function View({ name }: { name: string }) {
  const [section, setSection] = useWorkspaceState('invoice-desk.section', 'overview');
  const [scope, setScope] = useWorkspaceState('invoice-desk.scope', {
    companyId: '',
    divisionId: '',
    branchId: '',
  });
  const [search, setSearch] = useWorkspaceState('invoice-desk.search', '');
  const [draft, setDraft] = useWorkspaceState('invoice-desk.new.description', '');
  return (
    <section aria-label={name}>
      <button onClick={() => setSection('invoices')}>{section}</button>
      <input
        aria-label="Company"
        value={scope.companyId}
        onChange={(e) => setScope({ ...scope, companyId: e.target.value })}
      />
      <input aria-label="Search" value={search} onChange={(e) => setSearch(e.target.value)} />
      <input aria-label="Draft" value={draft} onChange={(e) => setDraft(e.target.value)} />
    </section>
  );
}
describe('acknowledged desktop view recovery', () => {
  it('rehydrates independent views after remount without copying financial inputs into layouts', () => {
    const saved: Record<string, DesktopViewState> = {};
    const fixture = () => (
      <WorkspaceSessionProvider>
        {['a', 'b'].map((id) => (
          <WorkspaceInstanceProvider
            key={id}
            id={id}
            appId="invoice-desk"
            viewState={saved[id]}
            onViewChange={(key, value) => {
              saved[key] = value;
            }}
          >
            <View name={id} />
          </WorkspaceInstanceProvider>
        ))}
      </WorkspaceSessionProvider>
    );
    const first = render(fixture());
    for (const id of ['a', 'b']) {
      const view = within(screen.getByRole('region', { name: id }));
      fireEvent.click(view.getByRole('button'));
      fireEvent.change(view.getByLabelText('Company'), { target: { value: `company-${id}` } });
      fireEvent.change(view.getByLabelText('Search'), { target: { value: `search-${id}` } });
      fireEvent.change(view.getByLabelText('Draft'), {
        target: { value: 'Private payment instructions' },
      });
    }
    const recovered = parseDesktopSession({
      version: 1,
      activeId: 'a',
      windows: ['a', 'b'].map((id) => ({
        id,
        appId: 'invoice-desk',
        href: '/invoice-desk',
        viewState: saved[id],
      })),
    });
    expect(JSON.stringify(recovered)).not.toContain('Private payment');
    recovered.windows.forEach((window) => {
      saved[window.id] = window.viewState!;
    });
    first.unmount();
    render(fixture());
    for (const id of ['a', 'b']) {
      const view = within(screen.getByRole('region', { name: id }));
      expect(view.getByRole('button', { name: 'invoices' })).toBeInTheDocument();
      expect(view.getByLabelText('Company')).toHaveValue(`company-${id}`);
      expect(view.getByLabelText('Search')).toHaveValue(`search-${id}`);
      expect(view.getByLabelText('Draft')).toHaveValue('');
    }
  });
});
