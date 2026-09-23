import { useState } from 'react';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { axe } from 'jest-axe';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { CommandPalette } from './CommandPalette';
import { UnsavedWorkProvider, useFormGuard } from '@/components/workspace/unsaved-work-provider';

const state = vi.hoisted(() => ({
  get: vi.fn(),
  push: vi.fn(),
  replace: vi.fn(),
  pin: vi.fn(),
  user: { id: 'user-a', companyId: 'a', permissions: ['invoice_desk.view', 'documents.view'] },
}));
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: state.push, replace: state.replace }),
}));
vi.mock('@/hooks/use-auth', () => ({
  useAuth: () => ({
    user: state.user,
    hasPermission: (p: string) => state.user.permissions.includes(p),
  }),
}));
vi.mock('@/lib/api-client', () => ({ backendGet: state.get, backendBinaryGet: vi.fn() }));
vi.mock('@/components/layout/sidebar', () => ({ NAV: [], isGroup: () => false }));
vi.mock('@/hooks/use-personalization', () => ({
  usePersonalization: () => ({
    favorites: [],
    recent: [],
    isFavorite: () => false,
    toggleFavorite: state.pin,
  }),
}));
function Harness() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button onClick={() => setOpen(true)}>Open search</button>
      <CommandPalette open={open} onClose={() => setOpen(false)} />
    </>
  );
}
function DirtyEditor() {
  const [value, setValue] = useState('');
  const guard = useFormGuard(value, setValue);
  return (
    <div {...guard.capture}>
      <label>
        Unfinished note
        <input value={value} onChange={(event) => setValue(event.target.value)} />
      </label>
    </div>
  );
}
const response = (title = 'INV-42', href = '/invoice-desk?record=42') => ({
  query: 'invoice',
  total: 1,
  groups: [
    {
      key: 'desk-invoices',
      label: 'Invoice Desk',
      results: [
        {
          id: '42',
          title,
          href,
          type: 'desk-invoice',
          module: 'Invoice Desk',
          subtitle: 'Supplier · Company A',
        },
      ],
    },
  ],
});
async function open() {
  const events = userEvent.setup();
  await events.click(screen.getByRole('button', { name: 'Open search' }));
  return events;
}
const query = (value: string) =>
  fireEvent.change(screen.getByRole('combobox'), { target: { value } });

beforeEach(() => {
  vi.clearAllMocks();
  HTMLDialogElement.prototype.showModal = function () {
    this.setAttribute('open', '');
  };
  HTMLDialogElement.prototype.close = function () {
    this.removeAttribute('open');
  };
  state.user = {
    id: 'user-a',
    companyId: 'a',
    permissions: ['invoice_desk.view', 'documents.view'],
  };
  state.get.mockResolvedValue({ query: '', total: 0, groups: [] });
});

