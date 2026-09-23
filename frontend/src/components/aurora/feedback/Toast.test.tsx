import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { showToast, ToastProvider } from './Toast';

beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});
const advance = (time: number) => act(() => vi.advanceTimersByTime(time));
const notify = (type: Parameters<typeof showToast>[0], title: string, description?: string) =>
  act(() => showToast(type, title, description));
const dismiss = (title: string) =>
  screen.getByRole('button', { name: `Dismiss notification: ${title}` });

describe('Workspace feedback', () => {
  it('keeps a live region ready and dismisses a short confirmation after six seconds', () => {
    render(<ToastProvider />);
    expect(screen.getByRole('region', { name: 'Feedback' })).toHaveAttribute('aria-live', 'polite');
    notify('success', 'Payment saved');
    advance(5999);
    expect(dismiss('Payment saved')).toBeVisible();
    advance(1);
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
    advance(180);
    expect(screen.queryByText('Payment saved')).not.toBeInTheDocument();
  });

  it('gives longer messages eight seconds and pauses while the pointer is over them', () => {
    render(<ToastProvider />);
    notify('info', 'Export ready', 'Your requested report is ready to download.');
    advance(3000);
    const toast = dismiss('Export ready').parentElement!;
    fireEvent.pointerEnter(toast);
    advance(30000);
    expect(dismiss('Export ready')).toBeVisible();
    fireEvent.pointerLeave(toast);
    advance(4999);
    expect(dismiss('Export ready')).toBeVisible();
    advance(1);
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });

  it('keeps focused feedback readable and returns focus when dismissed', () => {
    render(
      <>
        <button>Save invoice</button>
        <ToastProvider />
      </>,
    );
    const save = screen.getByRole('button', { name: 'Save invoice' });
    act(() => save.focus());
    notify('success', 'Invoice saved');
    advance(4000);
    const close = dismiss('Invoice saved');
    act(() => close.focus());
    advance(30000);
    expect(close).toHaveFocus();
    fireEvent.click(close);
    expect(save).toHaveFocus();
    advance(180);
    expect(screen.queryByText('Invoice saved')).not.toBeInTheDocument();
  });

  it('resumes the remaining reading time only after both hover and focus end', () => {
    render(
      <>
        <button>Continue</button>
        <ToastProvider />
      </>,
    );
    notify('info', 'Synced');
    advance(1000);
    const close = dismiss('Synced');
    const toast = close.parentElement!;
    fireEvent.pointerEnter(toast);
    act(() => close.focus());
    fireEvent.pointerLeave(toast);
    advance(30000);
    expect(close).toHaveFocus();
    act(() => screen.getByRole('button', { name: 'Continue' }).focus());
    advance(4999);
    expect(close).toBeVisible();
    advance(1);
    expect(
      screen.queryByRole('button', { name: 'Dismiss notification: Synced' }),
    ).not.toBeInTheDocument();
  });

  it.each(['error', 'warning'] as const)('keeps %s feedback until explicitly dismissed', (type) => {
    render(<ToastProvider />);
    notify(type, 'Needs attention', 'Review the transaction before trying again.');
    advance(600000);
    expect(dismiss('Needs attention')).toBeVisible();
    fireEvent.click(dismiss('Needs attention'));
    advance(180);
    expect(screen.queryByText('Needs attention')).not.toBeInTheDocument();
  });

  it('pauses all reading timers while the browser tab is hidden', () => {
    const visibility = vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible');
    render(<ToastProvider />);
    notify('success', 'Saved');
    advance(2000);
    visibility.mockReturnValue('hidden');
    fireEvent(document, new Event('visibilitychange'));
    advance(60000);
    expect(dismiss('Saved')).toBeVisible();
    visibility.mockReturnValue('visible');
    fireEvent(document, new Event('visibilitychange'));
    advance(3999);
    expect(dismiss('Saved')).toBeVisible();
    advance(1);
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });

  it('moves keyboard focus to the next notification without dismissing it', () => {
    render(
      <>
        <button>Save changes</button>
        <ToastProvider />
      </>,
    );
    const save = screen.getByRole('button', { name: 'Save changes' });
    act(() => save.focus());
    notify('error', 'First issue');
    notify('warning', 'Second issue');
    const first = dismiss('First issue');
    act(() => first.focus());
    fireEvent.click(first);
    expect(dismiss('Second issue')).toHaveFocus();
    advance(180);
    expect(screen.queryByText('First issue')).not.toBeInTheDocument();
    expect(dismiss('Second issue')).toHaveFocus();
    fireEvent.click(dismiss('Second issue'));
    expect(save).toHaveFocus();
    advance(180);
    expect(screen.queryByText('Second issue')).not.toBeInTheDocument();
  });

  it('clears outstanding timers when the provider unmounts', () => {
    const view = render(<ToastProvider />);
    notify('info', 'Queued');
    view.unmount();
    expect(vi.getTimerCount()).toBe(0);
    expect(() => notify('success', 'After unmount')).not.toThrow();
    expect(screen.queryByText('After unmount')).not.toBeInTheDocument();
  });
});
