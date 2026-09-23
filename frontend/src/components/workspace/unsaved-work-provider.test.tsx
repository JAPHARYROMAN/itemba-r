import { useState } from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Modal } from '@/components/ui/modal';
import { UnsavedWorkProvider, useFormGuard, useGuardedRouter } from './unsaved-work-provider';

const router = vi.hoisted(() => ({
  push: vi.fn(),
  replace: vi.fn(),
  back: vi.fn(),
  forward: vi.fn(),
}));
vi.mock('next/navigation', () => ({ useRouter: () => router }));

function Editor({
  modal = false,
  save = async () => {},
}: {
  modal?: boolean;
  save?: () => Promise<void>;
}) {
  const [name, setName] = useState('');
  const [closed, setClosed] = useState(false);
  const [error, setError] = useState('');
  const draft = useFormGuard(name, setName);
  const navigation = useGuardedRouter();
  const close = () => draft.requestClose(() => setClosed(true));
  const controls = (
    <>
      <label>
        Name
        <input value={name} onChange={(e) => setName(e.target.value)} />
      </label>
      <button onClick={() => setName('Loaded default')}>Load defaults</button>
      <button onClick={() => draft.change(() => setName('Selected customer'))}>
        Choose customer
      </button>
      <button onClick={close}>Cancel editor</button>
      <button onClick={() => navigation.push('/companies')}>Open Companies</button>
      <button
        onClick={async () => {
          try {
            await save();
            draft.markSaved();
            navigation.push('/companies/saved');
          } catch {
            setError('Save failed');
          }
        }}
      >
        Save
      </button>
      <a href="/finance">Finance</a>
      <a href="/fuel-grid" data-preserve-workspace="" onClick={(e) => e.preventDefault()}>
        Switch app
      </a>
      {error && <p role="alert">{error}</p>}
    </>
  );
  if (closed) return <p>Editor closed</p>;
  return modal ? (
    <Modal open title="Edit company" onClose={close} onChangeCapture={draft.touch}>
      {controls}
    </Modal>
  ) : (
    <div {...draft.capture}>{controls}</div>
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  history.replaceState({}, '', '/companies/new');
  HTMLDialogElement.prototype.showModal = function () {
    this.setAttribute('open', '');
  };
  HTMLDialogElement.prototype.close = function () {
    this.removeAttribute('open');
  };
});
afterEach(() => vi.unstubAllGlobals());

