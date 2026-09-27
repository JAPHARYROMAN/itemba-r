/**
 * The UI kit (src/ui): server-rendered markup contracts.
 *
 * - Contact links emit exactly the hrefs ConversionTracker classifies.
 * - Breadcrumbs render the visible trail and a BreadcrumbList from the same
 *   items, in the shape the e2e readers expect.
 * - Heading level and size are independent; Reveal only adds data-reveal;
 *   nothing renders at opacity 0.
 * - Media takes size and blur from the registry and always renders a credit.
 * - The kit stays server-first: no 'use client' and no copy of its own.
 *
 * Rendered with react-dom/server; the components are plain server
 * components, so no Next runtime is needed.
 */
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { createElement as h, type ReactElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { contact, whatsappWithMessage } from '@/content/contact';
import { getMedia } from '@/content/media';
import { absoluteUrl } from '@/content/site';
import {
  Bento,
  BentoCell,
  Breadcrumbs,
  Button,
  ButtonLink,
  CardLink,
  ChevronLink,
  ContactLink,
  Container,
  CtaBand,
  Eyebrow,
  FactList,
  FaqList,
  Figure,
  Heading,
  Icon,
  Media,
  PageHero,
  Reveal,
  Section,
  Stat,
  StatList,
  SubNav,
  contactHref,
  iconNames,
} from '@/ui';

const ROOT = path.resolve(__dirname, '../..');
const render = (element: ReactElement) => renderToStaticMarkup(element);

/** ConversionTracker's classifier, verbatim (src/components/ConversionTracker.tsx is frozen). */
function classifyHref(href: string) {
  if (href.startsWith('tel:')) return 'phone_click';
  if (href.startsWith('mailto:')) return 'email_click';
  if (href.includes('wa.me/')) return 'whatsapp_click';
  return '';
}

const hrefOf = (html: string) => /href="([^"]*)"/.exec(html)?.[1]?.replace(/&amp;/g, '&') ?? '';

describe('ContactLink: hrefs ConversionTracker classifies', () => {
  it.each([
    [{ kind: 'tel' } as const, 'phone_click'],
    [{ kind: 'mailto' } as const, 'email_click'],
    [{ kind: 'mailto', subject: 'Business enquiry', body: 'Hello there' } as const, 'email_click'],
    [{ kind: 'whatsapp' } as const, 'whatsapp_click'],
    [{ kind: 'whatsapp', message: 'Fuel supply enquiry' } as const, 'whatsapp_click'],
  ])('%o → %s', (target, action) => {
    expect(classifyHref(contactHref(target))).toBe(action);
    for (const appearance of ['primary', 'secondary', 'inverse', 'chevron', 'plain'] as const) {
      const html = render(h(ContactLink, { ...target, appearance, children: 'Label' }));
      expect(classifyHref(hrefOf(html)), `${appearance}: ${html}`).toBe(action);
      expect(html).toContain(`data-contact="${target.kind}"`);
    }
  });

  it('uses the content module for every value', () => {
    expect(contactHref({ kind: 'tel' })).toBe(`tel:${contact.primaryPhone}`);
    expect(contactHref({ kind: 'tel', phone: contact.secondaryPhone })).toBe(`tel:${contact.secondaryPhone}`);
    expect(contactHref({ kind: 'mailto' })).toBe(`mailto:${contact.email}`);
    expect(contactHref({ kind: 'mailto', subject: 'A b' })).toBe(`mailto:${contact.email}?subject=A%20b`);
    expect(contactHref({ kind: 'whatsapp' })).toBe(contact.whatsapp);
    expect(contactHref({ kind: 'whatsapp', message: 'Hi' })).toBe(whatsappWithMessage('Hi'));
  });

  it('keeps WhatsApp in the same tab, as on origin/main', () => {
    expect(render(h(ContactLink, { kind: 'whatsapp', children: 'WhatsApp' }))).not.toContain('target=');
  });
});

