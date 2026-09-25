import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { PrismaService } from '../../prisma/prisma.service';
import { BUILT_IN_WALLPAPER_IDS } from '../workspace/built-in-wallpapers';
import { UserPreferencesService } from './user-preferences.service';

const appearance = (wallpaperId: string | null) => ({
  version: 1,
  theme: 'aurora',
  mode: 'system',
  accent: '#7552d9',
  dock: 'bottom',
  transparency: 'full',
  motion: 'system',
  iconSize: 48,
  blur: 24,
  intensity: 1,
  shortcuts: [],
  presets: [],
  wallpaperId,
});
function fixture(upload: { id: string } | null = null) {
  const tx = {
    $executeRaw: jest.fn().mockResolvedValue(1),
    userPreference: {
      findUnique: jest.fn().mockResolvedValue({ desktopRevision: 3 }),
      upsert: jest.fn().mockResolvedValue({ desktopRevision: 4 }),
    },
  };
  const db = {
    workspaceWallpaper: { findFirst: jest.fn().mockResolvedValue(upload) },
    $transaction: jest.fn(async (cb: (transaction: typeof tx) => Promise<unknown>) => cb(tx)),
  };
  return { service: new UserPreferencesService(db as unknown as PrismaService), db, tx };
}
describe('Bundled wallpaper preferences', () => {
  it.each([...BUILT_IN_WALLPAPER_IDS])(
    'saves %s through the versioned account profile',
    async (wallpaperId) => {
      const { service, db, tx } = fixture();
      await service.upsertMine('owner', {
        desktop: appearance(wallpaperId),
        expectedDesktopRevision: 3,
      });
      expect(db.workspaceWallpaper.findFirst).not.toHaveBeenCalled();
      expect(tx.userPreference.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { userId: 'owner' },
          update: expect.objectContaining({
            desktop: expect.objectContaining({ wallpaperId }),
            desktopRevision: { increment: 1 },
          }),
        }),
      );
    },
  );
  it.each(['itemba-v1-unknown', 'itemba-interstellar-v1-unknown', 'another-users-upload'])(
    'rejects unavailable wallpaper %s without bypassing ownership',
    async (wallpaperId) => {
      const { service, db } = fixture();
      await expect(
        service.upsertMine('owner', {
          desktop: appearance(wallpaperId),
          expectedDesktopRevision: 3,
        }),
      ).rejects.toThrow('Wallpaper is unavailable');
      expect(db.workspaceWallpaper.findFirst).toHaveBeenCalledWith({
        where: { id: wallpaperId, userId: 'owner' },
        select: { id: true },
      });
      expect(db.$transaction).not.toHaveBeenCalled();
    },
  );
  it('still permits an owned private upload and rejects stale revisions', async () => {
    const { service, tx } = fixture({ id: 'private-upload' });
    await service.upsertMine('owner', {
      desktop: appearance('private-upload'),
      expectedDesktopRevision: 3,
    });
    tx.userPreference.upsert.mockClear();
    await expect(
      service.upsertMine('owner', {
        desktop: appearance('itemba-v1-pearl-fold'),
        expectedDesktopRevision: 2,
      }),
    ).rejects.toThrow('Appearance changed');
    expect(tx.userPreference.upsert).not.toHaveBeenCalled();
  });
  it('allows exactly the stable IDs in the shipped collection manifests', () => {
    const shippedIds = ['itemba-originals-v1', 'itemba-interstellar-v1'].flatMap((pack) => {
      const manifest = JSON.parse(
        readFileSync(
          resolve(__dirname, `../../../../frontend/public/brand/wallpapers/${pack}/manifest.json`),
          'utf8',
        ),
      );
      return manifest.wallpapers.map((w: { id: string }) => w.id);
    });
    expect([...BUILT_IN_WALLPAPER_IDS].sort()).toEqual(shippedIds.sort());
  });
});
