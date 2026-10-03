/**
 * In-page readers. Each function is serialised into the browser by
 * page.evaluate, so it must be self-contained (no imports, no closures).
 *
 * The detection rules mirror scripts/snapshot-routes.mjs so the rebuild is
 * read exactly as the baseline was. Rebuilt components should carry the
 * explicit markers the snapshot understands:
 *   - EnquiryRouter: `data-enquiry-router` + `data-default-intent="<id>"`
 *   - QuickContact:  `data-quick-contact`
 *   - Breadcrumbs:   `<nav aria-label="Breadcrumb"><ol><li>…` (visible trail)
 */

export type PageFacts = {
  title: string;
  description: string | null;
  keywords: string | null;
  robots: string | null;
  canonical: string | null;
  og: [string, string][];
  twitter: [string, string][];
  jsonLdRaw: string[];
  h1: string[];
  ids: string[];
  hrefs: string[];
  enquiryRouters: { marker: string; defaultIntent: string | null; defaultIntentLabel: string | null }[];
  quickContact: { present: boolean; marker: string | null; links: { href: string; visible: boolean }[] };
  printHooks: { printDocumentRoot: number; printProfiles: string[]; downloadLinks: { href: string; download: boolean }[] };
};

export function readPageFacts(): PageFacts {
  const norm = (s: string | null | undefined) => (s ?? '').replace(/\s+/g, ' ').trim();
  const attr = (sel: string, name: string) => document.querySelector(sel)?.getAttribute(name) ?? null;
  const reactIdLike = (id: string) => /«|»|^:r[0-9a-z]*:$|^_[rR][_0-9a-zA-Z]*_$|^radix-/.test(id);
  const metaPairs = (selector: string, keyAttr: string) =>
    [...document.querySelectorAll(selector)].map(
      (m) => [m.getAttribute(keyAttr) ?? '', m.getAttribute('content') ?? ''] as [string, string],
    );
  const seen = (el: Element) =>
    el.checkVisibility({ opacityProperty: true, visibilityProperty: true }) &&
    el.getBoundingClientRect().width > 0 &&
    el.getBoundingClientRect().height > 0;

  const routers: PageFacts['enquiryRouters'] = [];
  for (const el of document.querySelectorAll('[data-enquiry-router]')) {
    routers.push({ marker: 'data-enquiry-router', defaultIntent: el.getAttribute('data-default-intent'), defaultIntentLabel: null });
  }
  if (!routers.length) {
    for (const form of document.querySelectorAll('form')) {
      const pressedButtons = form.querySelectorAll('button[aria-pressed]');
      const radios = form.querySelectorAll('input[type="radio"]');
      if (!form.querySelector('textarea') || (!pressedButtons.length && !radios.length)) continue;
      let label: string | null = null;
      let value: string | null = null;
      const pressed = form.querySelector('button[aria-pressed="true"]');
      if (pressed) label = norm(pressed.textContent);
      const checked = form.querySelector<HTMLInputElement>('input[type="radio"]:checked');
      if (checked) {
        value = checked.value;
        label =
          norm(
            checked.closest('label')?.textContent ||
              (checked.id && form.querySelector(`label[for="${checked.id}"]`)?.textContent),
          ) || label;
      }
      routers.push({ marker: 'heuristic-form', defaultIntent: value, defaultIntentLabel: label });
    }
  }

  let quick: Element | null = document.querySelector('[data-quick-contact]');
  let quickMarker: string | null = quick ? 'data-quick-contact' : null;
  if (!quick) {
    const tels = [...document.querySelectorAll('a[href^="tel:"]')].filter((a) => !a.closest('main, header, footer, nav, form'));
    outer: for (const a of tels) {
      let el = a.parentElement;
      while (el && el !== document.body) {
        if (el.querySelector('a[href*="wa.me/"]')) {
          quick = el;
          quickMarker = 'heuristic-tel-whatsapp';
          break outer;
        }
        el = el.parentElement;
      }
    }
  }

  const idEls = [...document.body.querySelectorAll('[id]')].filter((e) => e.id && !reactIdLike(e.id));

  return {
    title: document.title,
    description: attr('meta[name="description"]', 'content'),
    keywords: attr('meta[name="keywords"]', 'content'),
    robots: attr('meta[name="robots"]', 'content'),
    canonical: attr('link[rel="canonical"]', 'href'),
    og: metaPairs('meta[property^="og:"]', 'property'),
    twitter: metaPairs('meta[name^="twitter:"]', 'name'),
    jsonLdRaw: [...document.querySelectorAll('script[type="application/ld+json"]')].map((s) => s.textContent ?? ''),
    h1: [...document.querySelectorAll('h1')].map((h) => norm(h.textContent)),
    ids: idEls.filter((e) => !e.closest('svg')).map((e) => e.id),
    hrefs: [...document.querySelectorAll('a[href]')].map((a) => a.getAttribute('href') ?? ''),
    enquiryRouters: routers,
    quickContact: quick
      ? {
          present: true,
          marker: quickMarker,
          links: [...quick.querySelectorAll('a[href]')].map((a) => ({ href: a.getAttribute('href') ?? '', visible: seen(a) })),
        }
      : { present: false, marker: null, links: [] },
    printHooks: {
      printDocumentRoot: document.querySelectorAll('.print-document-root').length,
      printProfiles: [...document.querySelectorAll('.print-profile-document[data-profile]')].map(
        (a) => a.getAttribute('data-profile') ?? '',
      ),
      downloadLinks: [...document.querySelectorAll('a[href^="/downloads/"]')].map((a) => ({
        href: a.getAttribute('href') ?? '',
        download: a.hasAttribute('download'),
      })),
    },
  };
}