describe('actions', () => {
  it('routes internal paths through next/link and leaves the rest as anchors', () => {
    expect(hrefOf(render(h(ButtonLink, { href: '/contact', children: 'Contact' })))).toBe('/contact');
    const external = render(h(ButtonLink, { href: 'https://example.com/x', children: 'Out' }));
    expect(hrefOf(external)).toBe('https://example.com/x');
  });

  it('primary pills read the tone; inverse borrows the cinema tone', () => {
    const primary = render(h(ButtonLink, { href: '/partnerships', children: 'Enquire' }));
    expect(primary).toContain('bg-btn');
    expect(primary).not.toContain('data-tone');
    const inverse = render(h(Button, { variant: 'inverse', children: 'Enquire' }));
    expect(inverse).toContain('data-tone="cinema"');
    expect(inverse).toContain('type="button"');
  });

  it('chevron links add screen-reader context and a decorative chevron', () => {
    const html = render(h(ChevronLink, { href: '/about', context: 'about the group', children: 'Learn more' }));
    expect(html).toContain('Learn <span class="whitespace-nowrap">more<span class="sr-only"> about the group</span>');
    expect(html).toMatch(/<svg[^>]*aria-hidden="true"/);
    expect(html).toContain('text-accent-fg');
  });

  it('chevron links keep the last word and the chevron on one line', () => {
    const html = render(h(ChevronLink, { href: '/locations/songwe-tunduma', children: 'View the location profile' }));
    expect(html).toMatch(/View the location <span class="whitespace-nowrap">profile<svg[^>]*aria-hidden="true"/);
    // A label assembled from several strings is still split at its last word.
    const parts = render(h(ChevronLink, { href: '/x.pdf', children: ['Download the profile', ' (', 'PDF', ')'] }));
    expect(parts).toMatch(/Download the profile <span class="whitespace-nowrap">\(PDF\)<svg/);
  });
});

describe('Breadcrumbs: one source for the trail and its JSON-LD', () => {
  const items = [
    { name: 'Home', path: '/' },
    { name: 'Companies', path: '/companies' },
    { name: 'Westsides Company Ltd', path: '/companies/westsides-company' },
  ];
  const html = render(h(Breadcrumbs, { items }));

  it('renders nav[aria-label=Breadcrumb] > ol > li, the current page as text', () => {
    expect(html).toMatch(/^<nav aria-label="Breadcrumb"[^>]*><ol/);
    expect(html.match(/<li/g)).toHaveLength(3);
    expect(html).toContain('<span aria-current="page" class="text-fg">Westsides Company Ltd</span>');
    expect(html).toContain('href="/companies"');
    expect(html).not.toContain('href="/companies/westsides-company"');
  });

  it('emits a BreadcrumbList with the same names, absolute URLs, positions 1..n', () => {
    const json = /<script type="application\/ld\+json">(.*?)<\/script>/.exec(html)?.[1];
    const data = JSON.parse(json ?? 'null');
    expect(data['@type']).toBe('BreadcrumbList');
    expect(data.itemListElement.map((i: { name: string }) => i.name)).toEqual(items.map((i) => i.name));
    expect(data.itemListElement.map((i: { item: string }) => i.item)).toEqual(items.map((i) => absoluteUrl(i.path)));
    expect(data.itemListElement.map((i: { position: number }) => i.position)).toEqual([1, 2, 3]);
  });

  it('can render a visual-only trail, and nothing for a single item', () => {
    expect(render(h(Breadcrumbs, { items, withJsonLd: false }))).not.toContain('ld+json');
    expect(render(h(Breadcrumbs, { items: [items[0]!] }))).toBe('');
  });
});

