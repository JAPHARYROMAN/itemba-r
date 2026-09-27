/**
 * WP1.5, the interactive islands and the corridor graphics:
 *
 * - enquiry-client keeps origin/main's enquiry contract (payload and key
 *   order, validation, success copy, conversion parameters, the prepared
 *   message) and now survives non-JSON responses and network failures;
 * - the EnquiryRouter island's server HTML: a fieldset of radio intents,
 *   named and labelled fields, an always-mounted status line, a submit
 *   button that is disabled until hydration, the no-JS fallbacks, the
 *   snapshot markers; the legacy import path is the same component;
 * - ProfileNav renders a native dialog sheet of the whole outline;
 * - PrintProfileButton keeps its print-hidden picker; the print documents'
 *   images are lazy plain <img src="/images/…"> and next.config pins the
 *   optimiser sizes the PDF script uses;
 * - the corridor map and story are server markup whose accessible content is
 *   an ordered list, with aria-hidden drawings and CSS that covers every
 *   site and stop.
 *
 * Rendered with react-dom/server; next/navigation's usePathname is mocked.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { createElement as h } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { contact, telHref, whatsappWithMessage } from '@/content/contact';
import { corridorHubStopId, corridorSites, corridorStops } from '@/content/corridor';
import { enquiryFormCopy as copy, enquiryIntents } from '@/content/enquiry';
import { outline, printableProfiles, printProfileOptions, profileNavCopy } from '@/content/profile';
import { hasUseClientDirective } from '../../scripts/lib/client-directive.mjs';

const route = vi.hoisted(() => ({ pathname: '/contact' }));
vi.mock('next/navigation', () => ({ usePathname: () => route.pathname }));

const client = await import('@/lib/enquiry-client');
const { default: EnquiryRouter } = await import('@/islands/EnquiryRouter');
const { default: LegacyEnquiryRouter } = await import('@/components/EnquiryRouter');
const { default: ProfileNav } = await import('@/islands/ProfileNav');
const { default: PrintProfileButton } = await import('@/islands/PrintProfileButton');
const { default: LegacyPrintProfileButton } = await import('@/components/PrintProfileButton');
const { default: ProfileDocuments } = await import('@/print/ProfileDocuments');
const { CorridorMap } = await import('@/sections/corridor/CorridorMap');
const { CorridorStory } = await import('@/sections/corridor/CorridorStory');

const ROOT = path.resolve(__dirname, '../..');
const read = (rel: string) => readFileSync(path.join(ROOT, rel), 'utf8');
const decode = (s: string) => s.replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#x27;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>');
const hrefs = (html: string) => [...html.matchAll(/href="([^"]*)"/g)].map(([, href = '']) => decode(href));
/** The start tag of the first element matching a pattern inside it. */
const tagWith = (html: string, pattern: RegExp) => html.match(new RegExp(`<[a-z]+[^>]*${pattern.source}[^>]*>`))?.[0] ?? '';
/** A start tag's attributes, names lowercased (the HTML parser lowercases them too; React's server output keeps some camelCase). */
const attrs = (tag: string): Record<string, string> =>
  Object.fromEntries([...tag.matchAll(/\s([a-zA-Z_:][-a-zA-Z0-9_:.]*)(?:="([^"]*)")?/g)].map(([, name = '', value = '']) => [name.toLowerCase(), decode(value)]));
/** Every start tag of an element name. */
const tags = (html: string, name: string) => [...html.matchAll(/<([a-z]+)(?=[\s/>])[^>]*>/g)].filter((m) => m[1] === name).map((m) => m[0]);

/** ConversionTracker's classifier, verbatim (src/components/ConversionTracker.tsx is frozen). */
function classifyHref(href: string) {
  if (href.startsWith('tel:')) return 'phone_click';
  if (href.startsWith('mailto:')) return 'email_click';
  if (href.includes('wa.me/')) return 'whatsapp_click';
  return '';
}

/* ── enquiry-client ────────────────────────────────────────────────────── */

describe('enquiry-client: the origin/main contract', () => {
  it('builds the prepared message line for line', () => {
    expect(
      client.buildMessage({
        intentLabel: 'Fuel and petroleum supply',
        routeTo: 'Mwanjalisi Oil Co Ltd',
        name: '  Asha ',
        organization: 'Corridor Traders',
        contactMethod: ' +255700000000 ',
        message: ' Need 10,000 L of diesel monthly. ',
      }),
    ).toBe(
      [
        'Hello Itemba Group,',
        '',
        'Enquiry type: Fuel and petroleum supply',
        'Please route to: Mwanjalisi Oil Co Ltd',
        'Name: Asha',
        'Organisation: Corridor Traders',
        'Preferred contact: +255700000000',
        '',
        'Message:',
        'Need 10,000 L of diesel monthly.',
        '',
        'Thank you.',
      ].join('\n'),
    );
    expect(client.buildMessage({ intentLabel: 'L', routeTo: 'R', name: ' ', organization: '', contactMethod: '', message: '' })).toBe(
      ['Hello Itemba Group,', '', 'Enquiry type: L', 'Please route to: R', '', 'Thank you.'].join('\n'),
    );
  });

  it('keeps the payload keys and their order', () => {
    const payload = client.enquiryPayload({
      website: '',
      sourcePath: '/contact',
      message: 'm',
      contactMethod: 'c',
      organization: 'o',
      name: 'n',
      intentId: 'westsides',
    });
    expect(Object.keys(payload)).toEqual(['intentId', 'name', 'organization', 'contactMethod', 'message', 'sourcePath', 'website']);
  });

  it('resolves an unknown default intent to general, as before', () => {
    expect(client.resolveIntentId('enterprises')).toBe('enterprises');
    expect(client.resolveIntentId('nope')).toBe('general');
    expect(client.resolveIntentId(undefined)).toBe('general');
    expect(client.intentFor('nope')).toBe(enquiryIntents[0]);
  });

  it('requires preferred contact and message, ignoring whitespace', () => {
    expect(client.missingRequired({ contactMethod: ' ', message: '\n' })).toEqual(['contactMethod', 'message']);
    expect(client.missingRequired({ contactMethod: 'x', message: ' ' })).toEqual(['message']);
    expect(client.missingRequired({ contactMethod: 'x', message: 'y' })).toEqual([]);
  });

  it('chooses the success copy from emailStatus, then storageStatus', () => {
    expect(client.successMessage({ ok: true, emailStatus: 'sent', storageStatus: 'stored' })).toBe(copy.messages.sentAndEmailed);
    expect(client.successMessage({ ok: true, emailStatus: 'not_configured', storageStatus: 'stored' })).toBe(copy.messages.sentAndStored);
    expect(client.successMessage({ ok: true, emailStatus: 'failed', storageStatus: 'skipped_ephemeral' })).toBe(copy.messages.sent);
  });

  it('sends the same enquiry_submit parameters', () => {
    const intent = client.intentFor('mwanjalisi');
    expect(client.enquiryConversion({ ok: true, id: 'abc', emailStatus: 'sent' }, intent, '/services/fuel-and-lubricants')).toEqual({
      enquiry_id: 'abc',
      intent_id: 'mwanjalisi',
      intent_label: intent.label,
      route_to: intent.routeTo,
      email_status: 'sent',
      page_path: '/services/fuel-and-lubricants',
    });
    expect(client.enquiryConversion({ ok: true, id: null }, intent, '/').email_status).toBe('unknown');
  });
});

describe('enquiry-client: postEnquiry', () => {
  const payload = client.enquiryPayload({
    intentId: 'general',
    name: '',
    organization: '',
    contactMethod: '+255700000000',
    message: 'Hello',
    sourcePath: '/contact',
    website: '',
  });
  const respond = (status: number, body: string, contentType = 'application/json') =>
    vi.fn<typeof fetch>(async () => new Response(body, { status, headers: { 'Content-Type': contentType } }));

  it('POSTs the JSON body to /api/enquiries', async () => {
    const fetchImpl = respond(200, JSON.stringify({ ok: true, id: '1', emailStatus: 'sent', storageStatus: 'stored' }));
    const outcome = await client.postEnquiry(payload, fetchImpl);
    expect(outcome).toEqual({ ok: true, result: { ok: true, id: '1', emailStatus: 'sent', storageStatus: 'stored' }, message: copy.messages.sentAndEmailed });
    const [url, init] = fetchImpl.mock.calls[0]!;
    expect(url).toBe('/api/enquiries');
    expect(init?.method).toBe('POST');
    expect(init?.headers).toEqual({ 'Content-Type': 'application/json' });
    expect(JSON.parse(String(init?.body))).toEqual(payload);
    expect(String(init?.body)).toBe(JSON.stringify(payload));
  });

  it("shows the server's error text for 400 and 503", async () => {
    const required = await client.postEnquiry(payload, respond(400, JSON.stringify({ ok: false, error: 'Preferred contact and message are required.' })));
    expect(required).toEqual({ ok: false, error: 'Preferred contact and message are required.' });
    const unsafe = 'The enquiry could not be safely saved or emailed. Please use WhatsApp, email, or phone for this enquiry.';
    expect(await client.postEnquiry(payload, respond(503, JSON.stringify({ ok: false, error: unsafe })))).toEqual({ ok: false, error: unsafe });
  });

  it('never shows a parser or network error', async () => {
    const failed = { ok: false, error: copy.messages.failed };
    expect(await client.postEnquiry(payload, respond(502, '<html><body>Bad gateway</body></html>', 'text/html'))).toEqual(failed);
    expect(await client.postEnquiry(payload, respond(500, ''))).toEqual(failed);
    expect(await client.postEnquiry(payload, respond(200, 'OK', 'text/plain'))).toEqual(failed);
    expect(await client.postEnquiry(payload, respond(200, '[1,2]'))).toEqual(failed);
    expect(await client.postEnquiry(payload, respond(200, JSON.stringify({ ok: false })))).toEqual(failed);
    expect(await client.postEnquiry(payload, respond(500, JSON.stringify({ ok: false, error: '  ' })))).toEqual(failed);
    const offline = vi.fn<typeof fetch>(async () => {
      throw new TypeError('Failed to fetch');
    });
    expect(await client.postEnquiry(payload, offline)).toEqual(failed);
  });
});

/* ── EnquiryRouter ─────────────────────────────────────────────────────── */

describe('EnquiryRouter island: server HTML', () => {
  const full = renderToStaticMarkup(h(EnquiryRouter));

  it('marks the form for the snapshot with its resolved default intent', () => {
    expect(full).toMatch(/^<form data-enquiry-router="" data-default-intent="general"/);
    expect(renderToStaticMarkup(h(EnquiryRouter, { defaultIntentId: 'mwanjalisi' }))).toContain('data-default-intent="mwanjalisi"');
    expect(renderToStaticMarkup(h(EnquiryRouter, { defaultIntentId: 'unknown' }))).toContain('data-default-intent="general"');
  });

  it('is named by its heading, at the level the page asks for', () => {
    const headingId = /aria-labelledby="([^"]+)"/.exec(full)?.[1];
    expect(headingId).toBeTruthy();
    expect(full).toContain(`<h2 id="${headingId}"`);
    expect(full).toContain(`>${copy.title}</h2>`);
    const nested = renderToStaticMarkup(h(EnquiryRouter, { headingLevel: 3, title: 'Ask about this location' }));
    expect(nested).toMatch(/<h3 id="[^"]+"[^>]*>Ask about this location<\/h3>/);
    expect(nested).not.toContain('<h2');
  });

  it('offers the intents as a fieldset of radios with a legend, the default checked', () => {
    expect(full).toMatch(new RegExp(`<fieldset[^>]*><legend[^>]*>${copy.intentLegend}</legend>`));
    const radios = (html: string) => tags(html, 'input').map(attrs).filter((a) => a.type === 'radio');
    expect(radios(full).map((a) => a.name)).toEqual(enquiryIntents.map(() => 'intentId'));
    expect(radios(full).map((a) => a.value)).toEqual(enquiryIntents.map((i) => i.id));
    expect(radios(full).filter((a) => 'checked' in a).map((a) => a.value)).toEqual(['general']);
    for (const intent of enquiryIntents) expect(full).toContain(intent.segmentLabel);
    const westsides = renderToStaticMarkup(h(EnquiryRouter, { defaultIntentId: 'westsides' }));
    expect(radios(westsides).filter((a) => 'checked' in a).map((a) => a.value)).toEqual(['westsides']);
  });

  it('shows where the enquiry goes', () => {
    expect(full).toContain(enquiryIntents[0].summary);
    expect(full).toContain(`${copy.routedToPrefix} <span class="font-semibold">${enquiryIntents[0].routeTo}</span>`);
  });

  it('gives every field a name, a label and autocomplete; required where the API requires', () => {
    const fields = [
      { name: 'name', autocomplete: 'name', required: false },
      { name: 'organization', autocomplete: 'organization', required: false },
      { name: 'contactMethod', autocomplete: 'tel', required: true },
      { name: 'message', autocomplete: 'off', required: true },
    ];
    const controls = [...tags(full, 'input'), ...tags(full, 'textarea')].map(attrs);
    for (const field of fields) {
      const control = controls.find((a) => a.name === field.name);
      expect(control, field.name).toBeDefined();
      expect(control!.autocomplete).toBe(field.autocomplete);
      expect('required' in control!, `${field.name} required`).toBe(field.required);
      expect(control!['aria-invalid']).toBeUndefined();
      expect(full, `${field.name} has a label`).toContain(`for="${control!.id}"`);
      if (field.required) {
        // The error line is server-rendered (empty) and always referenced.
        expect(control!['aria-describedby'], `${field.name} error line`).toBeTruthy();
        expect(full).toContain(`<p id="${control!['aria-describedby']}" class="mt-1.5 px-1 text-caption text-danger empty:hidden"></p>`);
      }
    }
    expect('novalidate' in attrs(tags(full, 'form')[0]!)).toBe(true);
    expect(full).toContain(`(${copy.optional})`);
  });

  it('hides the honeypot from people', () => {
    const honeypot = attrs(tagWith(full, /name="website"/));
    expect(honeypot).toMatchObject({ type: 'text', class: 'hidden', tabindex: '-1', 'aria-hidden': 'true', autocomplete: 'off' });
  });

  it('drops name and organisation in the compact form, as before', () => {
    const compact = renderToStaticMarkup(h(EnquiryRouter, { compact: true }));
    expect(compact).not.toContain('name="name"');
    expect(compact).not.toContain('name="organization"');
    expect(compact).toContain('name="contactMethod"');
    expect(compact).toContain('name="message"');
  });

  it('keeps submit disabled until hydration and the status line always mounted', () => {
    const submit = attrs(tagWith(full, /type="submit"/));
    expect('disabled' in submit).toBe(true);
    expect(submit.style).toBeUndefined();
    expect(full).toContain(`>${copy.submit}</button>`);
    expect(full).toMatch(/<p id="[^"]+" role="status" aria-live="polite" aria-atomic="true" class="[^"]*sr-only[^"]*"><\/p>/);
  });

  it('keeps the no-JS fallbacks: a noscript note and WhatsApp, email and call links with the prepared message', () => {
    expect(full).toContain(`<noscript><p class="mt-4 text-caption text-fg-muted">${copy.noScript}</p></noscript>`);
    const intent = enquiryIntents[0];
    const prepared = client.buildMessage({ intentLabel: intent.label, routeTo: intent.routeTo, name: '', organization: '', contactMethod: '', message: '' });
    const links = hrefs(full);
    expect(links).toContain(whatsappWithMessage(prepared));
    expect(links).toContain(`mailto:${contact.email}?subject=${encodeURIComponent(intent.subject)}&body=${encodeURIComponent(prepared)}`);
    expect(links).toContain(telHref(contact.primaryPhone));
    expect(links.map(classifyHref).filter(Boolean).sort()).toEqual(['email_click', 'phone_click', 'whatsapp_click']);
  });

  it('never renders content at opacity 0', () => {
    expect(full).not.toMatch(/opacity:\s*0/);
  });

  it('is what the legacy import path renders', () => {
    expect(LegacyEnquiryRouter).toBe(EnquiryRouter);
  });
});

