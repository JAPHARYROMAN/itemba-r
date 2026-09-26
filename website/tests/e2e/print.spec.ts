/**
 * @contract Print: the company-profile print documents and the PDF
 * pipeline's hooks (architecture §5, §8.6), checked with print media
 * emulated in Chromium, the engine scripts/generate-profile-pdfs.mjs uses.
 *
 *   - picking a profile the way the PDF script and PrintProfileButton do
 *     (body[data-print-profile=<id>] + body.printing-company-profile) shows
 *     exactly that `.print-profile-document[data-profile=<id>]`, with real
 *     content, and nothing else from <main> or the site chrome;
 *   - a direct print with only the page's scope (Ctrl+P, no profile picked)
 *     prints the group profile;
 *   - on screen, the print documents stay hidden;
 *   - any other page prints its content without the nav, footer or
 *     quick-contact bar.
 *
 * The print rules must not depend on the DOM shape inside <main>, which is
 * why they are checked in a real layout rather than against selectors.
 */
import type { Page } from '@playwright/test';
import { expect, test } from './support/fixtures';

const PROFILES = ['group', 'westsides', 'mwanjalisi', 'enterprises'] as const;

type PrintState = {
  root: boolean;
  articles: Record<string, { shown: boolean; height: number; text: number }>;
  shownOutsideRoot: string[];
  chrome: Record<string, boolean>;
  mainShown: boolean;
};

/** Self-contained (serialised into the page). */
function readPrintState(): PrintState {
  const shown = (el: Element | null) => !!el && el.checkVisibility() && el.getBoundingClientRect().height > 0;
  const root = document.querySelector('.print-document-root');
  const articles: PrintState['articles'] = {};
  for (const article of document.querySelectorAll<HTMLElement>('.print-profile-document[data-profile]')) {
    articles[article.dataset.profile ?? ''] = {
      shown: shown(article),
      height: Math.round(article.getBoundingClientRect().height),
      text: (article.innerText ?? '').trim().length,
    };
  }
  const main = document.getElementById('main-content');
  const shownOutsideRoot: string[] = [];
  for (const el of main ? main.querySelectorAll('*') : []) {
    if (root && (root === el || root.contains(el) || el.contains(root))) continue;
    if (el.checkVisibility() && el.getBoundingClientRect().height > 0) {
      shownOutsideRoot.push(`${el.tagName.toLowerCase()}${el.className && typeof el.className === 'string' ? `.${el.className.split(/\s+/).slice(0, 2).join('.')}` : ''}`);
    }
  }
  const chrome: PrintState['chrome'] = {};
  for (const selector of ['.site-header', '.site-footer', '[data-quick-contact]', '.skip-link', '[data-subnav]']) {
    chrome[selector] = [...document.querySelectorAll(selector)].some((el) => shown(el));
  }
  return { root: shown(root), articles, shownOutsideRoot: shownOutsideRoot.slice(0, 8), chrome, mainShown: shown(main) };
}

/** Loads /company-profile and waits until its print islands have hydrated. */
async function openProfilePage(page: Page) {
  const response = await page.goto('/company-profile', { waitUntil: 'networkidle' });
  expect(response?.status()).toBe(200);
  // CompanyProfilePrintScope sets the scope; PrintProfileButton picks `group` on mount.
  await page.waitForFunction(() => document.body.dataset.printScope === 'company-profile' && !!document.body.dataset.printProfile);
}

const noChrome = { '.site-header': false, '.site-footer': false, '[data-quick-contact]': false, '.skip-link': false, '[data-subnav]': false };

test.describe('contract › print', { tag: '@contract' }, () => {
  for (const id of PROFILES) {
    test(`/company-profile prints only the ${id} profile`, async ({ page }) => {
      await openProfilePage(page);
      await page.emulateMedia({ media: 'print' });
      // Exactly what scripts/generate-profile-pdfs.mjs sets before page.pdf().
      await page.evaluate((profileId) => {
        document.body.dataset.printProfile = profileId;
        document.body.classList.add('printing-company-profile');
      }, id);

      const state = await page.evaluate(readPrintState);
      expect(state.root, '.print-document-root is displayed').toBe(true);
      expect(Object.keys(state.articles).sort()).toEqual([...PROFILES].sort());
      for (const profile of PROFILES) {
        expect(state.articles[profile]?.shown, `[data-profile=${profile}] displayed`).toBe(profile === id);
      }
      expect(state.articles[id]?.height, 'the chosen profile has a real layout').toBeGreaterThan(1000);
      expect(state.articles[id]?.text, 'the chosen profile has its text').toBeGreaterThan(1000);
      expect(state.shownOutsideRoot, 'screen content printed alongside the profile').toEqual([]);
      expect(state.chrome).toEqual(noChrome);
    });
  }

  test('/company-profile: a direct print with no profile picked prints the group profile', async ({ page }) => {
    await openProfilePage(page);
    await page.emulateMedia({ media: 'print' });
    await page.evaluate(() => {
      delete document.body.dataset.printProfile;
      document.body.classList.remove('printing-company-profile');
    });

    const state = await page.evaluate(readPrintState);
    expect(state.root).toBe(true);
    for (const profile of PROFILES) expect(state.articles[profile]?.shown, profile).toBe(profile === 'group');
    expect(state.shownOutsideRoot).toEqual([]);
    expect(state.chrome).toEqual(noChrome);
  });

  test('/company-profile on screen keeps the print documents hidden', async ({ page }) => {
    await openProfilePage(page);
    await page.emulateMedia({ media: 'screen' });
    const state = await page.evaluate(readPrintState);
    expect(state.root).toBe(false);
    expect(Object.values(state.articles).some((a) => a.shown)).toBe(false);
    expect(state.shownOutsideRoot.length, 'the screen view is visible').toBeGreaterThan(0);
    expect(state.chrome['.site-header'], 'the global nav is visible').toBe(true);
  });

  test('other pages print their content without the site chrome', async ({ page }) => {
    const response = await page.goto('/about', { waitUntil: 'networkidle' });
    expect(response?.status()).toBe(200);
    await page.emulateMedia({ media: 'print' });
    const state = await page.evaluate(readPrintState);
    expect(state.mainShown, '<main> prints').toBe(true);
    expect(state.shownOutsideRoot.length, 'the page content prints').toBeGreaterThan(0);
    expect(state.chrome).toEqual(noChrome);
  });
});
