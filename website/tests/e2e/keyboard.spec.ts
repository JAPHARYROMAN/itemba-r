/**
 * @quality Keyboard focus is never lost behind the phone chrome (WCAG 2.2
 * SC 2.4.3 Focus Order, 2.4.11 Focus Not Obscured), at 360 px:
 *
 * - The menu sheet is an opaque full-screen popover, so while it is open it
 *   is modal: Tab and Shift+Tab stay inside it (the page behind is inert),
 *   and Escape closes it, hands focus back to the menu button and gives the
 *   page back.
 * - The fixed quick-contact bar covers the bottom of the viewport: a forward
 *   Tab walk never leaves a focused control under it (scroll-padding-bottom
 *   in src/styles/utilities.css).
 *
 * Reduced motion is emulated so focus scrolling is instant and measurable.
 */
import type { Page } from '@playwright/test';
import { expect, openRoute, test } from './support/fixtures';

test.describe('quality › keyboard focus on phones', { tag: '@quality' }, () => {
  test.use({ contextOptions: { reducedMotion: 'reduce' } });

  test.skip(({ isMobile }) => !isMobile, 'the menu sheet and the quick-contact bar are phone chrome');

  /** Where focus is: inside the sheet, on <body> (between the document's ends), or elsewhere on the page. */
  const focusState = (page: Page) =>
    page.evaluate(() => {
      const sheet = document.getElementById('site-menu');
      const active = document.activeElement;
      let open = false;
      try {
        open = Boolean(sheet?.matches(':popover-open'));
      } catch {
        open = false;
      }
      const where = !active || active === document.body ? 'body' : sheet?.contains(active) ? 'sheet' : 'page';
      const label = active instanceof HTMLElement ? `${active.tagName.toLowerCase()} "${(active.getAttribute('aria-label') ?? active.textContent ?? '').trim().slice(0, 40)}"` : '';
      return { open, where, label };
    });

  test('/about: the open menu sheet keeps focus inside it, and Escape gives the page back', async ({ page }) => {
    test.setTimeout(90_000);
    await openRoute(page, '/about');
    await page.waitForLoadState('networkidle');
    // The island has hydrated: SiteNav marks the sheet once it can make it modal.
    await expect(page.locator('#site-menu[data-modal]')).toHaveCount(1, { timeout: 30_000 });
    const toggle = page.locator('header button[popovertarget="site-menu"]').first();
    await toggle.focus();
    await page.keyboard.press('Enter');
    await expect.poll(async () => (await focusState(page)).open).toBe(true);
    await expect.poll(async () => (await focusState(page)).where, { message: 'focus moves into the sheet' }).toBe('sheet');

    const sheetStops = await page.locator('#site-menu a, #site-menu button').count();
    let insideAgain = 0;
    for (let i = 0; i < sheetStops * 2 + 4; i += 1) {
      await page.keyboard.press('Tab');
      const state = await focusState(page);
      expect(state.open, `Tab ${i + 1}: the sheet stays open`).toBe(true);
      expect(state.where, `Tab ${i + 1}: focus on ${state.label} is outside the sheet`).not.toBe('page');
      if (state.where === 'sheet') insideAgain += 1;
    }
    expect(insideAgain, 'Tab cycles through the sheet').toBeGreaterThan(sheetStops);

    await page.locator('#site-menu a').first().focus();
    for (let i = 0; i < 3; i += 1) {
      await page.keyboard.press('Shift+Tab');
      const state = await focusState(page);
      expect(state.where, `Shift+Tab ${i + 1}: focus on ${state.label} is outside the sheet`).not.toBe('page');
    }

    await page.keyboard.press('Escape');
    await expect.poll(async () => (await focusState(page)).open).toBe(false);
    await expect(toggle).toBeFocused();
    const inert = await page.evaluate(() => document.querySelectorAll('[inert]').length);
    expect(inert, 'nothing stays inert once the sheet closes').toBe(0);
  });

  for (const pathname of ['/about', '/companies', '/services', '/locations']) {
    test(`${pathname}: a forward Tab walk never leaves focus under the quick-contact bar`, async ({ page }) => {
      test.setTimeout(90_000);
      await openRoute(page, pathname);
      await page.waitForLoadState('networkidle');
      const bar = page.locator('[data-quick-contact]');
      await expect(bar).toBeVisible();

      const hidden: string[] = [];
      let steps = 0;
      for (; steps < 400; steps += 1) {
        await page.keyboard.press('Tab');
        const probe = await page.evaluate(() => {
          const active = document.activeElement;
          const quickBar = document.querySelector('[data-quick-contact]');
          if (!active || active === document.body || !(active instanceof HTMLElement)) return { done: true };
          if (quickBar?.contains(active)) return { done: false };
          const rect = active.getBoundingClientRect();
          const barTop = quickBar?.getBoundingClientRect().top ?? window.innerHeight;
          const label = `${active.tagName.toLowerCase()} "${(active.getAttribute('aria-label') ?? active.textContent ?? '').trim().slice(0, 40)}" @${Math.round(rect.top)}-${Math.round(rect.bottom)}`;
          return { done: false, covered: rect.height > 0 && rect.bottom > barTop + 1, label };
        });
        if (probe.done) break;
        if (probe.covered && probe.label) hidden.push(probe.label);
      }
      expect(steps, 'the walk reached the end of the page').toBeGreaterThan(10);
      expect(hidden, 'focused controls under the quick-contact bar').toEqual([]);
    });
  }
});
