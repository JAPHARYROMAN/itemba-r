/**
 * @contract Internal link crawl over the server HTML of every route
 * (JavaScript disabled, so this is what crawlers and no-JS visitors get):
 *
 *   - every internal href (relative, or absolute on www.itembagrouptz.com)
 *     answers 200 directly, without a redirect;
 *   - every fragment (`#id`, `/path#id`) names an element that exists on the
 *     target page;
 *   - tel:, mailto: and wa.me links are well formed (strict E.164 for tel:)
 *     and point only at the group's baseline numbers and address.
 */
import { baseline } from './support/baseline';
import { expect, openRoute, test } from './support/fixtures';
import { rawRequest } from './support/http';
import { ROUTES, sitePathOf } from './support/routes';

const statusCache = new Map<string, Promise<number>>();
const htmlCache = new Map<string, Promise<string>>();

function statusOf(target: string): Promise<number> {
  let p = statusCache.get(target);
  if (!p) {
    p = rawRequest(target, { timeoutMs: 60_000 }).then((r) => r.status);
    statusCache.set(target, p);
  }
  return p;
}

function htmlOf(target: string): Promise<string> {
  let p = htmlCache.get(target);
  if (!p) {
    p = rawRequest(target).then((r) => r.body.toString('utf8'));
    htmlCache.set(target, p);
  }
  return p;
}

const escapeRegex = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// Contact targets the baseline links to anywhere on the site.
const baselineHrefs = Object.values(baseline().routes).flatMap((r) => r.contactHrefs);
const TEL_NUMBERS = new Set(baselineHrefs.filter((h) => h.startsWith('tel:')).map((h) => h.slice(4)));
const EMAILS = new Set(
  baselineHrefs.filter((h) => h.startsWith('mailto:')).map((h) => decodeURIComponent(h.slice(7).split('?')[0] ?? '').toLowerCase()),
);
const WA_NUMBERS = new Set(
  baselineHrefs.filter((h) => h.includes('wa.me/')).map((h) => new URL(h).pathname.replace(/^\//, '')),
);

function contactProblem(href: string): string | null {
  if (/^tel:/i.test(href)) {
    const number = href.slice(4);
    if (!/^\+[1-9]\d{7,14}$/.test(number)) return `tel: link is not strict E.164: ${href}`;
    if (!TEL_NUMBERS.has(number)) return `tel: link to an unknown number: ${href}`;
    return null;
  }
  if (/^mailto:/i.test(href)) {
    const address = decodeURIComponent(href.slice(7).split('?')[0] ?? '').toLowerCase();
    if (!EMAILS.has(address)) return `mailto: link to an unknown address: ${href}`;
    return null;
  }
  if (href.includes('wa.me/')) {
    let url: URL;
    try {
      url = new URL(href);
    } catch {
      return `WhatsApp link does not parse: ${href}`;
    }
    if (url.protocol !== 'https:' || url.host !== 'wa.me') return `WhatsApp link must be https://wa.me/…: ${href}`;
    if (!WA_NUMBERS.has(url.pathname.replace(/^\//, ''))) return `WhatsApp link to an unknown number: ${href}`;
    return null;
  }
  return null;
}

test.describe('contract › link crawl', { tag: '@contract' }, () => {
  test.use({ javaScriptEnabled: false });

  test.beforeEach(async ({ page }) => {
    await page.route('**/*', (route) =>
      ['image', 'font', 'media', 'stylesheet'].includes(route.request().resourceType()) ? route.abort() : route.fallback(),
    );
  });

  for (const pathname of ROUTES) {
    test(`${pathname}: internal links resolve and fragments exist`, async ({ page }) => {
      test.setTimeout(120_000);
      await openRoute(page, pathname);
      const { hrefs, ids } = await page.evaluate(() => ({
        hrefs: [...document.querySelectorAll('a[href]')].map((a) => a.getAttribute('href') ?? ''),
        ids: [...document.querySelectorAll('[id]')].map((e) => e.id),
      }));
      const ownIds = new Set(ids);
      const problems: string[] = [];
      const checked = new Set<string>();

      for (const href of hrefs) {
        if (checked.has(href)) continue;
        checked.add(href);

        if (href.trim() === '' || href === '#') {
          problems.push(`empty link target ${JSON.stringify(href)}`);
          continue;
        }
        if (/^javascript:/i.test(href)) {
          problems.push(`javascript: link ${href}`);
          continue;
        }
        const contact = contactProblem(href);
        if (contact) {
          problems.push(contact);
          continue;
        }
        if (href.startsWith('#')) {
          const id = decodeURIComponent(href.slice(1));
          if (!ownIds.has(id)) problems.push(`${href}: no element with that id on ${pathname}`);
          continue;
        }
        const sitePath = sitePathOf(href);
        if (!sitePath) continue; // external or a contact scheme

        const [target = '/', fragment] = sitePath.split('#');
        const status = await statusOf(target || '/');
        if (status !== 200) {
          problems.push(`${href} → ${status}`);
          continue;
        }
        if (fragment) {
          const id = decodeURIComponent(fragment);
          const targetPath = (target || '/').split('?')[0] || '/';
          const exists =
            targetPath === pathname
              ? ownIds.has(id)
              : new RegExp(`\\sid="${escapeRegex(id)}"`).test(await htmlOf(target || '/'));
          if (!exists) problems.push(`${href}: #${id} does not exist on ${targetPath}`);
        }
      }

      test.info().annotations.push({ type: 'links checked', description: String(checked.size) });
      expect(problems, `${pathname} has broken links`).toEqual([]);
    });
  }
});