/* ── ProfileNav ────────────────────────────────────────────────────────── */

describe('ProfileNav island', () => {
  const html = renderToStaticMarkup(h(ProfileNav, { outline, labels: profileNavCopy }));

  it('opens a labelled native dialog from a button', () => {
    const trigger = tagWith(html, /aria-haspopup="dialog"/);
    const dialogId = /aria-controls="([^"]+)"/.exec(trigger)?.[1];
    expect(trigger).toMatch(/^<button type="button"/);
    expect(dialogId).toBeTruthy();
    expect(trigger).toContain(`commandfor="${dialogId}"`);
    expect(trigger).toContain('command="show-modal"');
    const dialog = tagWith(html, /class="profile-contents"/);
    expect(dialog).toMatch(/^<dialog /);
    expect(dialog).toContain(`id="${dialogId}"`);
    expect(dialog).toContain('closedby="any"');
    expect(dialog).not.toMatch(/\sopen[=\s>]/);
    const titleId = /aria-labelledby="([^"]+)"/.exec(dialog)?.[1];
    expect(html).toContain(`<h2 id="${titleId}" class="text-body-lg font-semibold text-fg">${profileNavCopy.title}</h2>`);
    expect(html).toContain(`aria-label="${profileNavCopy.close}"`);
    expect(html).toContain('command="close"');
  });

  it('lists every section in order, the first marked current before the scrollspy runs', () => {
    const links = hrefs(html);
    expect(links).toEqual(outline.map((item) => `#${item.id}`));
    for (const item of outline) expect(html).toContain(item.title);
    expect([...html.matchAll(/aria-current="true"/g)]).toHaveLength(1);
    expect(html).toMatch(new RegExp(`href="#${outline[0].id}" aria-current="true"`));
    expect(html).toContain(`<span class="md:hidden">${profileNavCopy.trigger}</span>`);
  });
});

