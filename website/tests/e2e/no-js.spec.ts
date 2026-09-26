/**
 * @quality No-JavaScript experience, at 360 px and 1280 px. Expected to fail
 * on origin/main (framer-motion server-renders content at opacity 0, the
 * mobile menu needs JS, and the enquiry form submits as a GET) until the
 * rebuilt pages land.
 *
 *   - the server HTML has no inline opacity:0;
 *   - exactly one h1, and it is visible;
 *   - no text in <main> is rendered invisible by opacity or visibility, and
 *     main carries readable text;
 *   - the primary navigation is reachable (visible links, or a native
 *     popover/<details> menu that opens without JS);
 *   - on pages with the enquiry form, pressing Enter in a field does not
 *     navigate (no GET with personal data in the query string), and the
 *     WhatsApp, email and call fallbacks are on the page.
 */
import type { Page } from '@playwright/test';
import { baselineRoute } from './support/baseline';
import { expect, openRoute, test } from './support/fixtures';
import { inlineOpacityZero, rawRequest } from './support/http';
import { ROUTES, SITEMAP_PATHS } from './support/routes';

async function visibleNavTargets(page: Page): Promise<string[]> {
  return page.evaluate((paths) => {
    const seen = (el: Element) => {
      const r = el.getBoundingClientRect();
      return el.checkVisibility({ opacityProperty: true, visibilityProperty: true }) && r.width > 0 && r.height > 0;
    };
    const scopes = [...document.querySelectorAll('header, [popover], nav:not(main nav):not(footer nav)')];
    const hrefs = scopes.flatMap((s) => [...s.querySelectorAll('a[href^="/"]')].filter(seen).map((a) => a.getAttribute('href') ?? ''));
    return [...new Set(hrefs.filter((h) => h !== '/' && paths.includes(h)))];
  }, [...SITEMAP_PATHS]);
}

test.describe('quality › no JavaScript', { tag: '@quality' }, () => {
  test.use({ javaScriptEnabled: false });

  test.beforeEach(async ({ page }) => {
    await page.route('**/*', (route) =>
      ['image', 'font', 'media'].includes(route.request().resourceType()) ? route.abort() : route.fallback(),
    );
  });

  for (const pathname of ROUTES) {
    test(`${pathname}: content is visible without JavaScript`, async ({ page }) => {
      const problems: string[] = [];
      const html = (await rawRequest(pathname)).body.toString('utf8');
      const zero = inlineOpacityZero(html);
      if (zero.length) problems.push(`${zero.length} inline opacity:0 style(s) in the server HTML, e.g. ${zero[0]}`);

      await openRoute(page, pathname);
      const report = await page.evaluate(() => {
        const norm = (s: string | null | undefined) => (s ?? '').replace(/\s+/g, ' ').trim();
        const shown = (el: Element) => {
          const r = el.getBoundingClientRect();
          return el.checkVisibility({ opacityProperty: true, visibilityProperty: true }) && r.width > 0 && r.height > 0;
        };
        const h1s = [...document.querySelectorAll('h1')];
        const main = document.querySelector('main');
        const hiddenText: string[] = [];
        let visibleChars = 0;
        if (main) {
          for (const el of main.querySelectorAll('*')) {
            if (el.closest('script, style, template, noscript, [aria-hidden="true"], .print-document-root')) continue;
            const own = norm([...el.childNodes].filter((n) => n.nodeType === Node.TEXT_NODE).map((n) => n.textContent).join(' '));
            if (!own) continue;
            if (!el.checkVisibility()) continue; // not rendered at all (display:none, closed <details>)
            if (el.checkVisibility({ opacityProperty: true, visibilityProperty: true })) visibleChars += own.length;
            else hiddenText.push(own.slice(0, 60));
          }
        }
        return {
          h1Count: h1s.length,
          h1Visible: h1s.filter(shown).map((h) => norm(h.textContent)),
          hasMain: !!main,
          hiddenText,
          visibleChars,
        };
      });

      if (!report.hasMain) problems.push('no <main>');
      if (report.h1Count !== 1) problems.push(`${report.h1Count} h1 elements (expected exactly one)`);
      if (!report.h1Visible.length) problems.push('the h1 is not visible without JavaScript');
      if (report.hiddenText.length) {
        problems.push(
          `${report.hiddenText.length} text element(s) in <main> are invisible without JavaScript, e.g. ${report.hiddenText
            .slice(0, 5)
            .map((t) => JSON.stringify(t))
            .join(', ')}`,
        );
      }
      if (report.visibleChars < 80) problems.push(`only ${report.visibleChars} visible characters of text in <main>`);

      expect(problems, `${pathname} without JavaScript`).toEqual([]);
    });

    test(`${pathname}: primary navigation is reachable without JavaScript`, async ({ page }) => {
      await openRoute(page, pathname);
      let targets = await visibleNavTargets(page);
      if (targets.length < 3) {
        // A native menu (popover or <details>) opens without JavaScript.
        const toggle = page
          .locator('header button[popovertarget], header summary, button[popovertarget]')
          .filter({ visible: true })
          .first();
        if (await toggle.count()) {
          await toggle.click();
          targets = await visibleNavTargets(page);
        }
      }
      expect(targets.length, `visible primary navigation links on ${pathname}: ${targets.join(', ') || 'none'}`).toBeGreaterThanOrEqual(3);
    });

    if (baselineRoute(pathname).enquiryRouter.present) {
      test(`${pathname}: Enter in the enquiry form does not navigate`, async ({ page }) => {
        await openRoute(page, pathname);
        const startUrl = page.url();
        const form = page.locator('form:has(textarea)').first();
        await expect(form, 'the enquiry form is server-rendered').toHaveCount(1);
        const field = form
          .locator('input:not([type]), input[type="text"], input[type="email"], input[type="tel"]')
          .filter({ visible: true })
          .first();
        await expect(field, 'the enquiry form has a visible text field').toHaveCount(1);

        const navigations: string[] = [];
        page.on('request', (req) => {
          if (req.isNavigationRequest() && req.frame() === page.mainFrame()) navigations.push(`${req.method()} ${req.url()}`);
        });
        await field.fill('E2E No-JS Visitor');
        await field.press('Enter');
        await page.waitForTimeout(1_500);

        expect(navigations, 'pressing Enter submitted the form as a page navigation').toEqual([]);
        expect(page.url()).toBe(startUrl);

        const fallbacks = await page.evaluate(() => ({
          whatsapp: !!document.querySelector('a[href*="wa.me/"]'),
          email: !!document.querySelector('a[href^="mailto:"]'),
          call: !!document.querySelector('a[href^="tel:"]'),
        }));
        expect(fallbacks, 'WhatsApp, email and call fallbacks without JavaScript').toEqual({ whatsapp: true, email: true, call: true });
      });
    }
  }
});
