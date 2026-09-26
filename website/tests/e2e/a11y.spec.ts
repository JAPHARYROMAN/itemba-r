/**
 * @quality axe on every route at 360 px (phone project) and 1280 px (desktop
 * project): zero serious or critical violations, colour contrast included
 * (architecture §7). Expected to fail on origin/main (gold CTAs fail AA
 * contrast) until the rebuilt pages land; each page work package must turn
 * its routes green:
 *
 *   E2E_ROUTES=/about,/companies npm run test:e2e:quality -- a11y
 *
 * Reduced motion is emulated so axe reads settled content, not frames of an
 * entrance animation.
 */
import AxeBuilder from '@axe-core/playwright';
import { expect, openRoute, test } from './support/fixtures';
import { ROUTES } from './support/routes';

const BLOCKING = new Set(['serious', 'critical']);

test.describe('quality › accessibility (axe)', { tag: '@quality' }, () => {
  test.use({ contextOptions: { reducedMotion: 'reduce' } });
  test.describe.configure({ timeout: 120_000 });

  for (const pathname of ROUTES) {
    test(`${pathname}: no serious or critical axe violations`, async ({ page }, testInfo) => {
      await openRoute(page, pathname);
      await page.waitForLoadState('networkidle');
      // Walk the page once so in-view effects settle, then return to the top.
      await page.evaluate(async () => {
        const step = Math.max(200, Math.floor(window.innerHeight * 0.8));
        for (let y = 0; y < document.documentElement.scrollHeight; y += step) {
          window.scrollTo(0, y);
          await new Promise((r) => setTimeout(r, 30));
        }
        window.scrollTo(0, 0);
      });
      await page.waitForTimeout(300);

      const results = await new AxeBuilder({ page }).analyze();
      const blocking = results.violations.filter((v) => BLOCKING.has(v.impact ?? ''));
      await testInfo.attach('axe-violations.json', {
        body: JSON.stringify(results.violations, null, 2),
        contentType: 'application/json',
      });

      const summary = blocking.map(
        (v) =>
          `${v.impact} ${v.id}: ${v.help} (${v.nodes.length} node${v.nodes.length === 1 ? '' : 's'}; e.g. ${v.nodes
            .slice(0, 3)
            .map((n) => n.target.join(' '))
            .join(' | ')})`,
      );
      expect(summary, `${pathname} at ${page.viewportSize()?.width}px`).toEqual([]);
    });
  }
});