describe('ITEMBA OS universal search', () => {
  it('offers permitted apps, meaningful filters and an accessible keyboard search', async () => {
    render(<Harness />);
    const events = await open();
    const input = screen.getByRole('combobox', { name: 'Search apps, pages and records' });
    expect(input).toHaveFocus();
    expect(screen.getByRole('option', { name: /Invoice Desk/ })).toBeInTheDocument();
    expect(screen.queryByRole('option', { name: /Cash Desk/ })).not.toBeInTheDocument();
    await events.click(screen.getByRole('button', { name: 'Apps', exact: true }));
    expect(state.get).not.toHaveBeenCalled();
    expect(await axe(document.body)).toHaveNoViolations();
    query('Invoice Desk');
    await events.keyboard('{Enter}');
    expect(state.push).toHaveBeenCalledWith('/invoice-desk');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });
  it('keeps focus inside search, restores its trigger, and leaves Enter on a pin button alone', async () => {
    render(<Harness />);
    const events = await open();
    query('Invoice Desk');
    const pin = screen.getByRole('button', { name: 'Pin Invoice Desk' });
    pin.focus();
    await events.keyboard('{Enter}');
    expect(state.pin).toHaveBeenCalledWith(expect.objectContaining({ href: '/invoice-desk' }));
    expect(state.push).not.toHaveBeenCalled();
    await events.tab();
    expect(screen.getByRole('button', { name: 'Close', exact: true })).toHaveFocus();
    await events.keyboard('{Escape}');
    expect(screen.getByRole('button', { name: 'Open search' })).toHaveFocus();
  });
  it('opens an exact record with keyboard selection and does not pin dynamic records', async () => {
    state.get.mockResolvedValue(response());
    render(<Harness />);
    const events = await open();
    await events.click(screen.getByRole('button', { name: 'Records', exact: true }));
    query('invoice');
    await screen.findByRole('option', { name: /INV-42/ });
    expect(screen.queryByRole('button', { name: /^Pin / })).not.toBeInTheDocument();
    expect(screen.getByRole('combobox')).toHaveAttribute(
      'aria-activedescendant',
      screen.getByRole('option', { name: /INV-42/ }).id,
    );
    await events.keyboard('{Enter}');
    expect(state.push).toHaveBeenCalledWith('/invoice-desk?record=42');
  });
  it('moves the active option with arrow keys and activates the chosen result', async () => {
    const data = response();
    data.groups[0].results.push({
      ...data.groups[0].results[0],
      id: '43',
      title: 'INV-43',
      href: '/invoice-desk?record=43',
    });
    state.get.mockResolvedValue(data);
    render(<Harness />);
    const events = await open();
    await events.click(screen.getByRole('button', { name: 'Records', exact: true }));
    query('invoice');
    await screen.findByRole('option', { name: /INV-42/ });
    await events.keyboard('{ArrowDown}');
    expect(screen.getByRole('option', { name: /INV-43/ })).toHaveAttribute('aria-selected', 'true');
    await events.keyboard('{ArrowUp}{ArrowDown}{Enter}');
    expect(state.push).toHaveBeenCalledWith('/invoice-desk?record=43');
  });
  it('removes old results immediately and ignores an aborted response arriving late', async () => {
    let finishOld!: (value: ReturnType<typeof response>) => void;
    state.get.mockImplementation((_path, options) =>
      options.query.q === 'old'
        ? new Promise((resolve) => {
            finishOld = resolve;
          })
        : Promise.resolve(response('Current result')),
    );
    render(<Harness />);
    await open();
    query('old');
    await waitFor(() => expect(state.get).toHaveBeenCalledTimes(1));
    const signal = state.get.mock.calls[0][1].signal as AbortSignal;
    query('current');
    expect(signal.aborted).toBe(true);
    await screen.findByRole('option', { name: /Current result/ });
    await act(async () => finishOld(response('Stale result')));
    expect(screen.queryByText('Stale result')).not.toBeInTheDocument();
    query('new query');
    expect(screen.queryByText('Current result')).not.toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent('Searching records');
  });
  it('shows a failed search even with no results and retries without losing the query', async () => {
    state.get.mockRejectedValueOnce(new Error('Offline')).mockResolvedValue(response());
    render(<Harness />);
    const events = await open();
    await events.click(screen.getByRole('button', { name: 'Records', exact: true }));
    query('invoice');
    expect(await screen.findByRole('alert')).toHaveTextContent('Record search is unavailable');
    expect(screen.queryByText('No results found.')).not.toBeInTheDocument();
    await events.click(screen.getByRole('button', { name: 'Try again' }));
    await screen.findByRole('option', { name: /INV-42/ });
    expect(screen.getByRole('combobox')).toHaveValue('invoice');
  });
  it('cancels requests on close and starts clean when reopened or permissions change', async () => {
    state.get.mockResolvedValue(response());
    const view = render(<Harness />);
    const events = await open();
    query('invoice');
    await screen.findByRole('option', { name: /INV-42/ });
    const signal = state.get.mock.calls[0][1].signal as AbortSignal;
    await events.keyboard('{Escape}');
    expect(signal.aborted).toBe(true);
    await open();
    expect(screen.getByRole('combobox')).toHaveValue('');
    query('invoice');
    await screen.findByRole('option', { name: /INV-42/ });
    state.user = { id: 'user-b', companyId: 'b', permissions: [] };
    view.rerender(<Harness />);
    expect(screen.getByRole('combobox')).toHaveValue('');
    expect(screen.queryByText('INV-42')).not.toBeInTheDocument();
    expect(screen.queryByRole('option', { name: /Invoice Desk/ })).not.toBeInTheDocument();
  });
  it('ignores external record URLs and IME composition Enter', async () => {
    state.get.mockResolvedValue(response('Unsafe result', '//outside.example/secret'));
    render(<Harness />);
    await open();
    query('invoice');
    await waitFor(() => expect(state.get).toHaveBeenCalled());
    await waitFor(() => expect(screen.getByRole('status')).not.toHaveTextContent('Searching'));
    expect(screen.queryByText('Unsafe result')).not.toBeInTheDocument();
    fireEvent.keyDown(screen.getByRole('combobox'), { key: 'Enter', isComposing: true });
    expect(state.push).not.toHaveBeenCalled();
  });
  it('keeps unfinished work protected when opening a search result', async () => {
    render(
      <UnsavedWorkProvider>
        <DirtyEditor />
        <Harness />
      </UnsavedWorkProvider>,
    );
    fireEvent.change(screen.getByLabelText('Unfinished note'), { target: { value: 'Keep this' } });
    const events = await open();
    query('Invoice Desk');
    await events.keyboard('{Enter}');
    expect(state.push).not.toHaveBeenCalled();
    await events.click(screen.getByRole('button', { name: 'Stay here' }));
    expect(screen.getByLabelText('Unfinished note')).toHaveValue('Keep this');
    expect(state.push).not.toHaveBeenCalled();
  });
});

