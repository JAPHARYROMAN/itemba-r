/**
 * @contract QuickContact route matrix. The floating contact (a sticky bottom
 * bar in the rebuild, marked `data-quick-contact`) shows on the routes
 * without an inline enquiry form and hides on the rest, exactly as on
 * origin/main. Where it shows, it keeps the tel:, wa.me/ and mailto: targets
 * ConversionTracker classifies (mailto compared by meaning, so `+` → `%20`
 * in the subject is fine), and on a phone the call and WhatsApp actions are
 * visible. The matrix also has to follow client-side navigation.
 */
import { baselineRoute, normaliseContactHref } from './support/baseline';
import { readPageFacts } from './support/dom';
import { expect, test } from './support/fixtures';
import { ROUTES } from './support/routes';

test.describe('contract › QuickContact route matrix', { tag: '@contract' }, () => {
  for (const pathname of ROUTES) {
    const expected = baselineRoute(pathname).quickContact;
    test(`${pathname}: QuickContact is ${expected.present ? 'shown' : 'hidden'}`, async ({ page }, testInfo) => {
      const response = await page.goto(pathname, { waitUntil: 'load' });
      expect(response?.status()).toBe(200);
      await page.waitForLoadState('networkidle');
      const { quickContact } = await page.evaluate(readPageFacts);

      expect(quickContact.present, `QuickContact presence on ${pathname}`).toBe(expected.present);
      if (!expected.present) return;

      const got = new Set(quickContact.links.map((l) => normaliseContactHref(l.href)));
      const missing = expected.links.map((l) => l.href).filter((href) => !got.has(normaliseContactHref(href)));
      expect(missing, 'QuickContact contact targets missing').toEqual([]);

      if (testInfo.project.name === 'phone') {
        for (const kind of ['tel:', 'wa.me/']) {
          const visible = quickContact.links.some((l) => l.href.includes(kind) && l.visible);
          expect(visible, `QuickContact ${kind} action is visible on a phone`).toBe(true);
        }
      }
    });
  }

  test('QuickContact follows client-side navigation', async ({ page }) => {
    test.setTimeout(90_000);
    await expect(async () => {
      await page.goto('/', { waitUntil: 'load' });
      await page.waitForLoadState('networkidle');
      expect((await page.evaluate(readPageFacts)).quickContact.present, 'shown on home').toBe(true);

      await page.evaluate(() => {
        (window as unknown as { __e2eSameDocument?: boolean }).__e2eSameDocument = true;
        const link = document.querySelector<HTMLAnchorElement>('a[href="/contact"]');
        if (!link) throw new Error('home has no link to /contact');
        link.click();
      });
      await page.waitForURL((u) => u.pathname === '/contact');
      expect(
        await page.evaluate(() => (window as unknown as { __e2eSameDocument?: boolean }).__e2eSameDocument === true),
        'the navigation to /contact was client-side',
      ).toBe(true);
      await expect.poll(async () => (await page.evaluate(readPageFacts)).quickContact.present, { timeout: 10_000 }).toBe(false);

      await page.goBack();
      await page.waitForURL((u) => u.pathname === '/');
      await expect.poll(async () => (await page.evaluate(readPageFacts)).quickContact.present, { timeout: 10_000 }).toBe(true);
    }).toPass({ timeout: 80_000 });
  });
});