/* ── Print ─────────────────────────────────────────────────────────────── */

describe('PrintProfileButton island', () => {
  const html = renderToStaticMarkup(h(PrintProfileButton, { profiles: printProfileOptions }));

  it('keeps the print-hidden picker, a labelled select of every profile and its description', () => {
    expect(html).toMatch(/^<div class="print-hidden /);
    const selectId = /<select id="([^"]+)"/.exec(html)?.[1];
    expect(html).toContain(`<label for="${selectId}"`);
    expect([...html.matchAll(/<option value="([^"]+)"/g)].map((m) => m[1])).toEqual(printProfileOptions.map((p) => p.id));
    expect(html).toContain(printProfileOptions[0].description);
    expect(html).toContain('>Print selected profile</span>');
    expect('disabled' in attrs(tagWith(html, /type="button"/))).toBe(false);
  });

  it('is what the legacy import path renders', () => {
    expect(LegacyPrintProfileButton).toBe(PrintProfileButton);
  });
});

describe('print documents and the image optimiser', () => {
  const html = renderToStaticMarkup(h(ProfileDocuments));

  it('renders every image lazily as a plain <img src="/images/…"> (or the print logo)', () => {
    const images = [...html.matchAll(/<img [^>]*>/g)].map((m) => m[0]);
    expect(images.length).toBeGreaterThan(printableProfiles.length * 3);
    for (const image of images) {
      expect(image, image).toMatch(/^<img loading="lazy" src="\/(images\/[^"]+|logo-print\.png)"/);
      expect(image).not.toContain('srcset');
    }
  });

  it('keeps the document hooks the PDF script and print.css use', () => {
    expect(html).toMatch(/^<div class="print-document-root" aria-hidden="true"><article class="print-profile-document" data-profile="group">/);
    expect([...html.matchAll(/data-profile="([^"]+)"/g)].map((m) => m[1])).toEqual(printableProfiles.map((p) => p.id));
  });

  it("pins the optimiser's 828px width and quality 75 in next.config.ts", () => {
    const config = read('next.config.ts');
    const list = (key: string) =>
      (new RegExp(`${key}:\\s*\\[([^\\]]*)\\]`).exec(config)?.[1] ?? '')
        .split(',')
        .map((v) => Number(v.trim()))
        .filter((n) => !Number.isNaN(n) && n > 0);
    expect(list('deviceSizes')).toContain(828);
    expect(list('qualities')).toContain(75);
  });
});