const fileResults = () => ({
  query: 'receipt',
  total: 2,
  groups: [
    {
      key: 'files',
      label: 'Files',
      results: [
        {
          id: 'doc',
          type: 'document',
          module: 'Documents',
          title: 'Branch agreement',
          href: '/group-control/documents/doc',
          file: { id: 'doc', kind: 'document', title: 'Branch agreement', version: 2 },
        },
        {
          id: 'scan',
          type: 'invoice-attachment',
          module: 'Invoice Desk',
          title: 'Delivery receipt',
          href: '/invoice-desk?record=invoice-1',
          file: {
            id: 'scan',
            kind: 'invoice-attachment',
            invoiceId: 'invoice-1',
            title: 'Delivery receipt',
          },
        },
      ],
    },
  ],
});
function serveFiles() {
  state.get.mockImplementation(async (path: string) =>
    path === '/global-search'
      ? fileResults()
      : {
          kind: 'text',
          text: path.includes('/attachments/') ? 'Signed receipt content' : 'Agreement content',
        },
  );
}
describe('Files in universal search', () => {
  it('previews successive file sources and returns to the query and keyboard selection', async () => {
    serveFiles();
    render(<Harness />);
    const events = await open();
    await events.click(screen.getByRole('button', { name: 'Files', exact: true }));
    expect(screen.getByRole('status')).toHaveTextContent('Enter at least two characters');
    query('receipt');
    await screen.findByRole('option', { name: /Branch agreement/ });
    expect(state.get).toHaveBeenCalledWith(
      '/global-search',
      expect.objectContaining({ query: { q: 'receipt', limit: 5, category: 'files' } }),
    );
    await events.keyboard('{Enter}');
    const dialog = await screen.findByRole('dialog', { name: 'Branch agreement' });
    await within(dialog).findByText('Agreement content');
    expect(state.push).not.toHaveBeenCalled();
    expect(await axe(document.body)).toHaveNoViolations();
    await events.click(within(dialog).getByRole('button', { name: 'Next file' }));
    await screen.findByText('Signed receipt content');
    expect(state.get).toHaveBeenCalledWith(
      '/invoice-desk/invoices/invoice-1/attachments/scan/preview',
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
    await events.keyboard('{Escape}');
    await waitFor(() => expect(screen.getByRole('combobox')).toHaveFocus());
    expect(screen.getByRole('combobox')).toHaveValue('receipt');
    expect(screen.getByRole('option', { name: /Branch agreement/ })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    await events.keyboard('{Escape}');
    expect(screen.getByRole('button', { name: 'Open search' })).toHaveFocus();
  });
  it('opens the currently previewed file owner, including after switching sources', async () => {
    serveFiles();
    render(<Harness />);
    const events = await open();
    query('receipt');
    await events.click(await screen.findByRole('option', { name: /Branch agreement/ }));
    await screen.findByText('Agreement content');
    await events.click(screen.getByRole('button', { name: 'Next file' }));
    await screen.findByText('Signed receipt content');
    await events.click(screen.getByRole('button', { name: 'Open record' }));
    expect(state.push).toHaveBeenCalledWith('/invoice-desk?record=invoice-1');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });
  it('cancels a files query when returning to records and ignores the late response', async () => {
    let finish!: (value: ReturnType<typeof fileResults>) => void;
    state.get.mockImplementation((_path, options) =>
      options.query.category === 'files'
        ? new Promise((resolve) => {
            finish = resolve;
          })
        : Promise.resolve(response()),
    );
    render(<Harness />);
    const events = await open();
    await events.click(screen.getByRole('button', { name: 'Files', exact: true }));
    query('receipt');
    await waitFor(() => expect(state.get).toHaveBeenCalledTimes(1));
    const signal = state.get.mock.calls[0][1].signal as AbortSignal;
    await events.click(screen.getByRole('button', { name: 'Records', exact: true }));
    expect(signal.aborted).toBe(true);
    await screen.findByRole('option', { name: /INV-42/ });
    await act(async () => finish(fileResults()));
    expect(screen.queryByText('Branch agreement')).not.toBeInTheDocument();
  });
  it('clears the preview as soon as file permissions change', async () => {
    serveFiles();
    const view = render(<Harness />);
    const events = await open();
    query('receipt');
    await events.click(await screen.findByRole('option', { name: /Branch agreement/ }));
    await screen.findByText('Agreement content');
    const signal = state.get.mock.calls.find(([path]) => path === '/documents/doc/preview')![1]
      .signal as AbortSignal;
    state.user = { ...state.user, permissions: [] };
    view.rerender(<Harness />);
    expect(signal.aborted).toBe(true);
    expect(screen.queryByText('Agreement content')).not.toBeInTheDocument();
    expect(screen.getByRole('combobox')).toHaveValue('');
  });
  it('shows document actions only to their permitted readers and writers', async () => {
    render(<Harness />);
    const events = await open();
    await events.click(screen.getByRole('button', { name: 'Pages & actions' }));
    query('letter');
    expect(
      screen.queryByRole('option', { name: /Write a company letter/ }),
    ).not.toBeInTheDocument();
    query('file library');
    await events.keyboard('{Enter}');
    expect(state.push).toHaveBeenCalledWith('/documents?view=library');
  });
});
