import { useState } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { WorkspaceSessionProvider, useWorkspaceState } from './workspace-session';

const auth = vi.hoisted(() => ({ id: 'alice', permissions: ['invoice_desk.view'] }));
vi.mock('@/hooks/use-auth', () => ({ useAuth: () => ({ user: { ...auth, companyId: 'company' } }) }));

function InvoiceView() {
  const [search, setSearch] = useWorkspaceState('invoice.search', '');
  const [selected, setSelected] = useWorkspaceState<string | null>('invoice.selected', 'original');
  return <><input aria-label="Find invoices" value={search} onChange={(event) => setSearch(event.target.value)} /><button onClick={() => setSelected(null)}>Clear selection</button><span>{selected ?? 'Nothing selected'}</span></>;
}
function Example() {
  const [app, setApp] = useState('invoice');
  return <><button onClick={() => setApp(app === 'invoice' ? 'cash' : 'invoice')}>Switch</button>{app === 'invoice' ? <InvoiceView /> : <p>Cash Desk</p>}</>;
}
beforeEach(() => { auth.id = 'alice'; auth.permissions = ['invoice_desk.view']; });

describe('Workspace view continuity', () => {
  it('restores filters and an explicitly cleared selection after app unmount and remount', async () => {
    const user = userEvent.setup();
    render(<WorkspaceSessionProvider><Example /></WorkspaceSessionProvider>);
    await user.type(screen.getByRole('textbox'), 'Station purchase');
    await user.click(screen.getByRole('button', { name: 'Clear selection' }));
    await user.click(screen.getByRole('button', { name: 'Switch' }));
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Switch' }));
    expect(screen.getByRole('textbox')).toHaveValue('Station purchase');
    expect(screen.getByText('Nothing selected')).toBeVisible();
  });
  it('clears the session when the account or permission boundary changes', async () => {
    const user = userEvent.setup();
    const { rerender } = render(<WorkspaceSessionProvider><InvoiceView /></WorkspaceSessionProvider>);
    await user.type(screen.getByRole('textbox'), 'Private filter');
    auth.id = 'bob';
    rerender(<WorkspaceSessionProvider><InvoiceView /></WorkspaceSessionProvider>);
    expect(screen.getByRole('textbox')).toHaveValue('');
    await user.type(screen.getByRole('textbox'), 'Old permission scope');
    auth.permissions = [];
    rerender(<WorkspaceSessionProvider><InvoiceView /></WorkspaceSessionProvider>);
    expect(screen.getByRole('textbox')).toHaveValue('');
  });
});
