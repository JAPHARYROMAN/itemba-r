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
 *     quick-contact bar;
 *   - the print photos (~11 MB) are lazy: a screen visit downloads none of
 *     them, and picking a profile loads that document's photos, both the way
 *     the PDF script does it (its exact image steps, through the optimiser at
 *     w=828 q=75) and through PrintProfileButton, which waits for them before
 *     it calls window.print().
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
  // In order, in one worker: the image steps push a dozen photos through the
  // optimiser, and running them beside the print button's own photo wait
  // (a 4 s cap, by design) starves the server on a busy machine. A failure
  // still lets the rest run.
  test.describe.configure({ mode: 'default' });
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

  test('/company-profile on screen requests none of the print photos', async ({ page }) => {
    const requested: string[] = [];
    page.on('request', (request) => requested.push(new URL(request.url()).pathname));
    await openProfilePage(page);
    // Walk the whole page, so anything lazy near the viewport would have loaded.
    await page.evaluate(async () => {
      for (let y = 0; y < document.documentElement.scrollHeight; y += window.innerHeight) {
        window.scrollTo(0, y);
        await new Promise((r) => setTimeout(r, 60));
      }
    });
    await page.waitForLoadState('networkidle');

    const printImages = await page.evaluate(() =>
      [...document.querySelectorAll<HTMLImageElement>('.print-document-root img')].map((img) => ({
        src: img.getAttribute('src') ?? '',
        loading: img.getAttribute('loading'),
      })),
    );
    expect(printImages.length, 'the print documents have photos').toBeGreaterThan(8);
    for (const image of printImages) expect(image.loading, image.src).toBe('lazy');
    // A photo the screen view shows itself (as a plain <img>) may load; one only the print documents use must not.
    const onScreen = new Set(
      await page.evaluate(() =>
        [...document.querySelectorAll('img')].filter((img) => !img.closest('.print-document-root')).map((img) => img.getAttribute('src') ?? ''),
      ),
    );
    const printOnly = [...new Set(printImages.map((i) => i.src))].filter((src) => !onScreen.has(src));
    expect(printOnly.length, 'photos only the print documents use').toBeGreaterThan(4);
    const leaked = printOnly.filter((src) => requested.includes(src));
    expect(leaked, 'print-only photos requested by a screen visit').toEqual([]);
  });

  for (const id of ['group', 'mwanjalisi'] as const) {
    test(`/company-profile: the PDF script's image steps load every ${id} photo`, async ({ page }, testInfo) => {
      // The PDF script runs one desktop Chromium, and these steps push a
      // dozen photos through the optimiser: once is enough, and running them
      // in both projects starves the server for the other suites.
      test.skip(testInfo.project.name !== 'desktop', 'the PDF pipeline is viewport-independent; desktop only');
      // The image wait below alone may take 30 s on a loaded machine (the
      // optimiser encodes a dozen photos cold): room for it and the page load.
      test.setTimeout(90_000);
      const responses = new Map<string, number>();
      page.on('response', (response) => responses.set(response.url(), response.status()));
      await openProfilePage(page);
      await page.emulateMedia({ media: 'print' });
      // scripts/generate-profile-pdfs.mjs (frozen), verbatim apart from the listener.
      await page.evaluate((profileId) => {
        document.body.dataset.printProfile = profileId;
        document.body.classList.add('printing-company-profile');
        for (const doc of document.querySelectorAll('.print-profile-document')) {
          const active = doc.getAttribute('data-profile') === profileId;
          for (const img of doc.querySelectorAll('img')) {
            if (!active) {
              img.removeAttribute('src');
              img.removeAttribute('srcset');
              continue;
            }
            const src = img.getAttribute('src') || '';
            if (src.startsWith('/images/')) {
              img.setAttribute('src', `/_next/image?url=${encodeURIComponent(src)}&w=828&q=75`);
            }
          }
        }
      }, id);

      // The script then waits for the images: every one must load for real.
      const selector = `.print-profile-document[data-profile="${id}"] img`;
      await expect
        .poll(
          () =>
            page.evaluate(
              (sel) => [...document.querySelectorAll<HTMLImageElement>(sel)].filter((img) => !(img.complete && img.naturalWidth > 0)).length,
              selector,
            ),
          { timeout: 30_000, message: `${id}: images still loading or broken` },
        )
        .toBe(0);
      const eager = await page.evaluate((sel) => [...document.querySelectorAll<HTMLImageElement>(sel)].every((img) => img.loading === 'eager'), selector);
      expect(eager, 'PrintAssetLoader switched the chosen document to eager loading').toBe(true);
      // The photos came through the optimiser at the script's pinned size and quality.
      const photos = await page.evaluate(
        (sel) => [...document.querySelectorAll<HTMLImageElement>(sel)].map((img) => img.src).filter((src) => src.includes('/_next/image?')),
        selector,
      );
      expect(photos.length, 'the chosen document has optimised photos').toBeGreaterThan(2);
      for (const src of photos) {
        expect(src).toMatch(/&w=828&q=75$/);
        expect(responses.get(src), src).toBe(200);
      }
    });
  }

  test("/company-profile: the print button waits for the chosen profile's photos before printing", async ({ page }) => {
    await page.addInitScript(() => {
      const w = window as unknown as { __printCalls: { profile: string | undefined; printing: boolean; pending: number }[] };
      w.__printCalls = [];
      window.print = () => {
        const id = document.body.dataset.printProfile;
        const images = [...document.querySelectorAll<HTMLImageElement>(`.print-profile-document[data-profile="${id}"] img`)];
        w.__printCalls.push({
          profile: id,
          printing: document.body.classList.contains('printing-company-profile'),
          pending: images.filter((img) => !(img.complete && img.naturalWidth > 0)).length,
        });
      };
    });
    await openProfilePage(page);
    const picker = page.locator('.print-hidden').filter({ has: page.locator('select') }).first();
    await picker.locator('select').selectOption('westsides');
    await picker.getByRole('button').click();

    await expect.poll(() => page.evaluate(() => (window as unknown as { __printCalls: unknown[] }).__printCalls.length), { timeout: 10_000 }).toBe(1);
    const [call] = await page.evaluate(() => (window as unknown as { __printCalls: unknown[] }).__printCalls);
    expect(call).toEqual({ profile: 'westsides', printing: true, pending: 0 });
    // Only the chosen profile was fetched.
    const others = await page.evaluate(() =>
      [...document.querySelectorAll<HTMLImageElement>('.print-profile-document:not([data-profile="westsides"]) img[src^="/images/"]')].filter((img) => img.complete && img.naturalWidth > 0).length,
    );
    expect(others, 'photos of the other profiles loaded').toBe(0);
  });
});
