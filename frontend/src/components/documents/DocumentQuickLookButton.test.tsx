import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DocumentQuickLookButton } from './DocumentQuickLookButton';
const state = vi.hoisted(() => ({ get: vi.fn(), push: vi.fn(), allowed: true }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: state.push }) }));
vi.mock('@/lib/api-client', () => ({ backendGet: state.get, backendBinaryGet: vi.fn() }));
vi.mock('@/hooks/use-auth', () => ({
  useAuth: () => ({
    user: { id: 'reader', companyId: 'a', permissions: state.allowed ? ['documents.view'] : [] },
    hasPermission: (p: string) => state.allowed && p === 'documents.view',
  }),
}));
const files = [
  { id: 'one', title: 'Asset warranty' },
  { id: 'two & copy', title: 'Signed contract' },
];
beforeEach(() => {
  vi.clearAllMocks();
  state.allowed = true;
  state.get.mockImplementation(async (path) => ({ kind: 'text', text: `Content for ${path}` }));
});
describe('Record attachment Quick Look', () => {
  it('loads on demand, browses attachments, and opens the selected document record', async () => {
    const events = userEvent.setup();
    render(<DocumentQuickLookButton document={files[0]} documents={files} />);
    expect(state.get).not.toHaveBeenCalled();
    await events.click(screen.getByRole('button', { name: 'Preview Asset warranty' }));
    await screen.findByText('Content for /documents/one/preview');
    await events.click(screen.getByRole('button', { name: 'Next file' }));
    await screen.findByText('Content for /documents/two%20%26%20copy/preview');
    await events.click(screen.getByRole('button', { name: 'Open record' }));
    expect(state.push).toHaveBeenCalledWith('/group-control/documents/two%20%26%20copy');
  });
  it('returns keyboard focus to the attachment and hides revoked access', async () => {
    const events = userEvent.setup();
    const view = render(<DocumentQuickLookButton document={files[0]} />);
    await events.click(screen.getByRole('button', { name: 'Preview Asset warranty' }));
    await screen.findByText('Content for /documents/one/preview');
    fireEvent.keyDown(document, { key: 'Escape' });
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Preview Asset warranty' })).toHaveFocus(),
    );
    await events.click(screen.getByRole('button', { name: 'Preview Asset warranty' }));
    await screen.findByText('Content for /documents/one/preview');
    state.allowed = false;
    view.rerender(<DocumentQuickLookButton document={files[0]} />);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });
});
