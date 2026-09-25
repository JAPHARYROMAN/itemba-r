import { useState } from 'react';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { AppearanceStudio } from './appearance-studio';
import { DEFAULT_APPEARANCE } from '@/lib/desktop';
import { WALLPAPER_COLLECTIONS } from '@/lib/wallpapers';
vi.mock('@/lib/api-client', () => ({
  backendGet: vi.fn().mockResolvedValue([]),
  backendDelete: vi.fn(),
  backendUpload: vi.fn(),
}));
function Studio() {
  const [value, setValue] = useState(DEFAULT_APPEARANCE);
  return <AppearanceStudio value={value} onChange={setValue} status="Synced to your account" />;
}
describe('Included wallpaper collection', () => {
  it('offers explicit conflict recovery without silently changing the selected preview', async () => {
    const recover = vi.fn(),
      change = vi.fn();
    render(
      <AppearanceStudio
        value={DEFAULT_APPEARANCE}
        onChange={change}
        status="Appearance changed in another session."
        recovery="conflict"
        onRecover={recover}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Use account settings' }));
    expect(recover).toHaveBeenLastCalledWith('saved');
    fireEvent.click(screen.getByRole('button', { name: 'Keep this appearance' }));
    expect(recover).toHaveBeenLastCalledWith('keep');
    expect(change).not.toHaveBeenCalled();
    await waitFor(() => expect(screen.queryByRole('alert')).not.toBeInTheDocument());
  });
  it('groups wallpapers by pack, switches between packs and preserves selection across colour changes', async () => {
    render(<Studio />);
    for (const collection of WALLPAPER_COLLECTIONS) {
      const region = within(
        screen.getByRole('region', { name: `${collection.name} wallpaper collection` }),
      );
      for (const w of collection.wallpapers)
        expect(region.getByRole('button', { name: `Use ${w.name} wallpaper` })).toBeInTheDocument();
      expect(
        region.getByRole('link', { name: `Download ${collection.name} collection` }),
      ).toHaveAttribute('href', collection.download);
      expect(
        region.getByRole('link', { name: `Download ${collection.name} collection` }),
      ).toHaveAttribute('download');
    }
    fireEvent.click(screen.getByRole('button', { name: 'Use Tidal Glass wallpaper' }));
    expect(screen.getByRole('button', { name: 'Use Tidal Glass wallpaper' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    fireEvent.click(screen.getByRole('button', { name: 'Use Event Horizon wallpaper' }));
    expect(screen.getByRole('button', { name: 'Use Tidal Glass wallpaper' })).toHaveAttribute(
      'aria-pressed',
      'false',
    );
    fireEvent.click(screen.getByRole('button', { name: 'Dune', exact: true }));
    expect(screen.getByRole('button', { name: 'Use Event Horizon wallpaper' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    fireEvent.click(screen.getByRole('button', { name: 'Use Pearl Fold wallpaper' }));
    expect(screen.getByRole('button', { name: 'Use Event Horizon wallpaper' })).toHaveAttribute(
      'aria-pressed',
      'false',
    );
    expect(screen.getByRole('button', { name: 'Use Pearl Fold wallpaper' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    fireEvent.click(screen.getByRole('button', { name: 'Original theme wallpaper' }));
    expect(screen.getByRole('button', { name: 'Use Pearl Fold wallpaper' })).toHaveAttribute(
      'aria-pressed',
      'false',
    );
    await waitFor(() => expect(screen.queryByRole('alert')).not.toBeInTheDocument());
  });
});
