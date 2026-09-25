type WallpaperArtwork = {
  id: string;
  slug: string;
  name: string;
  description: string;
  tone: 'light' | 'dark';
};

function collection(
  metadata: { id: string; name: string; edition: string; description: string },
  artwork: WallpaperArtwork[],
) {
  const base = `/brand/wallpapers/${metadata.id}`;
  return {
    ...metadata,
    download: `${base}/${metadata.id}.zip`,
    wallpapers: artwork.map((wallpaper) => ({
      ...wallpaper,
      src: `${base}/${wallpaper.slug}.webp`,
      thumbnail: `${base}/thumbnails/${wallpaper.slug}.webp`,
    })),
  };
}

export const WALLPAPER_COLLECTIONS = [
  collection(
    {
      id: 'itemba-interstellar-v1',
      name: 'Interstellar',
      edition: 'Space collection',
      description: 'Five journeys beyond the everyday. A little more universe on your desktop.',
    },
    [
      {
        id: 'itemba-interstellar-v1-event-horizon',
        slug: 'event-horizon',
        name: 'Event Horizon',
        description: 'Golden light at the edge of the unknown.',
        tone: 'dark',
      },
      {
        id: 'itemba-interstellar-v1-saturn-drift',
        slug: 'saturn-drift',
        name: 'Saturn Drift',
        description: 'Champagne rings suspended in quiet space.',
        tone: 'dark',
      },
      {
        id: 'itemba-interstellar-v1-nebula-bloom',
        slug: 'nebula-bloom',
        name: 'Nebula Bloom',
        description: 'Clouds of teal, rose and distant starlight.',
        tone: 'dark',
      },
      {
        id: 'itemba-interstellar-v1-frozen-orbit',
        slug: 'frozen-orbit',
        name: 'Frozen Orbit',
        description: 'An icy horizon beneath a midnight sky.',
        tone: 'dark',
      },
      {
        id: 'itemba-interstellar-v1-stellar-passage',
        slug: 'stellar-passage',
        name: 'Stellar Passage',
        description: 'A silver galaxy stretching into the distance.',
        tone: 'dark',
      },
    ],
  ),
  collection(
    {
      id: 'itemba-originals-v1',
      name: 'ITEMBA Originals',
      edition: 'Volume 01',
      description: 'Five original scenes. Choose the atmosphere for your desktop.',
    },
    [
      {
        id: 'itemba-v1-dune-light',
        slug: 'dune-light',
        name: 'Dune Light',
        description: 'Apricot dunes in the first light of day.',
        tone: 'light',
      },
      {
        id: 'itemba-v1-tidal-glass',
        slug: 'tidal-glass',
        name: 'Tidal Glass',
        description: 'Sculpted glass, deep teal and quiet movement.',
        tone: 'dark',
      },
      {
        id: 'itemba-v1-aurora-veil',
        slug: 'aurora-veil',
        name: 'Aurora Veil',
        description: 'Emerald light unfolding into violet.',
        tone: 'dark',
      },
      {
        id: 'itemba-v1-pearl-fold',
        slug: 'pearl-fold',
        name: 'Pearl Fold',
        description: 'Soft ivory folds with a pearlescent glow.',
        tone: 'light',
      },
      {
        id: 'itemba-v1-midnight-rift',
        slug: 'midnight-rift',
        name: 'Midnight Rift',
        description: 'Obsidian curves edged with amber light.',
        tone: 'dark',
      },
    ],
  ),
];

export const BUILT_IN_WALLPAPERS = WALLPAPER_COLLECTIONS.flatMap((pack) => pack.wallpapers);

export function getBuiltInWallpaper(id: string | null | undefined) {
  return BUILT_IN_WALLPAPERS.find((wallpaper) => wallpaper.id === id);
}
