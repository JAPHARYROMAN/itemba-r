/**
 * The design tokens (src/design/tokens.ts) and what the Tailwind plugin makes
 * of them.
 *
 * 1. Contrast: every declared foreground/background pair and every button
 *    variant meets WCAG AA (4.5:1 text; 3:1 large text, UI and focus). Each
 *    text role is checked on both surfaces of its tone, so a card set inside
 *    a tile is covered as well.
 * 2. Spec fidelity: the plan's literal values are locked, so a change is a
 *    deliberate, reviewed edit.
 * 3. The CSS variables the plugin writes are exactly the values tested here,
 *    and Tailwind compiles the token classes (and no others) from the real
 *    config.
 * 4. The self-hosted font files are the ones src/design/fonts.ts expects,
 *    within the font budget.
 */
import { readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import postcss from 'postcss';
import tailwindcss from 'tailwindcss';
import { describe, expect, it } from 'vitest';
import type { AccentKey } from '@/content/types';
import { accentDeclarations, baseStyles, hexToChannels, semanticVariables, toneDeclarations } from '@/design/theme';
import {
  accentNames,
  accentText,
  accents,
  buttons,
  companyAccents,
  containers,
  decorativeRoles,
  gold,
  gutter,
  hairlines,
  materials,
  radii,
  sectionSpace,
  surfaces,
  text,
  textRoleKinds,
  toneNames,
  tones,
  typeScale,
  uiRoles,
  type AccentSwatch,
  type Tone,
} from '@/design/tokens';
import tailwindConfig from '../../tailwind.config';
import { contrastRatio, formatRatio, isLargeText, parseColor, requiredRatio, type ContrastKind } from './helpers/contrast';

const ROOT = path.resolve(__dirname, '../..');

type Pair = { label: string; fg: string; bg: string; kind: ContrastKind; base?: string };

const surfacesOf = (tone: Tone) => [
  { name: 'surface', value: tones[tone].surface },
  { name: 'surfaceAlt', value: tones[tone].surfaceAlt },
];

function textPairs(): Pair[] {
  const pairs: Pair[] = [];
  for (const tone of toneNames) {
    for (const surface of surfacesOf(tone)) {
      for (const [role, kind] of Object.entries(textRoleKinds)) {
        if (role === 'accentFg') continue;
        pairs.push({
          label: `${tone} ${role} on ${surface.name}`,
          fg: tones[tone][role as Exclude<keyof typeof textRoleKinds, 'accentFg'>],
          bg: surface.value,
          kind,
        });
      }
      // Accent text: links, chevron links ("Learn more ›") and eyebrows.
      for (const accent of accentNames) {
        pairs.push({
          label: `${tone} ${accent} accent text on ${surface.name}`,
          fg: accentText(accent, tone),
          bg: surface.value,
          kind: textRoleKinds.accentFg,
        });
      }
    }
  }
  return pairs;
}

function uiPairs(): Pair[] {
  const pairs: Pair[] = [];
  for (const tone of toneNames) {
    for (const surface of surfacesOf(tone)) {
      for (const role of uiRoles) {
        pairs.push({ label: `${tone} ${role} edge on ${surface.name}`, fg: tones[tone][role], bg: surface.value, kind: 'ui' });
      }
    }
  }
  return pairs;
}

function buttonPairs(): Pair[] {
  const pairs: Pair[] = [];
  for (const tone of toneNames) {
    const t = tones[tone];
    pairs.push({ label: `${tone} primary pill label`, fg: t.btnFg, bg: t.btn, kind: 'text' });
    pairs.push({ label: `${tone} primary pill label (hover)`, fg: t.btnFg, bg: t.btnHover, kind: 'text' });
  }
  return pairs;
}

/**
 * The translucent nav can sit over any tile, including a cinema tile. Its
 * text and its Enquire pill must hold over every base surface.
 */
function navPairs(): Pair[] {
  const pairs: Pair[] = [];
  const bases = [surfaces.canvas, surfaces.alt, surfaces.cinema, surfaces.cinemaRaised];
  for (const base of bases) {
    pairs.push({ label: `nav link over material on ${base}`, fg: tones.light.fg, bg: materials.nav.background, base, kind: 'text' });
    pairs.push({ label: `nav Enquire pill edge on material over ${base}`, fg: tones.light.btn, bg: materials.nav.background, base, kind: 'ui' });
  }
  pairs.push({ label: 'nav link on solid fallback', fg: tones.light.fg, bg: materials.nav.fallback, kind: 'text' });
  return pairs;
}

const allPairs = [...textPairs(), ...uiPairs(), ...buttonPairs(), ...navPairs()];

describe('contrast: every declared pair meets WCAG AA', () => {
  it('declares a meaningful number of pairs', () => {
    // 3 tones × 2 surfaces × (5 text roles + 4 accents + 4 UI roles) + 6 button + 9 nav.
    expect(allPairs.length).toBe(3 * 2 * (5 + 4 + 4) + 6 + 9);
  });

  it.each(allPairs.map((p) => [p.label, p] as const))('%s', (_label, pair) => {
    const ratio = contrastRatio(pair.fg, pair.bg, pair.base);
    const required = requiredRatio(pair.kind);
    expect(ratio, `${pair.fg} on ${pair.bg}: ${formatRatio(ratio)} < ${required}:1 (${pair.kind})`).toBeGreaterThanOrEqual(required);
  });
});

describe('contrast: roles with restricted use', () => {
  it('fgSubtle is only for type styles that count as large text', () => {
    const largeStyles = Object.entries(typeScale)
      .filter(([, style]) => isLargeText(style.minPx, style.weight))
      .map(([name]) => name);
    expect(largeStyles).toEqual(['display-xl', 'display', 'h1', 'h2', 'h3']);
    // On the light tones tertiary text really does fail body-size AA.
    expect(contrastRatio(text.light.tertiary, surfaces.canvas)).toBeLessThan(4.5);
    expect(textRoleKinds.fgSubtle).toBe('large-text');
  });

  it('decorative values are measured and documented as not meeting UI contrast on light tiles', () => {
    expect(decorativeRoles).toEqual(['line', 'accentGraphic']);
    expect(contrastRatio(hairlines.light, surfaces.canvas)).toBeLessThan(3);
    expect(contrastRatio(gold.graphic, surfaces.alt)).toBeLessThan(3);
    expect(contrastRatio(companyAccents.mwanjalisi.graphic, surfaces.canvas)).toBeLessThan(3);
  });
});

describe('spec fidelity (plan: "Itemba, the Apple way")', () => {
  it('surfaces and hairlines', () => {
    expect(surfaces).toEqual({ canvas: '#ffffff', alt: '#f5f5f7', cinema: '#000000', cinemaRaised: '#101014' });
    expect(hairlines).toEqual({ light: '#d2d2d7', cinema: '#424245' });
  });

  it('text colours', () => {
    expect(text.light).toMatchObject({ primary: '#1d1d1f', secondary: '#6e6e73', tertiary: '#86868b' });
    expect(text.cinema).toMatchObject({ primary: '#f5f5f7', secondary: '#a1a1a6' });
  });

  it('group gold', () => {
    expect(gold).toEqual({ graphic: '#c8860a', text: '#8c5e0a', cinema: '#e8b52e' });
    expect(contrastRatio(gold.text, surfaces.canvas)).toBeGreaterThanOrEqual(5.5);
  });

  it('company accents (graphic and text-safe)', () => {
    expect(companyAccents.mwanjalisi.graphic).toBe('#f08c00');
    expect(companyAccents.westsides).toMatchObject({ graphic: '#0071e3', text: '#0066cc' });
    expect(companyAccents.enterprises).toMatchObject({ graphic: '#00a36c', text: '#0a7a52' });
    // Documented deviation: the plan's #b25e09 is 4.29:1 on the alt tile.
    expect(contrastRatio('#b25e09', surfaces.alt)).toBeLessThan(4.5);
    expect(companyAccents.mwanjalisi.text).toBe('#aa5a08');
  });

  it('buttons are ink pills, inverted on cinema', () => {
    expect(buttons.primary.light).toMatchObject({ bg: '#1d1d1f', fg: '#ffffff' });
    expect(buttons.primary.cinema).toMatchObject({ bg: '#ffffff', fg: '#1d1d1f' });
  });

  it('nav material', () => {
    expect(materials.nav).toEqual({
      background: 'rgba(255, 255, 255, 0.72)',
      backdropFilter: 'saturate(180%) blur(20px)',
      fallback: '#ffffff',
    });
  });

  it('type scale', () => {
    expect(typeScale['display-xl']).toMatchObject({ size: 'clamp(3rem, 8vw, 6rem)', minPx: 48, maxPx: 96, weight: 600 });
    expect(typeScale.display).toMatchObject({ size: 'clamp(2.5rem, 6vw, 4.5rem)', minPx: 40, maxPx: 72, weight: 600 });
    expect([typeScale.h1.maxPx, typeScale.h2.maxPx, typeScale.h3.maxPx]).toEqual([56, 40, 28]);
    expect(typeScale.eyebrow).toMatchObject({ minPx: 14, weight: 600, tracking: '0.01em' });
    expect([typeScale.lede.minPx, typeScale.lede.maxPx]).toEqual([21, 24]);
    expect(typeScale.body).toMatchObject({ minPx: 17, lineHeight: '1.47', weight: 400 });
    expect([typeScale.legal.minPx, typeScale.caption.maxPx]).toEqual([12, 14]);
    // Headline tracking runs from -0.022em (display) to -0.015em (h3).
    expect(typeScale['display-xl'].tracking).toBe('-0.022em');
    expect(typeScale.h3.tracking).toBe('-0.015em');
    for (const name of ['display-xl', 'display', 'h1', 'h2', 'h3'] as const) {
      const tracking = parseFloat(typeScale[name].tracking);
      expect(tracking).toBeGreaterThanOrEqual(-0.022);
      expect(tracking).toBeLessThanOrEqual(-0.015);
    }
  });

  it('fluid headline sizes hit their stated px at 360px and 1068px viewports', () => {
    // clamp(min, a rem + b vw, max) at a 16px root.
    const at = (size: string, viewport: number) => {
      const match = /^clamp\(([\d.]+)rem, (?:([\d.]+)rem \+ )?([\d.]+)vw, ([\d.]+)rem\)$/.exec(size);
      if (!match) throw new Error(`Unexpected clamp ${size}`);
      const [, min, intercept = '0', slope, max] = match;
      const fluid = Number(intercept) * 16 + (Number(slope) * viewport) / 100;
      return Math.min(Math.max(fluid, Number(min) * 16), Number(max) * 16);
    };
    for (const name of ['h1', 'h2', 'h3', 'lede'] as const) {
      const style = typeScale[name];
      expect(at(style.size, 360)).toBeCloseTo(style.minPx, 0);
      expect(at(style.size, 1068)).toBeCloseTo(style.maxPx, 0);
    }
    expect(at(typeScale['display-xl'].size, 1200)).toBe(96);
    expect(at(typeScale['display-xl'].size, 360)).toBe(48);
  });

  it('shape, containers and spacing', () => {
    expect(radii).toEqual({ tile: [20, 28], card: 18, input: 12, pill: 9999 });
    expect(containers).toMatchObject({ prose: 980, content: 1068, wide: 1440 });
    expect(gutter).toBe(22);
    expect(sectionSpace.default).toEqual([80, 120]);
  });

  it('accent keys match the content AccentKey type', () => {
    // Compile time: every content accent key has a swatch. Run time: no extra keys.
    const byContentKey: Record<AccentKey, AccentSwatch> = accents;
    expect(Object.keys(byContentKey).sort()).toEqual(['enterprises', 'group', 'mwanjalisi', 'westsides']);
    expect(accents.group).toBe(gold);
  });

  it('every colour token is an opaque hex the contrast maths can read', () => {
    const hexes = [
      ...Object.values(surfaces),
      ...Object.values(hairlines),
      ...Object.values(text.light),
      ...Object.values(text.cinema),
      ...accentNames.flatMap((a) => Object.values(accents[a])),
      ...toneNames.flatMap((t) => (Object.keys(semanticVariables) as (keyof typeof semanticVariables)[]).map((key) => tones[t][key])),
    ];
    expect(hexes.length).toBeGreaterThan(40);
    for (const hex of hexes) {
      expect(parseColor(hex).a, hex).toBe(1);
      expect(hex).toMatch(/^#[0-9a-f]{6}$/);
    }
  });
});

describe('CSS variables written by the Tailwind plugin', () => {
  const styles = baseStyles() as Record<string, Record<string, string>>;

  it('hexToChannels', () => {
    expect(hexToChannels('#1d1d1f')).toBe('29 29 31');
    expect(hexToChannels('#fff')).toBe('255 255 255');
    expect(() => hexToChannels('rgba(0,0,0,.5)')).toThrow();
    expect(() => hexToChannels('#12345')).toThrow();
  });

  it(':root is the light tone with the group accent', () => {
    const root = styles[':root']!;
    expect(root).toMatchObject(toneDeclarations('light'));
    expect(root).toMatchObject(accentDeclarations('group'));
    expect(root['--fg']).toBe('29 29 31');
    expect(root['--accent-text']).toBe(hexToChannels(gold.text));
  });

  it.each(toneNames)('[data-tone="%s"] re-maps every semantic colour to its token', (tone) => {
    const block = styles[`[data-tone="${tone}"]`]!;
    for (const [key, variable] of Object.entries(semanticVariables)) {
      expect(block[variable], `${tone} ${variable}`).toBe(hexToChannels(tones[tone][key as keyof typeof semanticVariables]));
    }
    expect(block['--accent-fg']).toBe(tone === 'cinema' ? 'var(--accent-text-cinema)' : 'var(--accent-text)');
    expect(block['color-scheme']).toBe(tone === 'cinema' ? 'dark' : 'light');
  });

  it.each(accentNames)('[data-accent="%s"] swaps the whole swatch', (accent) => {
    const block = styles[`[data-accent="${accent}"]`]!;
    expect(block).toEqual({
      '--accent-graphic': hexToChannels(accents[accent].graphic),
      '--accent-text': hexToChannels(accents[accent].text),
      '--accent-text-cinema': hexToChannels(accents[accent].cinema),
      '--accent': 'var(--accent-graphic)',
    });
  });

  it('the tone accent slots resolve to the colours the contrast test checked', () => {
    for (const tone of toneNames) {
      for (const accent of accentNames) {
        const slot = toneDeclarations(tone)['--accent-fg']!.match(/var\((--[a-z-]+)\)/)![1]!;
        expect(accentDeclarations(accent)[slot]).toBe(hexToChannels(accentText(accent, tone)));
      }
    }
  });
});

describe('Tailwind compiles the tokens from the real config', () => {
  const html = [
    'bg-surface bg-surface-alt text-fg text-fg-muted text-fg-subtle border-line border-line-strong',
    'text-accent-fg bg-accent bg-btn text-btn-fg hover:bg-btn-hover bg-cinema bg-cinema-raised',
    'text-gold-text text-mwanjalisi-text text-westsides-cinema bg-enterprises text-danger text-success ring-focus',
    'text-display-xl text-display text-h1 text-h2 text-h3 text-lede text-body text-body-lg text-eyebrow text-caption text-legal',
    'rounded-tile rounded-card rounded-input rounded-pill max-w-measure max-w-prose max-w-content max-w-wide',
    'px-gutter py-section py-section-tight top-nav h-subnav z-nav z-quick-bar ease-apple duration-base shadow-card',
    // Legacy palette classes that must no longer generate anything:
    'bg-ink-950 text-slate-900 text-gold-400 bg-amber-500 text-electric-400 bg-grove-500 text-blue-300 font-tight',
  ].join(' ');

  let css = '';
  const compile = async () => {
    if (!css) {
      const result = await postcss([
        tailwindcss({ ...tailwindConfig, content: [{ raw: `<div class="${html}"></div>`, extension: 'html' }] }),
      ]).process('@tailwind base;\n@tailwind utilities;', { from: undefined });
      css = result.css;
    }
    return css;
  };

  it('emits the variables, tone maps and accent swatches', async () => {
    const out = await compile();
    expect(out).toMatch(/:root\s*\{[^}]*--surface: 255 255 255;/);
    expect(out).toMatch(/@media \(min-width: 768px\)\s*\{\s*:root\s*\{[^}]*--space-section: 120px;[^}]*--radius-tile: 28px;/);
    for (const tone of toneNames) expect(out).toContain(`[data-tone="${tone}"]`);
    for (const accent of accentNames) expect(out).toContain(`[data-accent="${accent}"]`);
    // Preflight's default border colour is the hairline token.
    expect(out).toContain('border-color: rgb(var(--line) / 1)');
  });

  it('builds the token utilities', async () => {
    const out = await compile();
    const expected: Record<string, RegExp> = {
      '.bg-surface': /background-color: rgb\(var\(--surface\) \/ var\(--tw-bg-opacity, 1\)\)/,
      '.text-accent-fg': /color: rgb\(var\(--accent-fg\) \/ var\(--tw-text-opacity, 1\)\)/,
      '.text-display-xl': /font-size: clamp\(3rem, 8vw, 6rem\);\s*line-height: 1\.05;\s*letter-spacing: -0\.022em;\s*font-weight: 600;/,
      '.text-eyebrow': /font-size: 0\.875rem;\s*line-height: 1\.43;\s*letter-spacing: 0\.01em;\s*font-weight: 600;/,
      '.rounded-tile': /border-radius: var\(--radius-tile\)/,
      '.max-w-prose': /max-width: var\(--container-prose\)/,
      '.py-section': /padding-top: var\(--space-section\)/,
      '.z-quick-bar': /z-index: var\(--z-quick-bar\)/,
    };
    for (const [selector, declaration] of Object.entries(expected)) {
      const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      expect(out, selector).toMatch(new RegExp(`${escaped} \\{[^}]*${declaration.source}`));
    }
  });

  it('generates no class from the retired palette or fonts', async () => {
    const out = await compile();
    for (const cls of ['bg-ink-950', 'text-slate-900', 'text-gold-400', 'bg-amber-500', 'text-electric-400', 'bg-grove-500', 'text-blue-300', 'font-tight']) {
      expect(out, cls).not.toContain(`.${cls}`);
    }
  });
});

describe('self-hosted fonts', () => {
  const fontsDir = path.join(ROOT, 'src/assets/fonts');

  it('fonts.ts loads the committed variable woff2', () => {
    const source = readFileSync(path.join(ROOT, 'src/design/fonts.ts'), 'utf8');
    expect(source).toContain("src: '../assets/fonts/InterVariable-latin.woff2'");
    expect(source).toContain("weight: '100 900'");
    expect(source).toContain("variable: '--font-sans'");
  });

  it('the variable woff2 is a real WOFF2 within the preload budget', () => {
    const file = path.join(fontsDir, 'InterVariable-latin.woff2');
    expect(readFileSync(file).subarray(0, 4).toString('latin1')).toBe('wOF2');
    expect(statSync(file).size).toBeLessThanOrEqual(100 * 1024);
  });

  it.each(['Inter-Regular.ttf', 'Inter-SemiBold.ttf', 'InterDisplay-SemiBold.ttf'])('og/%s is a static TrueType font for satori', (name) => {
    const bytes = readFileSync(path.join(fontsDir, 'og', name));
    expect(bytes.readUInt32BE(0)).toBe(0x00010000);
    expect(bytes.length).toBeLessThan(120 * 1024);
  });

  it('ships the OFL licence', () => {
    expect(readFileSync(path.join(fontsDir, 'OFL.txt'), 'utf8')).toContain('SIL Open Font License, Version 1.1');
  });

  it('base.css turns optical sizing on', () => {
    expect(readFileSync(path.join(ROOT, 'src/styles/base.css'), 'utf8')).toMatch(/font-optical-sizing: auto/);
  });
});
