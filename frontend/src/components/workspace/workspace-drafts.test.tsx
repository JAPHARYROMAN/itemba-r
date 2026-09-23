import { useEffect, useState } from 'react';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  WorkspaceDraftsProvider,
  WorkspaceDraftShelf,
  DraftFormNotice,
  useWorkspaceDraftForm,
  useWorkspaceDrafts,
} from './workspace-drafts';
import { UnsavedWorkProvider, useGuardedRouter, useUnsavedWork } from './unsaved-work-provider';
import { WorkspaceSessionProvider } from './workspace-session';
import { UnsavedWorkScope } from './unsaved-work-provider';

const state = vi.hoisted(() => ({
  router: { push: vi.fn(), replace: vi.fn(), back: vi.fn(), forward: vi.fn() },
  auth: { id: 'alice', companyId: 'company', permissions: ['invoice_desk.view'] },
  save: vi.fn(),
  changed: false,
  reviewKey: 'first',
  signOut: vi.fn(),
}));
vi.mock('next/navigation', () => ({
  useRouter: () => state.router,
  usePathname: () => '/invoice-desk',
}));
vi.mock('@/hooks/use-auth', () => ({
  useAuth: () => ({ user: state.auth, hasPermission: () => true }),
}));

function Form({
  draftId,
  close,
  appId = 'invoice-desk',
}: {
  draftId?: string;
  close: () => void;
  appId?: string;
}) {
  const draft = useWorkspaceDraftForm(
    { description: '', amount: '100' },
    {
      appId,
      title: 'Purchase',
      context: { kind: 'purchase', version: state.changed ? '3' : '2' },
      draftId,
      needsReview: state.changed,
      reviewKey: state.reviewKey,
      busy: false,
      onClose: close,
    },
  );
  const [error, setError] = useState('');
  return (
    <form
      {...draft.guard.capture}
      onSubmit={async (event) => {
        event.preventDefault();
        try {
          draft.validateReview();
          draft.beginRequest();
          await state.save({
            ...draft.form,
            requestId: draft.requestId.current,
            version: draft.requestContext.current?.version,
          });
          draft.markSaved();
          close();
        } catch {
          setError('Save did not complete');
        }
      }}
    >
      <DraftFormNotice draft={draft} />
      <input
        aria-label="Description"
        value={draft.form.description}
        onChange={(event) => draft.setForm({ ...draft.form, description: event.target.value })}
      />
      <button type="button" onClick={draft.keep}>
        Keep draft
      </button>
      <button type="submit">Save</button>
      <button type="button" onClick={() => draft.guard.requestClose(close)}>
        Close form
      </button>
      {error && <p role="alert">{error}</p>}
    </form>
  );
}
function Workspace() {
  const [app, setApp] = useState('/invoice-desk');
  const [editor, setEditor] = useState<string | null>('new');
  const router = useGuardedRouter();
  const { request } = useUnsavedWork();
  useEffect(() => {
    state.router.push.mockImplementation((path: string) => {
      setEditor(null);
      setApp(path);
    });
  }, []);
  return (
    <>
      <button onClick={() => router.push('/cash-desk')}>Open Cash</button>
      <button onClick={() => router.push('/invoice-desk')}>Open Invoices</button>
      <button onClick={() => request(state.signOut)}>Sign out</button>
      {app === '/invoice-desk' ? (
        <>
          <WorkspaceDraftShelf appId="invoice-desk" onResume={(row) => setEditor(row.id)} />
          {editor && (
            <Form
              key={editor}
              draftId={editor === 'new' ? undefined : editor}
              close={() => setEditor(null)}
            />
          )}
        </>
      ) : (
        <p>Cash workspace</p>
      )}
    </>
  );
}
function App() {
  return (
    <WorkspaceSessionProvider>
      <UnsavedWorkProvider>
        <WorkspaceDraftsProvider>
          <Workspace />
        </WorkspaceDraftsProvider>
      </UnsavedWorkProvider>
    </WorkspaceSessionProvider>
  );
}

