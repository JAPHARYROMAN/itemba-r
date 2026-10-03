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
 *   - website_conversion {conversion_action: enquiry_submit, intent_id,
 *     page_path} after a successful enquiry, with the POST /api/enquiries
 *     payload keeping its contract. The API is stubbed, so nothing is stored
 *     or emailed.
 */
import type { Locator, Page } from '@playwright/test';
import { baselineRoute } from './support/baseline';
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

async function firstVisible(page: Page, selector: string): Promise<Locator> {
  const inMain = page.locator(`main ${selector}`).filter({ visible: true });
  if (await inMain.count()) return inMain.first();
  const anywhere = page.locator(selector).filter({ visible: true });
  expect(await anywhere.count(), `no visible ${selector} on ${page.url()}`).toBeGreaterThan(0);
  return anywhere.first();
}

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

  for (const { action, selector, url } of CONTACT_CLICKS) {
    test(`${action}: clicking a ${selector.slice(2, -1)} link pushes website_conversion`, async ({ page }) => {
      await settle(page, '/contact');
      const link = await firstVisible(page, selector);
      // A click that lands before hydration is simply not tracked yet;
      // retry until the tracker's listener is attached.
      await expect(async () => {
        await link.click({ timeout: 5_000 });
        const events = (await dataLayer(page)).filter(
          (e) => e.event === 'website_conversion' && e.conversion_action === action,
        );
        expect(events.length).toBeGreaterThan(0);
      }).toPass({ timeout: 20_000 });

      const event = (await dataLayer(page)).find((e) => e.event === 'website_conversion' && e.conversion_action === action);
      expect(event?.page_path).toBe('/contact');
      expect(String(event?.link_url)).toMatch(url);
      expect(page.url(), 'the contact click must not leave the page').toMatch(/\/contact$/);
    });
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

  for (const pathname of ['/contact', '/companies/mwanjalisi-oil']) {
    test(`enquiry_submit on ${pathname} keeps the API payload and pushes the conversion`, async ({ page }) => {
      const expectedIntent = baselineRoute(pathname).enquiryRouter.defaultIntent;
      const payloads: Record<string, unknown>[] = [];
      await page.route('**/api/enquiries', async (route) => {
        if (route.request().method() !== 'POST') return route.fallback();
        payloads.push(route.request().postDataJSON() as Record<string, unknown>);
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ ok: true, id: 'e2e-contract', emailStatus: 'skipped', storageStatus: 'stored' }),
        });
      });

      // A submit that lands before hydration becomes a native form
      // submission (a reload, no payload); start over until the island is live.
      await expect(async () => {
        payloads.length = 0;
        await settle(page, pathname);
        const form = page.locator('form:has(textarea)').first();
        await form.scrollIntoViewIfNeeded();
        const fields = form
          .locator('input:not([type]), input[type="text"], input[type="email"], input[type="tel"], textarea')
          .filter({ visible: true });
        for (let i = 0; i < (await fields.count()); i += 1) {
          const field = fields.nth(i);
          if (!(await field.isEditable())) continue;
          const type = await field.evaluate((el) => (el.tagName === 'TEXTAREA' ? 'textarea' : (el as HTMLInputElement).type));
          await field.fill(
            type === 'email'
              ? 'e2e@example.com'
              : type === 'tel'
                ? '+255700000000'
                : type === 'textarea'
                  ? 'Automated contract test, please ignore.'
                  : 'E2E contract test',
          );
        }
        const submit = form.locator('button[type="submit"], button:not([type])').filter({ visible: true }).first();
        await expect(submit).toBeEnabled({ timeout: 15_000 });
        await submit.click();
        await expect.poll(() => payloads.length, { timeout: 10_000 }).toBeGreaterThan(0);
      }).toPass({ timeout: 60_000 });

      const body = payloads[0] ?? {};
      for (const key of ['intentId', 'name', 'organization', 'contactMethod', 'message', 'sourcePath', 'website']) {
        expect(body, `POST /api/enquiries payload keeps "${key}"`).toHaveProperty(key);
      }
      expect(body.intentId).toBe(expectedIntent);
      expect(body.sourcePath).toBe(pathname);
      expect(body.website, 'the honeypot stays empty for a person').toBe('');
      expect(String(body.contactMethod).trim()).not.toBe('');
      expect(String(body.message).trim()).not.toBe('');

      await expect
        .poll(async () => (await dataLayer(page)).find((e) => e.event === 'website_conversion' && e.conversion_action === 'enquiry_submit') ?? null)
        .not.toBeNull();
      const event = (await dataLayer(page)).find((e) => e.conversion_action === 'enquiry_submit');
      expect(event?.intent_id).toBe(expectedIntent);
      expect(event?.page_path).toBe(pathname);
      expect(event?.enquiry_id).toBe('e2e-contract');
      expect(new URL(page.url()).pathname).toBe(pathname);
    });
  }
});
