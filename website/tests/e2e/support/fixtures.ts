/**
 * Shared Playwright fixtures. Every browser context is offline apart from the
 * server under test: Google Maps embeds, GA/GTM and any other third-party
 * request are aborted so results never depend on the network (architecture
 * §8: "Google Maps and GA requests are blocked or masked").
 */
import { test as base, expect, type BrowserContext, type Page } from '@playwright/test';
import { BASE_URL } from './http';

const serverHost = new URL(BASE_URL).host;

export async function keepOffline(context: BrowserContext): Promise<void> {
  await context.route(
    (url) => url.host !== serverHost,
    (route) => route.abort('blockedbyclient'),
  );
}

export const test = base.extend({
  // (`run` rather than the conventional `use`, which the React hooks lint rule claims.)
  context: async ({ context }, run) => {
    await keepOffline(context);
    await run(context);
  },
});

export { expect };

/** Normalised whitespace, as a reader sees it. */
export const norm = (s: string | null | undefined): string => (s ?? '').replace(/\s+/g, ' ').trim();

/**
 * Loads a route and fails fast on a non-200, so every per-route check starts
 * from a real page rather than the 404 page.
 */
export async function openRoute(page: Page, pathname: string): Promise<void> {
  const response = await page.goto(pathname, { waitUntil: 'load' });
  expect(response?.status(), `${pathname} should return 200`).toBe(200);
}
