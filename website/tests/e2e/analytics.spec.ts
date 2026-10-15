/**
 * @contract Analytics spy. The frozen ConversionTracker and trackEvent push to
 * `window.dataLayer` when it exists, so the spy seeds an empty dataLayer
 * before any page script runs (the e2e build has no GA/GTM ids) and reads
 * what the site pushes:
 *
 *   - website_conversion {conversion_action: phone_click | email_click |
 *     whatsapp_click, link_url, page_path} for clicks on tel:, mailto: and
 *     wa.me links (navigation to the app/mail client is cancelled by a
 *     window-level listener that runs after the tracker's document listener);
 *   - page_view {page_path, page_location} after a client-side navigation
 *     (the same document, proven by a marker that survives the navigation);
 *   - the direct-contact card on contact and company pages records only
 *     those channel clicks. It never posts to /api/enquiries or reports
 *     enquiry_submit. Unexpected API calls are aborted before they can send.
 */
import type { Locator, Page } from '@playwright/test';
import { markQuickContact } from './support/dom';
import { expect, test } from './support/fixtures';
import { SITEMAP_PATHS } from './support/routes';

type DataLayerEvent = Record<string, unknown> & { event?: string };

async function installSpy(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const w = window as unknown as { dataLayer?: unknown[] };
    w.dataLayer = w.dataLayer || [];
    window.addEventListener('click', (event) => {
      const target = event.target instanceof Element ? event.target.closest('a') : null;
      const href = target?.getAttribute('href') ?? '';
      if (/^(tel|mailto):/i.test(href) || href.includes('wa.me/')) event.preventDefault();
    });
  });
}

const dataLayer = (page: Page): Promise<DataLayerEvent[]> =>
  page.evaluate(() =>
    ((window as unknown as { dataLayer?: unknown[] }).dataLayer ?? [])
      .filter((e): e is Record<string, unknown> => !!e && typeof e === 'object' && !Array.isArray(e) && 'event' in e)
      .map((e) => JSON.parse(JSON.stringify(e)) as Record<string, unknown>),
  );

async function settle(page: Page, pathname: string): Promise<void> {
  const response = await page.goto(pathname, { waitUntil: 'load' });
  expect(response?.status()).toBe(200);
  await page.waitForLoadState('networkidle');
}

const CONTACT_CLICKS = [
  { action: 'phone_click', selector: 'a[href^="tel:"]', url: /^tel:\+\d+$/ },
  { action: 'email_click', selector: 'a[href^="mailto:"]', url: /^mailto:/ },
  { action: 'whatsapp_click', selector: 'a[href*="wa.me/"]', url: /^https:\/\/wa\.me\// },
] as const;

test.describe('contract › analytics', { tag: '@contract' }, () => {
  test.describe.configure({ timeout: 90_000 });

  test.beforeEach(async ({ page }) => {
    await installSpy(page);
  });

  for (const pathname of ['/contact', '/companies/mwanjalisi-oil']) {
    for (const { action, selector, url } of CONTACT_CLICKS) {
      test(`${action} on ${pathname} records the direct channel without an enquiry submission`, async ({ page }) => {
        const requests: string[] = [];
        await page.route('**/api/enquiries', (route) => {
          requests.push(route.request().method());
          return route.abort('blockedbyclient');
        });
        await settle(page, pathname);
        const router = page.locator('[data-enquiry-router][data-contact-mode="direct"]').first();
        const link: Locator = router.locator(selector);
        await expect(link).toBeVisible();
        const expectedHref = await link.getAttribute('href');
        // A click that lands before hydration is simply not tracked yet;
        // retry until the tracker's listener is attached. The window listener
        // cancels navigation after the document listener records the click.
        await expect(async () => {
          await link.click({ timeout: 5_000 });
          const events = (await dataLayer(page)).filter(
            (event) => event.event === 'website_conversion' && event.conversion_action === action,
          );
          expect(events.length).toBeGreaterThan(0);
        }).toPass({ timeout: 20_000 });

        const events = await dataLayer(page);
        const event = events.find((item) => item.event === 'website_conversion' && item.conversion_action === action);
        expect(event?.page_path).toBe(pathname);
        expect(event?.link_url).toBe(expectedHref);
        expect(String(event?.link_url)).toMatch(url);
        expect(events.filter((item) => item.event === 'enquiry_submit' || item.conversion_action === 'enquiry_submit')).toEqual([]);
        expect(requests, 'direct contact must not call the enquiry API').toEqual([]);
        expect(new URL(page.url()).pathname, 'the test must not open an external contact app').toBe(pathname);
      });
    }
  }

  test('QuickContact call link on home pushes phone_click', async ({ page }, testInfo) => {
    await settle(page, '/');
    expect(await page.evaluate(markQuickContact), 'home shows QuickContact').toBe(true);
    // The rebuild's quick-contact bar is phone-only (plan: "mobile quick
    // contact"); from `md` the footer carries the same tel: action, so the
    // desktop project clicks that one.
    const link =
      testInfo.project.name === 'phone'
        ? page.locator('[data-e2e-quick-contact] a[href^="tel:"]').filter({ visible: true }).first()
        : page.locator('footer a[href^="tel:"]').filter({ visible: true }).first();
    await expect(async () => {
      await link.click({ timeout: 5_000 });
      const events = (await dataLayer(page)).filter((e) => e.event === 'website_conversion' && e.conversion_action === 'phone_click');
      expect(events.length).toBeGreaterThan(0);
    }).toPass({ timeout: 20_000 });
    const event = (await dataLayer(page)).find((e) => e.conversion_action === 'phone_click');
    expect(event?.page_path).toBe('/');
  });

  test('page_view fires on a client-side navigation', async ({ page }) => {
    await expect(async () => {
      await settle(page, '/');
      const targets = SITEMAP_PATHS.filter((p) => p !== '/');
      const link = page.locator('main a[href^="/"]').filter({ visible: true });
      const hrefs = await link.evaluateAll((els) => els.map((e) => e.getAttribute('href') ?? ''));
      const index = hrefs.findIndex((h) => targets.includes(h));
      expect(index, 'home needs a visible in-page link to another route').toBeGreaterThanOrEqual(0);
      const destination = hrefs[index] as string;

      await page.evaluate(() => {
        (window as unknown as { __e2eSameDocument?: boolean }).__e2eSameDocument = true;
      });
      await link.nth(index).click();
      await page.waitForURL((u) => u.pathname === destination);

      const sameDocument = await page.evaluate(() => (window as unknown as { __e2eSameDocument?: boolean }).__e2eSameDocument === true);
      expect(sameDocument, `navigating to ${destination} reloaded the document (not a client-side navigation)`).toBe(true);
      await expect
        .poll(async () => (await dataLayer(page)).find((e) => e.event === 'page_view' && e.page_path === destination) ?? null)
        .not.toBeNull();
      const view = (await dataLayer(page)).find((e) => e.event === 'page_view' && e.page_path === destination);
      expect(String(view?.page_location)).toMatch(new RegExp(`${destination.replace(/[/-]/g, '\\$&')}$`));
    }).toPass({ timeout: 60_000 });
  });

});
