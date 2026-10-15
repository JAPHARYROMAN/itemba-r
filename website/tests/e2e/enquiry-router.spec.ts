/**
 * @contract The direct-contact EnquiryRouter in a real browser. Its default
 * company and all three channel links ship in server HTML. Choosing another
 * company prepares its email subject and WhatsApp message, without collecting
 * personal details, posting to the retained API or reporting enquiry_submit.
 * analytics.spec.ts covers actual channel-click conversions; no test sends a
 * message or opens an external contact app.
 */
import type { Locator, Page } from '@playwright/test';
import { contact, contactActionLabels } from '../../src/content/contact';
import { enquiryFormCopy as copy, enquiryIntents } from '../../src/content/enquiry';
import { baselineRoute } from './support/baseline';
import { expect, test } from './support/fixtures';

type DataLayerEvent = Record<string, unknown> & { event?: string };

const DEFAULT_ROUTES = [
  '/contact',
  '/companies/mwanjalisi-oil',
  '/companies/westsides-company',
  '/companies/itemba-enterprises',
] as const;

async function installSpy(page: Page): Promise<void> {
  await page.addInitScript(() => {
    (window as unknown as { dataLayer?: unknown[] }).dataLayer = [];
  });
}

const conversions = (page: Page): Promise<DataLayerEvent[]> =>
  page.evaluate(() =>
    ((window as unknown as { dataLayer?: DataLayerEvent[] }).dataLayer ?? []).filter(
      (event) => event && (event.event === 'website_conversion' || event.event === 'enquiry_submit'),
    ),
  );

/** Abort any accidental API call before it can store or email anything. */
async function guardEnquiryApi(page: Page): Promise<string[]> {
  const requests: string[] = [];
  await page.route('**/api/enquiries', (route) => {
    requests.push(route.request().method());
    return route.abort('blockedbyclient');
  });
  return requests;
}

async function openRouter(page: Page, pathname = '/contact'): Promise<Locator> {
  const response = await page.goto(pathname, { waitUntil: 'load' });
  expect(response?.status()).toBe(200);
  const router = page.locator('section[data-enquiry-router][data-contact-mode="direct"]').first();
  await router.scrollIntoViewIfNeeded();
  await expect(router.getByRole('radio').first()).toBeEnabled({ timeout: 15_000 });
  return router;
}

async function expectPreparedLinks(router: Locator, intentId: string): Promise<void> {
  const intent = enquiryIntents.find((item) => item.id === intentId)!;
  await expect(router.getByRole('radio', { name: intent.segmentLabel, exact: true })).toBeChecked();
  await expect(router).toContainText(`${copy.routedToPrefix} ${intent.routeTo}`);

  const email = new URL((await router.locator('a[href^="mailto:"]').getAttribute('href')) ?? '');
  expect(email.protocol).toBe('mailto:');
  expect(email.pathname).toBe(contact.email);
  expect(email.searchParams.get('subject')).toBe(intent.subject);
  const message = email.searchParams.get('body');
  expect(message).toContain(`${copy.preparedMessage.intent}: ${intent.label}`);
  expect(message).toContain(`${copy.preparedMessage.routeTo}: ${intent.routeTo}`);

  const whatsapp = new URL((await router.locator('a[href*="wa.me/"]').getAttribute('href')) ?? '');
  expect(whatsapp.origin).toBe('https://wa.me');
  expect(whatsapp.pathname).toBe(`/${contact.primaryPhone.replace('+', '')}`);
  expect(whatsapp.searchParams.get('text')).toBe(message);
  await expect(router.locator('a[href^="tel:"]')).toHaveAttribute('href', `tel:${contact.primaryPhone}`);
}

test.describe('contract › direct contact routing', { tag: '@contract' }, () => {
  test.use({ contextOptions: { reducedMotion: 'reduce' } });

  test.beforeEach(async ({ page }) => {
    await installSpy(page);
  });

  test('server-renders all channels with the contact and company defaults', async ({ request }) => {
    for (const pathname of DEFAULT_ROUTES) {
      const response = await request.get(pathname);
      expect(response.status()).toBe(200);
      const html = await response.text();
      const router = /<section\b(?=[^>]*\bdata-enquiry-router)[^>]*>[\s\S]*?<\/section>/.exec(html)?.[0] ?? '';
      const intentId = baselineRoute(pathname).enquiryRouter.defaultIntent;
      const intent = enquiryIntents.find((item) => item.id === intentId)!;
      expect(router, `${pathname}: server-rendered direct contact card`).not.toBe('');
      expect(router).toContain('data-contact-mode="direct"');
      expect(router).toContain(`data-default-intent="${intentId}"`);
      expect(router).toContain(`href="mailto:${contact.email}?subject=${encodeURIComponent(intent.subject)}`);
      expect(router).toContain(`href="https://wa.me/${contact.primaryPhone.replace('+', '')}?text=`);
      expect(router).toContain(encodeURIComponent(`${copy.preparedMessage.routeTo}: ${intent.routeTo}`));
      expect(router).toContain(`href="tel:${contact.primaryPhone}"`);
      expect(router).not.toMatch(/<form\b|<textarea\b|<button\b|<input\b(?![^>]*type="radio")/);
    }
  });

  for (const pathname of DEFAULT_ROUTES) {
    test(`${pathname} opens with its company context and three direct channels`, async ({ page }) => {
      const requests = await guardEnquiryApi(page);
      const router = await openRouter(page, pathname);
      await expect(router.getByRole('radio')).toHaveCount(enquiryIntents.length);
      await expect(router.locator('form, input:not([type="radio"]), textarea, select, button')).toHaveCount(0);
      await expect(router.getByRole('link')).toHaveCount(3);
      for (const label of [contactActionLabels.whatsapp, contactActionLabels.email, contactActionLabels.call]) {
        await expect(router.getByRole('link', { name: label, exact: true })).toBeVisible();
      }
      await expectPreparedLinks(router, baselineRoute(pathname).enquiryRouter.defaultIntent!);
      expect(requests, 'opening a contact card never calls the enquiry API').toEqual([]);
      expect(await conversions(page), 'opening a contact card is not a conversion').toEqual([]);
    });
  }

  test('changing companies updates the subject and prepared message without submitting an enquiry', async ({ page }) => {
    const requests = await guardEnquiryApi(page);
    const router = await openRouter(page);
    for (const intent of enquiryIntents) {
      // The radio is visually hidden; select the same labelled tile people use.
      await router.getByText(intent.segmentLabel, { exact: true }).click();
      await expectPreparedLinks(router, intent.id);
    }
    expect(requests, 'company selection never calls the enquiry API').toEqual([]);
    expect(await conversions(page), 'company selection never reports enquiry_submit or a channel conversion').toEqual([]);
    expect(new URL(page.url()).pathname).toBe('/contact');
  });
});
