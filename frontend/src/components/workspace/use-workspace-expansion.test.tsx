import { useRef } from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useWorkspaceExpansion, WorkspaceExpandButton } from './use-workspace-expansion';

function Example() {
  const surface = useRef<HTMLDivElement>(null);
  const { expanded, toggle, exitForAction } = useWorkspaceExpansion(surface);
  return (
    <div ref={surface} data-expanded={expanded} data-testid="surface">
      <WorkspaceExpandButton expanded={expanded} onToggle={toggle} />
      <button onClick={exitForAction}>Open action</button>
      <input aria-label="Draft" defaultValue="Initial note" />
    </div>
  );
}

const fullscreenDescriptor = Object.getOwnPropertyDescriptor(document, 'fullscreenElement');
const exitDescriptor = Object.getOwnPropertyDescriptor(document, 'exitFullscreen');
afterEach(() => {
  vi.restoreAllMocks();
  if (fullscreenDescriptor)
    Object.defineProperty(document, 'fullscreenElement', fullscreenDescriptor);
  else Reflect.deleteProperty(document, 'fullscreenElement');
  if (exitDescriptor) Object.defineProperty(document, 'exitFullscreen', exitDescriptor);
  else Reflect.deleteProperty(document, 'exitFullscreen');
});

describe('Workspace expansion', () => {
  it('preserves the mounted content and drafts when fullscreen is denied', async () => {
    render(<Example />);
    const surface = screen.getByTestId('surface');
    surface.requestFullscreen = vi.fn().mockRejectedValue(new Error('Embedded browser'));
    const draft = screen.getByRole('textbox', { name: 'Draft' });
    fireEvent.change(draft, { target: { value: 'Unfinished review' } });
    fireEvent.click(screen.getByRole('button', { name: 'Expand view' }));
    const restore = await screen.findByRole('button', { name: 'Restore view' });
    expect(surface).toHaveAttribute('data-expanded', 'true');
    expect(screen.getByRole('textbox', { name: 'Draft' })).toBe(draft);
    expect(draft).toHaveValue('Unfinished review');
    fireEvent.click(restore);
    expect(surface).toHaveAttribute('data-expanded', 'false');
    expect(draft).toHaveValue('Unfinished review');
  });

  it('restores the view and trigger focus when native fullscreen exits', async () => {
    render(<Example />);
    const surface = screen.getByTestId('surface');
    let fullscreen: Element | null = null;
    Object.defineProperty(document, 'fullscreenElement', {
      configurable: true,
      get: () => fullscreen,
    });
    surface.requestFullscreen = vi.fn().mockImplementation(async () => {
      fullscreen = surface;
      document.dispatchEvent(new Event('fullscreenchange'));
    });
    const trigger = screen.getByRole('button', { name: 'Expand view' });
    fireEvent.click(trigger);
    await waitFor(() => expect(surface.requestFullscreen).toHaveBeenCalledOnce());
    expect(surface).toHaveAttribute('data-expanded', 'true');
    screen.getByRole('textbox', { name: 'Draft' }).focus();
    act(() => {
      fullscreen = null;
      document.dispatchEvent(new Event('fullscreenchange'));
    });
    expect(surface).toHaveAttribute('data-expanded', 'false');
    expect(trigger).toHaveFocus();
  });

  it('exits for a page action without stealing focus from its form', async () => {
    render(<Example />);
    const surface = screen.getByTestId('surface');
    let fullscreen: Element | null = null;
    Object.defineProperty(document, 'fullscreenElement', {
      configurable: true,
      get: () => fullscreen,
    });
    surface.requestFullscreen = vi.fn().mockImplementation(async () => {
      fullscreen = surface;
      document.dispatchEvent(new Event('fullscreenchange'));
    });
    const exit = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(document, 'exitFullscreen', { configurable: true, value: exit });
    fireEvent.click(screen.getByRole('button', { name: 'Expand view' }));
    const draft = screen.getByRole('textbox', { name: 'Draft' });
    draft.focus();
    fireEvent.click(screen.getByRole('button', { name: 'Open action' }));
    expect(exit).toHaveBeenCalledOnce();
    act(() => {
      fullscreen = null;
      document.dispatchEvent(new Event('fullscreenchange'));
    });
    expect(draft).toHaveFocus();
    expect(surface).toHaveAttribute('data-expanded', 'false');
  });
});