describe('text and layout', () => {
  it('Heading level and size are independent', () => {
    expect(render(h(Heading, { as: 'h2', size: 'display', children: 'Six sectors.' }))).toMatch(/^<h2 class="text-display text-fg">/);
    expect(render(h(Heading, { as: 'h3', children: 'Card' }))).toMatch(/^<h3 class="text-h3 text-fg">/);
    expect(render(h(Heading, { as: 'h4', size: 'h5', id: 'x', children: 'Row' }))).toMatch(/^<h4 id="x" class="text-body-lg font-semibold text-fg">/);
  });

  it('Section sets the tone and names itself only where the tag allows it', () => {
    const section = render(h(Section, { tone: 'cinema', accent: 'westsides', labelledBy: 't', children: 'x' }));
    expect(section).toMatch(/^<section aria-labelledby="t" data-tone="cinema" data-accent="westsides" class="py-section">/);
    expect(render(h(Section, { as: 'div', labelledBy: 't', children: 'x' }))).not.toContain('aria-');
    const inset = render(h(Section, { tone: 'alt', inset: true, label: 'Tile', children: 'x' }));
    expect(inset).toMatch(/^<section aria-label="Tile" class="px-gutter[^"]*"><div data-tone="alt" class="[^"]*rounded-tile/);
  });

  it('Container widths come from the tokens', () => {
    expect(render(h(Container, { size: 'prose', children: 'x' }))).toContain('max-w-prose');
    expect(render(h(Container, { children: 'x' }))).toContain('mx-auto box-content max-w-content px-gutter');
  });

  it('Eyebrow uses the text-safe accent', () => {
    expect(render(h(Eyebrow, { dot: true, children: 'Westsides Company Ltd' }))).toContain('text-accent-fg');
  });
});

describe('motion policy', () => {
  it('Reveal only adds data-reveal', () => {
    expect(render(h(Reveal, { children: 'x' }))).toBe('<div data-reveal="">x</div>');
    expect(render(h(Reveal, { as: 'li', className: 'a', children: 'x' }))).toBe('<li data-reveal="" class="a">x</li>');
  });

  it('utilities.css animates [data-reveal] only on screen, with no-preference and view() support', () => {
    const css = readFileSync(path.join(ROOT, 'src/styles/utilities.css'), 'utf8');
    const block = css.slice(css.indexOf('@media screen and (prefers-reduced-motion: no-preference)'));
    expect(block).toMatch(/^@media screen and \(prefers-reduced-motion: no-preference\) \{\s*@supports \(animation-timeline: view\(\)\) \{\s*\[data-reveal\]/);
    // The only opacity: 0 is the keyframe start, never a resting rule.
    const outside = css.replace(/@keyframes[^{]*\{(?:[^{}]*\{[^{}]*\})*[^{}]*\}/g, '');
    expect(outside).not.toMatch(/\[data-reveal\][^{]*\{[^}]*opacity:\s*0/);
  });

  it('the hero renders static, visible HTML', () => {
    const html = render(
      h(PageHero, {
        eyebrow: 'Songwe Region',
        title: 'Fuel, trade & logistics.',
        lede: 'Lede',
        actions: h(ButtonLink, { href: '/companies', children: 'Explore' }),
        media: h(Media, { media: 'mpemba-station-wide', alt: 'Forecourt', sizes: '100vw', aspect: '16/9', priority: true }),
      }),
    );
    expect(html).not.toMatch(/opacity:\s*0/);
    expect(html).not.toContain('data-reveal');
    expect(html).toMatch(/<section aria-labelledby="page-title" data-tone="light"/);
    expect(html).toContain('<h1 id="page-title" class="text-display text-fg">Fuel, trade &amp; logistics.</h1>');
  });
});

describe('Media', () => {
  it('takes intrinsic size and blur from the registry', () => {
    const entry = getMedia('mpemba-station-wide');
    const html = render(h(Media, { media: 'mpemba-station-wide', alt: 'Forecourt', sizes: '100vw' }));
    expect(html).toContain(`width="${entry.width}"`);
    expect(html).toContain(`height="${entry.height}"`);
    expect(html).toContain('alt="Forecourt"');
    expect(html).toContain('sizes="100vw"');
    expect(html).toContain('background-image:url(&quot;data:image/svg+xml');
    expect(html).not.toMatch(/opacity:\s*0/);
  });

  it('priority images are eager and have no blur placeholder', () => {
    const html = render(h(Media, { media: 'mpemba-station-wide', alt: '', sizes: '100vw', aspect: '16/9', priority: true }));
    expect(html).not.toContain('background-image');
    expect(html).not.toContain('loading="lazy"');
    expect(html).toContain('aspect-video');
  });

  it('always renders the credit of a credited image (the CC BY-SA landscape)', () => {
    const entry = getMedia('songwe-landscape');
    expect(entry.credit).toBeTruthy();
    for (const credit of ['below', 'overlay'] as const) {
      const html = render(h(Media, { media: 'songwe-landscape', alt: 'Songwe', sizes: '100vw', aspect: '3/2', credit }));
      expect(html).toContain(entry.credit!);
      expect(html).toContain(`href="${entry.licenceUrl}"`);
    }
    const figure = render(h(Figure, { media: 'songwe-landscape', alt: 'Songwe', sizes: '100vw', caption: 'Songwe Region' }));
    expect(figure).toMatch(/<figcaption[^>]*>Songwe Region<br\/><span class="text-legal">Photo: /);
  });
});

describe('data display', () => {
  it('FaqList renders details rows, with headings only when asked', () => {
    const faqs = [
      { question: 'What is Itemba Group?', answer: 'A holding group.' },
      { question: 'Where?', answer: 'Tunduma.' },
    ];
    const plain = render(h(FaqList, { faqs }));
    expect(plain.match(/<details/g)).toHaveLength(2);
    expect(plain).toContain('<span class="text-body-lg font-semibold">What is Itemba Group?</span>');
    const headed = render(h(FaqList, { faqs, headingLevel: 3 }));
    expect(headed).toContain('<h3 class="text-body-lg font-semibold">What is Itemba Group?</h3>');
  });

  it('Stats and facts are description lists', () => {
    const stats = render(h(StatList, { children: [h(Stat, { key: 'a', value: '3', label: 'Operating companies' })] }));
    expect(stats).toMatch(/^<dl[^>]*><div[^>]*><dt[^>]*>Operating companies<\/dt><dd[^>]*>3<\/dd>/);
    expect(render(h(FactList, { items: [{ term: 'Status', detail: 'Active' }] }))).toMatch(/<dl[^>]*><div[^>]*><dt[^>]*>Status<\/dt><dd[^>]*>Active<\/dd>/);
  });
});

describe('cards', () => {
  it('CardLink: the title is the only link, stretched over the card', () => {
    const html = render(h(CardLink, { href: '/services/fuel-and-lubricants', title: 'Fuel and Lubricants', description: 'd', cta: 'Learn more' }));
    expect(html.match(/<a /g)).toHaveLength(1);
    expect(html).toMatch(/<h3[^>]*><a [^>]*after:absolute after:inset-0[^>]*>Fuel and Lubricants<\/a><\/h3>/);
    expect(html).toContain('<span aria-hidden="true"');
  });

  it('Bento cells span the six-column grid', () => {
    const html = render(h(Bento, { children: [h(BentoCell, { key: 'a', span: 'two-thirds', tall: true, tone: 'cinema', children: 'x' })] }));
    expect(html).toContain('md:grid-cols-6');
    expect(html).toContain('lg:col-span-4');
    expect(html).toContain('md:row-span-2');
    expect(html).toContain('data-tone="cinema"');
  });
});

describe('page parts', () => {
  it('SubNav is a named, sticky nav with anchors and the Enquire pill', () => {
    const html = render(
      h(SubNav, {
        title: 'Westsides',
        label: 'Westsides sections',
        accent: 'westsides',
        links: [{ href: '#services', label: 'Services' }],
        cta: { href: '/partnerships', label: 'Enquire' },
      }),
    );
    expect(html).toMatch(/^<nav aria-label="Westsides sections" data-subnav="" data-tone="light" data-accent="westsides" class="sticky/);
    expect(html).toContain('href="#services"');
    expect(html).toContain('href="/partnerships"');
  });

  it('CtaBand is labelled by its heading', () => {
    const html = render(h(CtaBand, { titleId: 'closing', title: "Let's move something together." }));
    expect(html).toMatch(/^<section aria-labelledby="closing" data-tone="alt"/);
    expect(html).toContain('<h2 id="closing" class="text-display text-fg">');
  });

  it('Icon is decorative unless titled, and every glyph renders', () => {
    for (const name of iconNames) expect(render(h(Icon, { name }))).toContain('aria-hidden="true"');
    expect(render(h(Icon, { name: 'phone', title: 'Call' }))).toContain('role="img" aria-label="Call"');
  });
});

describe('the kit stays server-first and content-free', () => {
  const uiDir = path.join(ROOT, 'src/ui');
  const files = readdirSync(uiDir).filter((f) => /\.tsx?$/.test(f));

  it('has no client components', () => {
    for (const file of files) {
      expect(readFileSync(path.join(uiDir, file), 'utf8'), file).not.toMatch(/^\s*['"]use client['"]/m);
    }
  });

  it('imports content for types and data plumbing only (no page copy modules)', () => {
    const allowed = new Set(['@/content/types', '@/content/contact', '@/content/flags', '@/content/media']);
    for (const file of files) {
      const text = readFileSync(path.join(uiDir, file), 'utf8');
      for (const match of text.matchAll(/from '(@\/content\/[^']+)'/g)) {
        expect(allowed.has(match[1]!), `${file} imports ${match[1]}`).toBe(true);
      }
    }
  });
});
