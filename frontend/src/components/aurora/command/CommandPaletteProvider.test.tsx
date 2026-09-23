import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { CommandPaletteProvider } from './CommandPaletteProvider';
vi.mock('next/navigation', () => ({ usePathname: () => '/apps' }));
vi.mock('@/components/layout/sidebar', () => ({ NAV: [], isGroup: () => false }));
vi.mock('@/hooks/use-personalization', () => ({ recordVisit: vi.fn() }));
vi.mock('./CommandPalette', () => ({
  CommandPalette: ({ open }: { open: boolean }) =>
    open ? (
      <div role="dialog" aria-modal="true">
        <div data-os-search>Search is open</div>
        <input aria-label="Search" />
      </div>
    ) : null,
}));
beforeEach(() => vi.clearAllMocks());
describe('Search keyboard ownership', () => {
  it('opens and closes with Ctrl or Command K without repeating', () => {
    render(
      <CommandPaletteProvider>
        <button>Workspace</button>
      </CommandPaletteProvider>,
    );
    fireEvent.keyDown(document, { key: 'k', ctrlKey: true });
    expect(screen.getByText('Search is open')).toBeInTheDocument();
    fireEvent.keyDown(screen.getByLabelText('Search'), { key: 'k', ctrlKey: true, repeat: true });
    expect(screen.getByText('Search is open')).toBeInTheDocument();
    fireEvent.keyDown(screen.getByLabelText('Search'), { key: 'K', metaKey: true });
    expect(screen.queryByText('Search is open')).not.toBeInTheDocument();
  });
  it('leaves an editor or file dialog in control of its keyboard', () => {
    render(
      <CommandPaletteProvider>
        <div role="dialog" aria-modal="true">
          <input aria-label="Supplier payment" />
        </div>
      </CommandPaletteProvider>,
    );
    fireEvent.keyDown(screen.getByLabelText('Supplier payment'), { key: 'k', ctrlKey: true });
    expect(screen.queryByText('Search is open')).not.toBeInTheDocument();
  });
  it('ignores composition and modified browser shortcuts', () => {
    render(<CommandPaletteProvider>Workspace</CommandPaletteProvider>);
    fireEvent.keyDown(document, { key: 'k', ctrlKey: true, isComposing: true });
    fireEvent.keyDown(document, { key: 'k', ctrlKey: true, shiftKey: true });
    fireEvent.keyDown(document, { key: 'k', ctrlKey: true, altKey: true });
    expect(screen.queryByText('Search is open')).not.toBeInTheDocument();
  });
});
