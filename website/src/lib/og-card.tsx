import { ImageResponse } from 'next/og';
import { site } from '@/lib/site';

/**
 * Shared renderer for per-page Open Graph cards (1200×630). Each route's
 * opengraph-image.tsx feeds its own eyebrow / title / subtitle / accent and
 * passes the returned element to `next/og`'s ImageResponse. Kept deliberately
 * in the satori-safe CSS subset (flex everywhere, no gaps on text nodes) so it
 * renders identically to the static root card.
 */

export const OG_SIZE = { width: 1200, height: 630 } as const;
export const OG_CONTENT_TYPE = 'image/png';

const GOLD = '#c8860a';

interface OgCardProps {
  eyebrow: string;
  title: string;
  subtitle?: string;
  /** Accent hex — defaults to brand gold. */
  accent?: string;
}

export function renderOgCard({ eyebrow, title, subtitle, accent = GOLD }: OgCardProps) {
  return (
    <div
      style={{
        width: '100%',
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'space-between',
        padding: '64px',
        background: 'linear-gradient(135deg, #05080f 0%, #080f1e 48%, #122035 100%)',
        color: '#ffffff',
        fontFamily: 'Arial, sans-serif',
        position: 'relative',
        overflow: 'hidden',
      }}
    >
      {/* accent orb */}
      <div
        style={{
          position: 'absolute',
          width: '640px',
          height: '640px',
          borderRadius: '50%',
          background: accent,
          opacity: 0.2,
          filter: 'blur(96px)',
          right: '-180px',
          top: '-230px',
        }}
      />
      {/* cool counter-orb */}
      <div
        style={{
          position: 'absolute',
          width: '540px',
          height: '540px',
          borderRadius: '50%',
          background: 'rgba(16, 185, 129, 0.12)',
          filter: 'blur(96px)',
          left: '-170px',
          bottom: '-230px',
        }}
      />

      {/* brand header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '18px' }}>
        <div
          style={{
            width: '72px',
            height: '72px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            borderRadius: '14px',
            background: accent,
            color: '#05080f',
            fontSize: '34px',
            fontWeight: 900,
          }}
        >
          IG
        </div>
        <div style={{ display: 'flex', flexDirection: 'column' }}>
          <div style={{ fontSize: '30px', fontWeight: 800 }}>{site.name}</div>
          <div style={{ color: '#f0cc6a', fontSize: '17px', marginTop: '4px' }}>
            Mpemba-Tunduma · Songwe Region · Tanzania
          </div>
        </div>
      </div>

      {/* headline block */}
      <div style={{ position: 'relative', display: 'flex', flexDirection: 'column', maxWidth: '1010px' }}>
        <div
          style={{
            display: 'flex',
            color: accent === GOLD ? '#f0cc6a' : accent,
            fontSize: '20px',
            fontWeight: 700,
            letterSpacing: '0.08em',
            textTransform: 'uppercase',
            marginBottom: '22px',
          }}
        >
          {eyebrow}
        </div>
        <div style={{ display: 'flex', fontSize: '62px', lineHeight: 1.04, fontWeight: 900, letterSpacing: '-0.03em' }}>
          {title}
        </div>
        {subtitle ? (
          <div style={{ display: 'flex', color: '#cbd5e1', fontSize: '25px', lineHeight: 1.32, marginTop: '26px', maxWidth: '950px' }}>
            {subtitle}
          </div>
        ) : null}
      </div>

      {/* footer */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '14px' }}>
        <div style={{ display: 'flex', width: '40px', height: '4px', borderRadius: '2px', background: accent }} />
        <div style={{ display: 'flex', color: '#94a3b8', fontSize: '20px' }}>{site.domain}</div>
      </div>
    </div>
  );
}

/** Brand accent per company slug, used by company + service OG cards. */
export const COMPANY_ACCENT: Record<string, string> = {
  'mwanjalisi-oil': '#e8b52e',
  'westsides-company': '#3b82f6',
  'itemba-enterprises': '#10b981',
};

/**
 * Factory for a static page's opengraph-image.tsx. Returns the default-export
 * component that renders a fixed card — so each static route file is a one-liner.
 */
export function ogImageFor(props: OgCardProps) {
  return function OpenGraphImage() {
    return new ImageResponse(renderOgCard(props), { width: OG_SIZE.width, height: OG_SIZE.height });
  };
}

/** Trim a subtitle to fit the card without overflowing, breaking on a word. */
export function clamp(text: string, max = 130): string {
  if (text.length <= max) return text;
  const cut = text.slice(0, max);
  const lastSpace = cut.lastIndexOf(' ');
  return `${(lastSpace > 40 ? cut.slice(0, lastSpace) : cut).trimEnd()}…`;
}
