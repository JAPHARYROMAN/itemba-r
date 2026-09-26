/**
 * The OG card system (src/lib/og-card.tsx): its public API is unchanged,
 * its accents are the text-safe tokens, and a card renders to a real
 * 1200×630 PNG with the brand fonts and the crest.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { companyAccents, gold, surfaces } from '@/design/tokens';
import {
  COMPANY_ACCENT,
  OG_ASSET_FILES,
  OG_CONTENT_TYPE,
  OG_SIZE,
  clamp,
  loadOgFonts,
  ogImageFor,
  ogImageOptions,
  ogImageResponse,
  renderOgCard,
} from '@/lib/og-card';
import { contrastRatio } from './helpers/contrast';

const ROOT = path.resolve(__dirname, '../..');

function pngSize(buffer: Buffer) {
  expect(buffer.subarray(0, 8).toString('hex')).toBe('89504e470d0a1a0a');
  return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) };
}

describe('og-card API', () => {
  it('keeps its constants and helpers', () => {
    expect(OG_SIZE).toEqual({ width: 1200, height: 630 });
    expect(OG_CONTENT_TYPE).toBe('image/png');
    expect(clamp('short')).toBe('short');
    expect(clamp('word '.repeat(40), 60).endsWith('…')).toBe(true);
    expect(typeof renderOgCard({ eyebrow: 'e', title: 't' })).toBe('object');
    expect(typeof ogImageFor({ eyebrow: 'e', title: 't' })).toBe('function');
  });

  it('company accents are the text-safe tokens, AA on the white card', () => {
    expect(COMPANY_ACCENT).toEqual({
      'mwanjalisi-oil': companyAccents.mwanjalisi.text,
      'westsides-company': companyAccents.westsides.text,
      'itemba-enterprises': companyAccents.enterprises.text,
    });
    for (const accent of [...Object.values(COMPANY_ACCENT), gold.text]) {
      expect(contrastRatio(accent, surfaces.canvas)).toBeGreaterThanOrEqual(4.5);
    }
  });

  it('loads three static Inter faces and the crest', async () => {
    const fonts = await loadOgFonts();
    expect(fonts.map((f) => `${f.name} ${f.weight}`)).toEqual(['Inter 400', 'Inter 600', 'Inter Display 600']);
    for (const font of fonts) expect(new Uint8Array(font.data).subarray(0, 4)).toEqual(new Uint8Array([0, 1, 0, 0]));
    expect(readFileSync(path.join(ROOT, OG_ASSET_FILES.logo)).subarray(1, 4).toString()).toBe('PNG');
    const options = await ogImageOptions();
    expect(options).toMatchObject({ width: 1200, height: 630 });
  });

  it('next.config traces the card assets into the standalone output', () => {
    const config = readFileSync(path.join(ROOT, 'next.config.ts'), 'utf8');
    expect(config).toContain("'./src/assets/fonts/og/*.ttf'");
    expect(config).toContain("'./public/logo-print.png'");
  });
});

describe('og-card rendering', () => {
  it(
    'renders a 1200×630 PNG, also for a long headline',
    async () => {
      for (const props of [
        { eyebrow: 'Petroleum Retail & Parking', title: 'Mwanjalisi Oil Co Ltd', subtitle: 'Energy, Fuel & Parking', accent: COMPANY_ACCENT['mwanjalisi-oil'] },
        {
          eyebrow: 'Business Enquiries',
          title: 'How to Route a Business Enquiry to Itemba Group and Its Companies',
          subtitle: clamp('A practical guide to choosing the right Itemba Group contact route for fuel, trade, logistics, construction supply, hospitality, property, and partnership enquiries.'),
        },
      ]) {
        const response = await ogImageResponse(props);
        expect(response.headers.get('content-type')).toBe('image/png');
        const size = pngSize(Buffer.from(await response.arrayBuffer()));
        expect(size).toEqual({ width: 1200, height: 630 });
      }
    },
    60_000,
  );

  it(
    'the root route is on the node runtime and uses the shared card',
    async () => {
      const source = readFileSync(path.join(ROOT, 'src/app/opengraph-image.tsx'), 'utf8');
      expect(source).not.toMatch(/runtime\s*=\s*['"]edge['"]/);
      expect(source).toContain('ogImageFor');
      const response = await ogImageFor({ eyebrow: 'Diversified Business Group', title: 'Energy. Trade. Logistics. Hospitality.' })();
      expect(pngSize(Buffer.from(await response.arrayBuffer()))).toEqual({ width: 1200, height: 630 });
    },
    60_000,
  );
});
