import { useState } from 'react';
import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  UnsavedWorkProvider,
  UnsavedWorkScope,
  useFormGuard,
  useGuardedRouter,
  useUnsavedWork,
} from './unsaved-work-provider';

const router = vi.hoisted(() => ({ push: vi.fn(), replace: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => router }));
function Form({ label }: { label: string }) {
  const [value, setValue] = useState('');
  const guard = useFormGuard(value, setValue);
  return (
    <label {...guard.capture}>
      {label}
      <input value={value} onChange={(event) => setValue(event.target.value)} />
    </label>
  );
}
const exit = vi.fn();
function Actions() {
  const navigation = useGuardedRouter();
  const { request } = useUnsavedWork();
  return (
    <>
      <button onClick={() => navigation.push('/sales-desk')}>Sales</button>
      <button onClick={() => navigation.push('/cash-desk')}>Move cash to main</button>
      <button onClick={() => request(exit)}>Sign out</button>
      <a href="/sales-desk">Sales link</a>
      <a href="/cash-desk">Cash link</a>
    </>
  );
}
function Harness() {
  return (
    <UnsavedWorkProvider>
      <UnsavedWorkScope id="primary">
        <Form label="Main" />
      </UnsavedWorkScope>
      <UnsavedWorkScope
        id="companion"
        survivesNavigation={(href) => new URL(href, location.href).pathname !== '/cash-desk'}
      >
        <Form label="Companion" />
      </UnsavedWorkScope>
      <Actions />
    </UnsavedWorkProvider>
  );
}
beforeEach(() => {
  router.push.mockReset();
  router.replace.mockReset();
  exit.mockReset();
  history.replaceState({}, '', '/invoice-desk');
  HTMLDialogElement.prototype.showModal = function () {
    this.setAttribute('open', '');
  };
  HTMLDialogElement.prototype.close = function () {
    this.removeAttribute('open');
  };
});
afterEach(() => vi.unstubAllGlobals());

describe('Independent workspace guards', () => {
  it.each(['Sales', 'Sales link'])(
    'guards only the replaced main route from %s',
    async (action) => {
      const user = userEvent.setup();
      render(<Harness />);
      await user.type(screen.getByLabelText('Main'), 'Invoice');
      await user.type(screen.getByLabelText('Companion'), 'Payment');
      await user.click(screen.getByText(action, { exact: true }));
      expect(router.push).not.toHaveBeenCalled();
      await user.click(screen.getByText('Discard changes'));
      expect(router.push).toHaveBeenCalledWith('/sales-desk');
      expect(screen.getByLabelText('Main')).toHaveValue('');
      expect(screen.getByLabelText('Companion')).toHaveValue('Payment');
    },
  );
  it.each(['Move cash to main', 'Cash link'])(
    'protects the companion before a duplicate route replaces it from %s',
    async (action) => {
      const user = userEvent.setup();
      render(<Harness />);
      await user.type(screen.getByLabelText('Companion'), 'Payment');
      await user.click(screen.getByText(action, { exact: true }));
      expect(router.push).not.toHaveBeenCalled();
      await user.click(screen.getByText('Stay here'));
      expect(screen.getByLabelText('Companion')).toHaveValue('Payment');
      await user.click(screen.getByText(action, { exact: true }));
      await user.click(screen.getByText('Discard changes'));
      expect(router.push).toHaveBeenCalledWith('/cash-desk');
      expect(screen.getByLabelText('Companion')).toHaveValue('');
    },
  );
  it('guards all windows on sign-out and browser unload', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.type(screen.getByLabelText('Main'), 'Invoice');
    await user.type(screen.getByLabelText('Companion'), 'Payment');
    const unload = new Event('beforeunload', { cancelable: true });
    window.dispatchEvent(unload);
    expect(unload.defaultPrevented).toBe(true);
    await user.click(screen.getByText('Sign out'));
    expect(exit).not.toHaveBeenCalled();
    await user.click(screen.getByText('Discard changes'));
    expect(exit).toHaveBeenCalledTimes(1);
    expect(screen.getByLabelText('Main')).toHaveValue('');
    expect(screen.getByLabelText('Companion')).toHaveValue('');
  });
  it('allows history traversal to another app while preserving the mounted companion', async () => {
    const navigation = Object.assign(new EventTarget(), { traverseTo: vi.fn() });
    vi.stubGlobal('navigation', navigation);
    const user = userEvent.setup();
    render(<Harness />);
    await user.type(screen.getByLabelText('Companion'), 'Payment');
    const event = Object.assign(new Event('navigate', { cancelable: true }), {
      navigationType: 'traverse',
      canIntercept: true,
      destination: { key: 'sales', url: new URL('/sales-desk', location.href).href },
    });
    act(() => navigation.dispatchEvent(event));
    expect(event.defaultPrevented).toBe(false);
    expect(screen.getByLabelText('Companion')).toHaveValue('Payment');
    const collision = Object.assign(new Event('navigate', { cancelable: true }), {
      navigationType: 'traverse',
      canIntercept: true,
      destination: { key: 'cash', url: new URL('/cash-desk', location.href).href },
    });
    act(() => navigation.dispatchEvent(collision));
    expect(collision.defaultPrevented).toBe(true);
    await user.click(screen.getByText('Stay here'));
    expect(navigation.traverseTo).not.toHaveBeenCalled();
  });
});