/* ── Corridor ──────────────────────────────────────────────────────────── */

describe('CorridorMap (server)', () => {
  const html = renderToStaticMarkup(h(CorridorMap, { labelledBy: 'sites-title' }));
  const css = read('src/sections/corridor/corridor.css');

  it('lists the six sites as the accessible content, with the drawing hidden', () => {
    expect(html).toMatch(/^<div class="corridor-map /);
    expect(html).toMatch(/<div aria-hidden="true"[^>]*><svg /);
    expect(html).toContain('<ol role="list" aria-labelledby="sites-title"');
    const items = [...html.matchAll(/<li data-site="([^"]+)" data-manager="([^"]+)"/g)];
    expect(items.map((m) => m[1])).toEqual(corridorSites.map((s) => s.id));
    for (const site of corridorSites) {
      expect(html).toContain(`<h3 class="text-body-lg font-semibold text-fg">${site.name}</h3>`);
      expect(decode(html)).toContain(`${site.kind} · ${site.managerName}`);
      expect(decode(html)).toContain(site.detail);
    }
  });

  it('numbers the pins like the list and draws the office in group gold', () => {
    const pins = [...html.matchAll(/<g class="corridor-map__pin" data-site="([^"]+)" data-manager="([^"]+)">.*?<text[^>]*>(\d+)<\/text><\/g>/g)];
    expect(pins.map((m) => [m[1], m[3]])).toEqual(corridorSites.map((s, i) => [s.id, String(i + 1)]));
    expect(pins.find((m) => m[1] === 'hq')?.[2]).toBe('group');
    expect(css).toMatch(/\[data-manager='group'\]\s*\{\s*--manager: var\(--color-gold\);/);
  });

  it('highlights with CSS :has() for every site, and needs no client JavaScript', () => {
    for (const site of corridorSites) {
      expect(css).toContain(`.corridor-map:has([data-site='${site.id}']:hover) [data-site='${site.id}']`);
    }
    for (const file of ['src/sections/corridor/CorridorMap.tsx', 'src/sections/corridor/CorridorStory.tsx']) {
      expect(hasUseClientDirective(read(file)), file).toBe(false);
    }
    expect(html).not.toMatch(/opacity:\s*0/);
  });
});

describe('CorridorStory (server)', () => {
  const html = renderToStaticMarkup(h(CorridorStory, { labelledBy: 'corridor-title' }));
  const css = read('src/sections/corridor/corridor.css');

  it('is an ordered list of the stops, the hub stop listing its sites', () => {
    expect(html).toContain('<ol role="list" aria-labelledby="corridor-title" class="corridor-story__steps">');
    const steps = [...html.matchAll(/<li class="corridor-step" data-step="(\d+)"( data-hub="true")?>/g)];
    expect(steps.map((m) => m[1])).toEqual(corridorStops.map((_, i) => String(i + 1)));
    expect(steps.filter((m) => m[2]).map((m) => Number(m[1]) - 1)).toEqual([corridorStops.findIndex((s) => s.id === corridorHubStopId)]);
    for (const stop of corridorStops) {
      expect(html).toContain(`>${stop.name}</h3>`);
      expect(html).toContain(stop.note);
    }
    const hubStart = html.indexOf('<li class="corridor-step" data-step="3" data-hub="true">');
    expect(corridorStops[2]?.id).toBe(corridorHubStopId);
    expect(hubStart).toBeGreaterThan(0);
    const hubItem = html.slice(hubStart, html.indexOf('<li class="corridor-step" data-step="4"'));
    for (const site of corridorSites) expect(hubItem).toContain(`>${site.name}</span>`);
  });

  it('draws the route aria-hidden, with a scroll-drawn segment into every stop after the first', () => {
    expect(html).toMatch(/^<div class="corridor-story"><div aria-hidden="true" class="corridor-story__figure"><svg /);
    const segments = [...html.matchAll(/<path class="corridor-route__line" data-step="(\d+)" d="[^"]+" pathLength="1"/g)];
    expect(segments.map((m) => Number(m[1]))).toEqual(corridorStops.slice(1).map((_, i) => i + 2));
    expect([...html.matchAll(/<g class="corridor-route__node" data-step="\d+"/g)]).toHaveLength(corridorStops.length);
    expect([...html.matchAll(/class="corridor-route__site"/g)]).toHaveLength(corridorSites.length);
    expect(html).not.toMatch(/opacity:\s*0/);
  });

  it('animates only on wide screens, with motion welcome and scroll timelines supported; a timeline per stop', () => {
    const block = css.slice(css.indexOf('@media screen and (min-width: 1024px) and (prefers-reduced-motion: no-preference)'));
    expect(block).toMatch(/^@media screen and \(min-width: 1024px\) and \(prefers-reduced-motion: no-preference\) \{\s*@supports \(animation-timeline: view\(\)\) and \(timeline-scope: --corridor-step-1\)/);
    for (let step = 1; step <= corridorStops.length; step += 1) {
      expect(block).toContain(`.corridor-story [data-step='${step}'] {\n      --step-timeline: --corridor-step-${step};`);
      expect(block).toContain(`--corridor-step-${step}`);
    }
    // Every scroll-linked animation lives inside that guarded block.
    const before = css.slice(0, css.indexOf('@media screen and (min-width: 1024px) and (prefers-reduced-motion: no-preference)'));
    expect(before).not.toMatch(/animation(-timeline)?:/);
  });
});

/* ── Client boundaries ─────────────────────────────────────────────────── */

describe('client boundaries', () => {
  it('the islands are client components and the legacy paths are plain re-exports', () => {
    for (const file of ['EnquiryRouter', 'ProfileNav', 'PrintProfileButton', 'PrintAssetLoader']) {
      expect(hasUseClientDirective(read(`src/islands/${file}.tsx`)), file).toBe(true);
    }
    for (const file of ['src/components/EnquiryRouter.tsx', 'src/components/PrintProfileButton.tsx', 'src/print/ProfileDocuments.tsx']) {
      expect(hasUseClientDirective(read(file)), file).toBe(false);
    }
  });
});
