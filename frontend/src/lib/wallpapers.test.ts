import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { BUILT_IN_WALLPAPERS, getBuiltInWallpaper, WALLPAPER_COLLECTIONS } from './wallpapers';
import { DEFAULT_APPEARANCE, parseAppearance } from './desktop';
describe('Wallpaper asset package', () => {
  it.each(WALLPAPER_COLLECTIONS)('ships complete, checksummed assets for $name', (collection) => {
    const root = resolve(process.cwd(), `public/brand/wallpapers/${collection.id}`);
    const manifest = JSON.parse(readFileSync(resolve(root, 'manifest.json'), 'utf8'));
    expect(manifest.wallpapers).toHaveLength(5);
    for (const wallpaper of collection.wallpapers) {
      const entry = manifest.wallpapers.find((w: { id: string }) => w.id === wallpaper.id);
      expect(entry).toBeDefined();
      const image = readFileSync(resolve(root, entry.image));
      expect(createHash('sha256').update(image).digest('hex')).toBe(entry.sha256);
      const original = readFileSync(resolve(root, entry.original));
      expect(original.readUInt32BE(16)).toBe(entry.width);
      expect(original.readUInt32BE(20)).toBe(entry.height);
      expect(existsSync(resolve(process.cwd(), 'public' + wallpaper.thumbnail))).toBe(true);
      expect(
        parseAppearance({ ...DEFAULT_APPEARANCE, wallpaperId: wallpaper.id }).wallpaperId,
      ).toBe(wallpaper.id);
    }
    expect(existsSync(resolve(process.cwd(), 'public' + collection.download))).toBe(true);
  });
  it('resolves ten unique stable identifiers and leaves private uploads to the private loader', () => {
    expect(BUILT_IN_WALLPAPERS).toHaveLength(10);
    expect(new Set(BUILT_IN_WALLPAPERS.map((w) => w.id)).size).toBe(10);
    for (const wallpaper of BUILT_IN_WALLPAPERS) {
      expect(getBuiltInWallpaper(wallpaper.id)).toBe(wallpaper);
    }
    expect(getBuiltInWallpaper('itemba-v1-nonexistent')).toBeUndefined();
    expect(getBuiltInWallpaper('private-upload-id')).toBeUndefined();
  });
});