/**
 * Finds QuickContact with the same rule as readPageFacts (marker first, then
 * the legacy tel + WhatsApp cluster outside main/header/footer/nav/form) and
 * tags it `data-e2e-quick-contact` so tests can locate it. Returns presence.
 */
export function markQuickContact(): boolean {
  document.querySelectorAll('[data-e2e-quick-contact]').forEach((el) => el.removeAttribute('data-e2e-quick-contact'));
  let quick: Element | null = document.querySelector('[data-quick-contact]');
  if (!quick) {
    const tels = [...document.querySelectorAll('a[href^="tel:"]')].filter((a) => !a.closest('main, header, footer, nav, form'));
    outer: for (const a of tels) {
      let el = a.parentElement;
      while (el && el !== document.body) {
        if (el.querySelector('a[href*="wa.me/"]')) {
          quick = el;
          break outer;
        }
        el = el.parentElement;
      }
    }
  }
  quick?.setAttribute('data-e2e-quick-contact', '');
  return !!quick;
}

export type BreadcrumbTrail ={ visible: boolean; items: { name: string; href: string | null }[] };

/** Visible breadcrumb trails: `nav[aria-label~breadcrumb]` → its list items. */
export function readBreadcrumbTrails(): BreadcrumbTrail[] {
  const norm = (s: string | null | undefined) => (s ?? '').replace(/\s+/g, ' ').trim();
  const textWithoutHidden = (el: Element): string => {
    const clone = el.cloneNode(true) as Element;
    clone.querySelectorAll('[aria-hidden="true"]').forEach((n) => n.remove());
    return norm(clone.textContent);
  };
  return [...document.querySelectorAll('nav[aria-label*="breadcrumb" i]')].map((nav) => ({
    visible: nav.checkVisibility(),
    items: [...nav.querySelectorAll('li')]
      .filter((li) => li.getAttribute('aria-hidden') !== 'true')
      .map((li) => {
        const link = li.querySelector('a[href]');
        return {
          name: link?.getAttribute('aria-label') ? norm(link.getAttribute('aria-label')) : textWithoutHidden(li),
          href: link?.getAttribute('href') ?? null,
        };
      })
      .filter((item) => item.name),
  }));
}

/**
 * For each question, whether some rendered element (display-wise; a closed
 * <details> still renders its <summary>) carries exactly that text.
 */
export function findRenderedQuestions(questions: string[]): Record<string, boolean> {
  const norm = (s: string | null | undefined) => (s ?? '').replace(/\s+/g, ' ').trim();
  const candidates = [...document.body.querySelectorAll('summary, summary *, h2, h3, h4, h5, dt, button, p, span, div, a')];
  const out: Record<string, boolean> = {};
  for (const q of questions) {
    const target = norm(q);
    out[q] = candidates.some((el) => norm(el.textContent) === target && el.checkVisibility() && !el.closest('script'));
  }
  return out;
}
