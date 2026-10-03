import { readFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { ImageResponse } from 'next/og';
import { site } from '@/content/site';
import { accents, companyAccents, gold, hairlines, surfaces, text as ink } from '@/design/tokens';

/**
 * Open Graph cards (1200×630 PNG), the Apple way: a white canvas, the navy
 * crest lockup, an eyebrow in the company's text-safe accent, a large ink
 * headline set in Inter Display, and a quiet footer line.
 *
 * - Node runtime only: the fonts and the logo are read from disk. Both are
 *   listed in next.config.ts `outputFileTracingIncludes`, so cards for
 *   slugs rendered at request time work in the standalone server.
 * - Satori (next/og) needs static TTF, not the site's variable woff2; the
 *   files are Inter 4.1 instances (src/assets/fonts/README.md).
 * - Satori-safe CSS only: every element with several children is a flex box.
 *
 * API (unchanged): renderOgCard, ogImageFor, clamp, OG_SIZE,
 * OG_CONTENT_TYPE, COMPANY_ACCENT. New: ogImageOptions and ogImageResponse,
 * which attach the fonts. A card rendered without them falls back to
 * satori's default face.
 */

export const OG_SIZE = { width: 1200, height: 630 } as const;
export const OG_CONTENT_TYPE = 'image/png';

interface OgCardProps {
  eyebrow: string;
  title: string;
  subtitle?: string;
  /** Text-safe accent hex for the eyebrow; defaults to the group's text gold. */
  accent?: string;
}

/** Card assets, relative to the website root (also traced into the standalone output). */
export const OG_ASSET_FILES = {
  regular: 'src/assets/fonts/og/Inter-Regular.ttf',
  semibold: 'src/assets/fonts/og/Inter-SemiBold.ttf',
  display: 'src/assets/fonts/og/InterDisplay-SemiBold.ttf',
  logo: 'public/logo-print.png',
} as const;

/** The crest lockup (930×360, navy on white). */
const LOGO = { width: 930, height: 360 } as const;

const assetPath = (relative: string) => path.join(process.cwd(), relative);

type OgFont = { name: string; data: ArrayBuffer; weight: 400 | 600; style: 'normal' };

let fontsPromise: Promise<OgFont[]> | undefined;

function toArrayBuffer(buffer: Buffer): ArrayBuffer {
  return buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength) as ArrayBuffer;
}

/** The card fonts, read once per process. */
export function loadOgFonts(): Promise<OgFont[]> {
  fontsPromise ??= Promise.all([
    readFile(assetPath(OG_ASSET_FILES.regular)),
    readFile(assetPath(OG_ASSET_FILES.semibold)),
    readFile(assetPath(OG_ASSET_FILES.display)),
  ]).then(([regular, semibold, display]) => [
    { name: 'Inter', data: toArrayBuffer(regular), weight: 400, style: 'normal' },
    { name: 'Inter', data: toArrayBuffer(semibold), weight: 600, style: 'normal' },
    { name: 'Inter Display', data: toArrayBuffer(display), weight: 600, style: 'normal' },
  ]);
  return fontsPromise;
}

let logoDataUri: string | undefined;

/** The crest as a data URI, read once per process (satori embeds it). */
function logoSrc(): string {
  logoDataUri ??= `data:image/png;base64,${readFileSync(assetPath(OG_ASSET_FILES.logo)).toString('base64')}`;
  return logoDataUri;
}

/** ImageResponse options for a card: its size plus the brand fonts. */
export async function ogImageOptions() {
  return { width: OG_SIZE.width, height: OG_SIZE.height, fonts: await loadOgFonts() };
}

/** A complete card response. */
export async function ogImageResponse(props: OgCardProps) {
  return new ImageResponse(renderOgCard(props), await ogImageOptions());
}

/** The graphic (dot) colour that goes with a text accent. */
function graphicFor(accent: string): string {
  const swatch = Object.values(accents).find((s) => s.text.toLowerCase() === accent.toLowerCase());
  return swatch ? swatch.graphic : accent;
}

/** The headline steps down as it gets longer, so no card needs more than three lines. */
function titleSize(title: string, hasSubtitle: boolean): number {
  if (title.length <= 28) return hasSubtitle ? 76 : 84;
  if (title.length <= 48) return hasSubtitle ? 66 : 74;
  return hasSubtitle ? 56 : 64;
}

const LOGO_HEIGHT = 68;

export function renderOgCard({ eyebrow, title, subtitle, accent = gold.text }: OgCardProps) {
  const size = titleSize(title, Boolean(subtitle));
  return (
    <div
      style={{
        width: '100%',
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'space-between',
        padding: '64px 80px 56px',
        background: surfaces.canvas,
        color: ink.light.primary,
        fontFamily: 'Inter',
      }}
    >
      {/* Satori renders a plain <img>; the card's alt text is the route's `alt` export. */}
      {/* eslint-disable-next-line @next/next/no-img-element, jsx-a11y/alt-text */}
      <img src={logoSrc()} width={Math.round((LOGO_HEIGHT * LOGO.width) / LOGO.height)} height={LOGO_HEIGHT} />

      <div style={{ display: 'flex', flexDirection: 'column', maxWidth: '1000px' }}>
        <div style={{ display: 'flex', alignItems: 'center' }}>
          <div
            style={{ display: 'flex', width: '14px', height: '14px', borderRadius: '7px', background: graphicFor(accent), marginRight: '14px' }}
          />
          <div style={{ display: 'flex', color: accent, fontSize: '28px', fontWeight: 600, letterSpacing: '0.2px' }}>{eyebrow}</div>
        </div>
        <div
          style={{
            display: 'flex',
            marginTop: '22px',
            fontFamily: 'Inter Display',
            fontSize: `${size}px`,
            fontWeight: 600,
            lineHeight: 1.06,
            letterSpacing: `${(-0.022 * size).toFixed(2)}px`,
            color: ink.light.primary,
          }}
        >
          {title}
        </div>
        {subtitle ? (
          <div
            style={{
              display: 'flex',
              marginTop: '24px',
              maxWidth: '960px',
              fontSize: '29px',
              fontWeight: 400,
              lineHeight: 1.36,
              letterSpacing: '-0.3px',
              color: ink.light.secondary,
            }}
          >
            {subtitle}
          </div>
        ) : null}
      </div>

      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          paddingTop: '22px',
          borderTop: `1px solid ${hairlines.light}`,
          fontSize: '21px',
        }}
      >
        <div style={{ display: 'flex', fontWeight: 600, color: ink.light.primary }}>{site.domain}</div>
        <div style={{ display: 'flex', color: ink.light.secondary }}>{site.placeLine}</div>
      </div>
    </div>
  );
}

/** Text-safe accent per company slug, used by company and service cards. */
export const COMPANY_ACCENT: Record<string, string> = {
  'mwanjalisi-oil': companyAccents.mwanjalisi.text,
  'westsides-company': companyAccents.westsides.text,
  'itemba-enterprises': companyAccents.enterprises.text,
};

/**
 * Factory for a static page's opengraph-image.tsx. Returns the default-export
 * component that renders a fixed card, so each static route file is a one-liner.
 */
export function ogImageFor(props: OgCardProps) {
  return async function OpenGraphImage() {
    return ogImageResponse(props);
  };
}

/** Trim a subtitle to fit the card without overflowing, breaking on a word. */
export function clamp(text: string, max = 130): string {
  if (text.length <= max) return text;
  const cut = text.slice(0, max);
  const lastSpace = cut.lastIndexOf(' ');
  return `${(lastSpace > 40 ? cut.slice(0, lastSpace) : cut).trimEnd()}…`;
}