function DraftPane({
  name,
  initial = false,
  deferred,
}: {
  name: string;
  initial?: boolean;
  deferred?: () => Promise<void>;
}) {
  const [editor, setEditor] = useState<string | null>(initial ? 'new' : null);
  const { drafts } = useWorkspaceDrafts('invoice-desk');
  return (
    <UnsavedWorkScope id={name}>
      <section aria-label={name}>
        <WorkspaceDraftShelf
          appId="invoice-desk"
          activeDraftId={editor || undefined}
          onResume={async (draft) => {
            if (deferred) await deferred();
            setEditor(draft.id);
          }}
        />
        <button onClick={() => setEditor(drafts[0]?.id || null)}>Complete a stale resume</button>
        {editor && (
          <Form
            key={editor}
            draftId={editor === 'new' ? undefined : editor}
            close={() => setEditor(null)}
          />
        )}
      </section>
    </UnsavedWorkScope>
  );
}
function TwoPanes({ deferred }: { deferred?: () => Promise<void> }) {
  return (
    <WorkspaceSessionProvider>
      <UnsavedWorkProvider>
        <WorkspaceDraftsProvider>
          <DraftPane name="Primary" initial deferred={deferred} />
          <DraftPane name="Companion" />
        </WorkspaceDraftsProvider>
      </UnsavedWorkProvider>
    </WorkspaceSessionProvider>
  );
}
function StaleDraft({ missing }: { missing: boolean }) {
  const { drafts, remove } = useWorkspaceDrafts('invoice-desk');
  const [editor, setEditor] = useState<string | null>('new');
  return (
    <>
      <button
        onClick={() => {
          const retained = drafts[0];
          if (!retained) return;
          if (missing) remove(retained.id);
          setEditor(retained.id);
        }}
      >
        Open stale draft
      </button>
      {editor && (
        <Form
          key={editor}
          draftId={editor === 'new' ? undefined : editor}
          appId={editor === 'new' || missing ? 'invoice-desk' : 'cash-desk'}
          close={() => setEditor(null)}
        />
      )}
    </>
  );
}
beforeEach(() => {
  vi.clearAllMocks();
  state.auth = { id: 'alice', companyId: 'company', permissions: ['invoice_desk.view'] };
  state.changed = false;
  state.reviewKey = 'first';
  state.save.mockResolvedValue(undefined);
  history.replaceState({}, '', '/invoice-desk');
  HTMLDialogElement.prototype.showModal = function () {
    this.setAttribute('open', '');
  };
  HTMLDialogElement.prototype.close = function () {
    this.removeAttribute('open');
  };
});
describe('Workspace draft lifecycle', () => {
  it.each([true, false])(
    'does not submit an unavailable or foreign-app draft (missing=%s)',
    async (missing) => {
      render(
        <UnsavedWorkProvider>
          <WorkspaceDraftsProvider>
            <StaleDraft missing={missing} />
          </WorkspaceDraftsProvider>
        </UnsavedWorkProvider>,
      );
      fireEvent.change(screen.getByLabelText('Description'), {
        target: { value: 'Private purchase' },
      });
      fireEvent.click(screen.getByText('Keep draft', { exact: true }));
      fireEvent.click(screen.getByText('Open stale draft'));
      expect(await screen.findByRole('alert')).toHaveTextContent('no longer available');
      expect(screen.getByLabelText('Description')).toHaveValue('');
      fireEvent.click(screen.getByText('Save', { exact: true }));
      expect(state.save).not.toHaveBeenCalled();
      fireEvent.click(screen.getByText('Close form'));
      expect(screen.queryByRole('button', { name: 'Discard changes' })).not.toBeInTheDocument();
    },
  );
  it('keeps an active editor usable when an exit action does not unmount it', async () => {
    const user = userEvent.setup();
    render(<App />);
    await user.type(screen.getByLabelText('Description'), 'Before exit');
    await user.click(screen.getByText('Keep draft', { exact: true }));
    await user.click(screen.getByRole('button', { name: 'Resume Purchase' }));
    await user.click(screen.getByText('Sign out'));
    await user.click(screen.getByText('Discard changes'));
    expect(state.signOut).toHaveBeenCalledOnce();
    fireEvent.change(screen.getByLabelText('Description'), { target: { value: 'Continued work' } });
    await user.click(screen.getByText('Keep draft', { exact: true }));
    await user.click(screen.getByRole('button', { name: 'Resume Purchase' }));
    expect(screen.getByLabelText('Description')).toHaveValue('Continued work');
    await user.click(screen.getByText('Save', { exact: true }));
    await waitFor(() => expect(state.save).toHaveBeenCalledOnce());
  });
  it('gives one editor ownership across windows and resumes the latest kept values after release', async () => {
    render(<TwoPanes />);
    const primary = within(screen.getByLabelText('Primary'));
    const companion = within(screen.getByLabelText('Companion'));
    fireEvent.change(primary.getByLabelText('Description'), {
      target: { value: 'Original count' },
    });
    fireEvent.click(primary.getByText('Keep draft', { exact: true }));
    fireEvent.click(primary.getByRole('button', { name: 'Resume Purchase' }));
    await primary.findByLabelText('Description');
    expect(companion.getByRole('button', { name: 'Resume Purchase' })).toBeDisabled();
    expect(companion.getByRole('button', { name: 'Discard Purchase' })).toBeDisabled();
    fireEvent.change(primary.getByLabelText('Description'), {
      target: { value: 'Reviewed count' },
    });
    fireEvent.click(primary.getByText('Keep draft', { exact: true }));
    fireEvent.click(companion.getByRole('button', { name: 'Resume Purchase' }));
    expect(await companion.findByLabelText('Description')).toHaveValue('Reviewed count');
    expect(state.save).not.toHaveBeenCalled();
    fireEvent.click(companion.getByText('Save', { exact: true }));
    await waitFor(() => expect(state.save).toHaveBeenCalledOnce());
  });
  it('rejects a late second editor without allowing its save, keep or close to affect the first', async () => {
    render(<TwoPanes />);
    const primary = within(screen.getByLabelText('Primary'));
    const companion = within(screen.getByLabelText('Companion'));
    fireEvent.change(primary.getByLabelText('Description'), { target: { value: 'Owned draft' } });
    fireEvent.click(primary.getByText('Keep draft', { exact: true }));
    fireEvent.click(primary.getByRole('button', { name: 'Resume Purchase' }));
    await primary.findByLabelText('Description');
    fireEvent.click(companion.getByText('Complete a stale resume'));
    expect(await companion.findByRole('alert')).toHaveTextContent('open in another window');
    fireEvent.click(companion.getByText('Save', { exact: true }));
    expect(state.save).not.toHaveBeenCalled();
    fireEvent.click(companion.getByText('Keep draft', { exact: true }));
    expect(primary.getByLabelText('Description')).toHaveValue('Owned draft');
    fireEvent.click(companion.getByText('Close form'));
    expect(screen.queryByRole('button', { name: 'Discard changes' })).not.toBeInTheDocument();
    fireEvent.click(primary.getByText('Keep draft', { exact: true }));
    expect(companion.getByRole('button', { name: 'Resume Purchase' })).toBeEnabled();
  });
  it('reserves a draft during an asynchronous resume and releases it when the read fails', async () => {
    let reject!: (error: Error) => void;
    render(
      <TwoPanes
        deferred={() =>
          new Promise((_, fail) => {
            reject = fail;
          })
        }
      />,
    );
    const primary = within(screen.getByLabelText('Primary'));
    const companion = within(screen.getByLabelText('Companion'));
    fireEvent.change(primary.getByLabelText('Description'), { target: { value: 'Read again' } });
    fireEvent.click(primary.getByText('Keep draft', { exact: true }));
    fireEvent.click(primary.getByRole('button', { name: 'Resume Purchase' }));
    expect(companion.getByRole('button', { name: 'Resume Purchase' })).toBeDisabled();
    await act(async () => reject(new Error('Could not reload the source record')));
    expect(primary.getByRole('alert')).toHaveTextContent('Could not reload');
    expect(companion.getByRole('button', { name: 'Resume Purchase' })).toBeEnabled();
    fireEvent.click(companion.getByRole('button', { name: 'Resume Purchase' }));
    expect(await companion.findByLabelText('Description')).toHaveValue('Read again');
  });
  it('requires a new confirmation when changed data arrives after mount or changes again', () => {
    const view = render(<App />);
    state.changed = true;
    view.rerender(<App />);
    expect(screen.getByRole('checkbox')).not.toBeChecked();
    fireEvent.click(screen.getByRole('checkbox'));
    expect(screen.getByRole('checkbox')).toBeChecked();
    state.reviewKey = 'second';
    view.rerender(<App />);
    expect(screen.getByRole('checkbox')).not.toBeChecked();
    fireEvent.click(screen.getByText('Save', { exact: true }));
    expect(state.save).not.toHaveBeenCalled();
  });
  it('keeps a form through app unmount, offers it on return, and resumes without submitting', async () => {
    const user = userEvent.setup();
    render(<App />);
    await user.type(screen.getByLabelText('Description'), 'Fuel for the branch');
    await user.click(screen.getByText('Open Cash'));
    expect(state.router.push).not.toHaveBeenCalled();
    await user.click(screen.getByText('Keep draft and continue'));
    expect(screen.getByText('Cash workspace')).toBeVisible();
    await user.click(screen.getByText('Open Invoices'));
    await user.click(screen.getByRole('button', { name: 'Resume Purchase' }));
    expect(screen.getByLabelText('Description')).toHaveValue('Fuel for the branch');
    expect(state.save).not.toHaveBeenCalled();
    await user.click(screen.getByText('Save', { exact: true }));
    await waitFor(() =>
      expect(screen.queryByLabelText('Unfinished drafts')).not.toBeInTheDocument(),
    );
  });
  it('preserves the request identity after a failed save, keep, resume and retry', async () => {
    const user = userEvent.setup();
    state.save.mockRejectedValueOnce(new Error('response lost'));
    render(<App />);
    await user.type(screen.getByLabelText('Description'), 'Supplier payment');
    await user.click(screen.getByText('Save', { exact: true }));
    await screen.findByRole('alert');
    const first = state.save.mock.calls[0][0];
    await user.click(screen.getByText('Keep draft', { exact: true }));
    state.changed = true;
    await user.click(screen.getByRole('button', { name: 'Resume Purchase' }));
    expect(state.save).toHaveBeenCalledTimes(1);
    await user.click(screen.getByRole('checkbox'));
    await user.click(screen.getByText('Save', { exact: true }));
    expect(state.save).toHaveBeenLastCalledWith(first);
  });
  it('requires review of changed source data, even if the draft is kept a second time', async () => {
    const user = userEvent.setup();
    render(<App />);
    await user.type(screen.getByLabelText('Description'), 'Old balance');
    await user.click(screen.getByText('Keep draft', { exact: true }));
    state.changed = true;
    await user.click(screen.getByRole('button', { name: 'Resume Purchase' }));
    await user.click(screen.getByText('Save', { exact: true }));
    expect(state.save).not.toHaveBeenCalled();
    await user.click(screen.getByText('Keep draft', { exact: true }));
    state.changed = false;
    await user.click(screen.getByRole('button', { name: 'Resume Purchase' }));
    expect(screen.getByRole('checkbox')).not.toBeChecked();
    await user.click(screen.getByRole('checkbox'));
    await user.click(screen.getByText('Save', { exact: true }));
    expect(state.save).toHaveBeenCalledOnce();
  });
  it('warns before reload or sign-out for retained drafts without blocking other workspace navigation', async () => {
    const user = userEvent.setup();
    render(<App />);
    await user.type(screen.getByLabelText('Description'), 'Unfinished');
    await user.click(screen.getByText('Keep draft', { exact: true }));
    await user.click(screen.getByText('Open Cash'));
    expect(screen.getByText('Cash workspace')).toBeVisible();
    const unload = new Event('beforeunload', { cancelable: true });
    fireEvent(window, unload);
    expect(unload.defaultPrevented).toBe(true);
    await user.click(screen.getByText('Sign out'));
    expect(screen.queryByText('Keep draft and continue')).not.toBeInTheDocument();
    expect(state.signOut).not.toHaveBeenCalled();
    await user.click(screen.getByText('Stay here'));
    await user.click(screen.getByText('Open Invoices'));
    expect(screen.getByRole('button', { name: 'Resume Purchase' })).toBeVisible();
    await user.click(screen.getByText('Sign out'));
    await user.click(screen.getByText('Discard changes'));
    expect(state.signOut).toHaveBeenCalledOnce();
    expect(screen.queryByLabelText('Unfinished drafts')).not.toBeInTheDocument();
  });
  it.each(['account', 'permissions'])(
    'clears retained business input when the %s boundary changes',
    async (boundary) => {
      const user = userEvent.setup();
      const { rerender } = render(<App />);
      await user.type(screen.getByLabelText('Description'), 'Private entry');
      await user.click(screen.getByText('Keep draft', { exact: true }));
      if (boundary === 'account') state.auth = { ...state.auth, id: 'bob' };
      else state.auth = { ...state.auth, permissions: [] };
      rerender(<App />);
      expect(screen.queryByLabelText('Unfinished drafts')).not.toBeInTheDocument();
      expect(screen.getByLabelText('Description')).toHaveValue('');
    },
  );
  it('only discards a retained draft after its confirmation', async () => {
    const user = userEvent.setup();
    render(<App />);
    await user.type(screen.getByLabelText('Description'), 'Keep me');
    await user.click(screen.getByText('Keep draft', { exact: true }));
    await user.click(screen.getByRole('button', { name: 'Discard Purchase' }));
    const dialog = screen.getByRole('dialog', { name: 'Discard draft?' });
    await user.click(within(dialog).getByText('Keep draft', { exact: true }));
    await user.click(screen.getByRole('button', { name: 'Discard Purchase' }));
    await user.click(
      within(screen.getByRole('dialog', { name: 'Discard draft?' })).getByText('Discard draft', {
        exact: true,
      }),
    );
    expect(screen.queryByLabelText('Unfinished drafts')).not.toBeInTheDocument();
    expect(state.save).not.toHaveBeenCalled();
    const unload = new Event('beforeunload', { cancelable: true });
    act(() => {
      window.dispatchEvent(unload);
    });
    expect(unload.defaultPrevented).toBe(false);
  });
});