describe('Unsaved workspace protection', () => {
  it.each(['traverse', 'reload'])(
    'protects a cancellable Navigation API %s before the router handles it',
    async (navigationType) => {
      const user = userEvent.setup();
      const navigation = Object.assign(new EventTarget(), { traverseTo: vi.fn() });
      vi.stubGlobal('navigation', navigation);
      render(
        <UnsavedWorkProvider>
          <Editor />
        </UnsavedWorkProvider>,
      );
      await user.type(screen.getByLabelText('Name'), 'Draft');
      const event = Object.assign(new Event('navigate', { cancelable: true }), {
        navigationType,
        canIntercept: true,
        destination: { key: 'previous-entry' },
      });
      act(() => {
        navigation.dispatchEvent(event);
      });
      expect(event.defaultPrevented).toBe(true);
      await user.click(screen.getByText('Stay here'));
      expect(screen.getByLabelText('Name')).toHaveValue('Draft');
      expect(navigation.traverseTo).not.toHaveBeenCalled();
      if (navigationType === 'traverse') {
        act(() => {
          navigation.dispatchEvent(event);
        });
        await user.click(screen.getByText('Discard changes'));
        expect(navigation.traverseTo).toHaveBeenCalledWith('previous-entry');
        expect(screen.getByLabelText('Name')).toHaveValue('');
      }
    },
  );
  it('does not prompt for untouched async defaults or values reverted to their baseline', async () => {
    const user = userEvent.setup();
    render(
      <UnsavedWorkProvider>
        <Editor />
      </UnsavedWorkProvider>,
    );
    await user.click(screen.getByText('Load defaults'));
    await user.type(screen.getByLabelText('Name'), ' changed');
    await user.clear(screen.getByLabelText('Name'));
    await user.type(screen.getByLabelText('Name'), 'Loaded default');
    await user.click(screen.getByText('Cancel editor'));
    expect(screen.getByText('Editor closed')).toBeVisible();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it.each(['Cancel editor', 'Close', 'Escape', 'backdrop'])(
    'protects modal dismissal through %s and keeps the draft on Stay',
    async (trigger) => {
      const user = userEvent.setup();
      render(
        <UnsavedWorkProvider>
          <Editor modal />
        </UnsavedWorkProvider>,
      );
      await waitFor(() =>
        expect(screen.getByRole('button', { name: 'Close', exact: true })).toHaveFocus(),
      );
      await user.type(screen.getByLabelText('Name'), 'Unfinished company');
      if (trigger === 'Escape') await user.keyboard('{Escape}');
      else if (trigger === 'backdrop')
        await user.click(screen.getByRole('dialog', { name: 'Edit company' }));
      else await user.click(screen.getByRole('button', { name: trigger, exact: true }));
      expect(screen.getByRole('dialog', { name: 'Keep your changes?' })).toBeVisible();
      await user.click(screen.getByText('Stay here'));
      expect(screen.getByLabelText('Name')).toHaveValue('Unfinished company');
      await user.click(screen.getByText('Cancel editor'));
      await user.click(screen.getByText('Discard changes'));
      expect(screen.getByText('Editor closed')).toBeVisible();
    },
  );

  it.each(['Open Companies', 'Finance'])(
    'blocks navigation from %s until explicitly discarded',
    async (trigger) => {
      const user = userEvent.setup();
      render(
        <UnsavedWorkProvider>
          <Editor />
        </UnsavedWorkProvider>,
      );
      await user.click(screen.getByText('Choose customer'));
      await user.click(screen.getByText(trigger));
      expect(router.push).not.toHaveBeenCalled();
      await user.click(screen.getByText('Stay here'));
      expect(screen.getByLabelText('Name')).toHaveValue('Selected customer');
      await user.click(screen.getByText(trigger));
      await user.click(screen.getByText('Discard changes'));
      expect(router.push).toHaveBeenCalledWith(trigger === 'Finance' ? '/finance' : '/companies');
      expect(screen.getByLabelText('Name')).toHaveValue('');
    },
  );

  it('preserves a draft while switching apps and warns on browser unload', async () => {
    const user = userEvent.setup();
    render(
      <UnsavedWorkProvider>
        <Editor />
      </UnsavedWorkProvider>,
    );
    await user.type(screen.getByLabelText('Name'), 'Draft');
    await user.click(screen.getByText('Switch app'));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    const event = new Event('beforeunload', { cancelable: true });
    window.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(true);
    expect(screen.getByLabelText('Name')).toHaveValue('Draft');
  });

  it('only clears protection after a successful save', async () => {
    const user = userEvent.setup();
    const save = vi
      .fn()
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValueOnce(undefined);
    render(
      <UnsavedWorkProvider>
        <Editor save={save} />
      </UnsavedWorkProvider>,
    );
    await user.type(screen.getByLabelText('Name'), 'Draft');
    await user.click(screen.getByText('Save'));
    expect(screen.getByRole('alert')).toHaveTextContent('Save failed');
    expect(router.push).not.toHaveBeenCalled();
    await user.click(screen.getByText('Open Companies'));
    await user.click(screen.getByText('Stay here'));
    await user.click(screen.getByText('Save'));
    expect(router.push).toHaveBeenCalledWith('/companies/saved');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    const event = new Event('beforeunload', { cancelable: true });
    window.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(false);
  });

  it('restores cancelled history traversal before downstream navigation sees it', async () => {
    const user = userEvent.setup();
    const go = vi.spyOn(history, 'go').mockImplementation(() => {});
    render(
      <UnsavedWorkProvider>
        <Editor />
      </UnsavedWorkProvider>,
    );
    const previous = history.state;
    history.pushState({ nextState: true }, '', '/companies/new?step=2');
    const current = history.state;
    const next = vi.fn();
    window.addEventListener('popstate', next);
    await user.type(screen.getByLabelText('Name'), 'Draft');
    act(() => {
      window.dispatchEvent(new PopStateEvent('popstate', { state: previous }));
    });
    expect(screen.getByRole('dialog', { name: 'Keep your changes?' })).toBeVisible();
    expect(go).toHaveBeenCalledWith(1);
    expect(next).not.toHaveBeenCalled();
    act(() => {
      window.dispatchEvent(new PopStateEvent('popstate', { state: current }));
    });
    expect(next).not.toHaveBeenCalled();
    await user.click(screen.getByText('Stay here'));
    fireEvent.popState(window, { state: previous });
    fireEvent.popState(window, { state: current });
    await user.click(screen.getByText('Discard changes'));
    expect(go).toHaveBeenLastCalledWith(-1);
    fireEvent.popState(window, { state: previous });
    expect(next).toHaveBeenCalledOnce();
    window.removeEventListener('popstate', next);
    go.mockRestore();
  });
});
