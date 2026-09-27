/**
 * @contract The EnquiryRouter island in a real browser (src/islands/EnquiryRouter.tsx,
 * logic in src/lib/enquiry-client.ts). The API is always stubbed, so nothing
 * is stored or emailed. analytics.spec.ts covers the happy path's payload and
 * the enquiry_submit conversion on two pages; this spec covers the rest:
 *
 *   - a blank required field never reaches the API: the status line says
 *     why, the fields are aria-invalid and described by their own error
 *     lines, and focus moves to the first one;
 *   - a response that is not JSON (a proxy's 502 page) shows the form's own
 *     failure copy, never a parser error, and fires no conversion;
 *   - choosing a company routes everything to it: the payload's intentId,
 *     the email subject and the prepared WhatsApp message;
 *   - the submit button is disabled until the island hydrates.
 */
import type { Page, Route } from '@playwright/test';
import { enquiryFormCopy as copy, enquiryIntents } from '../../src/content/enquiry';
import { expect, test } from './support/fixtures';

type DataLayerEvent = Record<string, unknown> & { event?: string };

async function installSpy(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const w = window as unknown as { dataLayer?: unknown[] };
    w.dataLayer = w.dataLayer || [];
  });
}

const conversions = (page: Page): Promise<DataLayerEvent[]> =>
  page.evaluate(() =>
    ((window as unknown as { dataLayer?: DataLayerEvent[] }).dataLayer ?? []).filter(
      (e) => e && e.event === 'website_conversion' && e.conversion_action === 'enquiry_submit',
    ),
  );

/** Opens /contact and waits until the form is live (its submit button enables on hydration). */
async function openForm(page: Page) {
  const response = await page.goto('/contact', { waitUntil: 'load' });
  expect(response?.status()).toBe(200);
  const form = page.locator('form[data-enquiry-router]').first();
  await form.scrollIntoViewIfNeeded();
  await expect(form.getByRole('button', { name: copy.submit })).toBeEnabled({ timeout: 15_000 });
  return form;
}

test.describe('contract › enquiry form', { tag: '@contract' }, () => {
  // Instant scrolling: a tap that lands while the page is still smooth-
  // scrolling the form into view can miss its button on a busy machine.
  test.use({ contextOptions: { reducedMotion: 'reduce' } });

  test.beforeEach(async ({ page }) => {
    await installSpy(page);
  });

  test('ships its submit button disabled until hydration', async ({ request }) => {
    const html = await (await request.get('/contact')).text();
    const submit = /<button type="submit"[^>]*>/.exec(html)?.[0] ?? '';
    expect(submit, 'server-rendered submit button').not.toBe('');
    expect(submit).toContain('disabled');
  });

  test('keeps a blank enquiry on the page and says why', async ({ page }) => {
    const posts: string[] = [];
    await page.route('**/api/enquiries', (route) => {
      posts.push(route.request().method());
      return route.abort();
    });
    const form = await openForm(page);
    const status = form.getByRole('status');
    await expect(status).toHaveText('');

    await form.getByRole('button', { name: copy.submit }).click();

    await expect(status).toHaveText(copy.messages.required);
    const contact = form.locator('[name="contactMethod"]');
    const message = form.locator('[name="message"]');
    for (const [field, error] of [
      [contact, copy.fields.contactMethod.error],
      [message, copy.fields.message.error],
    ] as const) {
      await expect(field).toHaveAttribute('aria-invalid', 'true');
      // The accessible description is the field's own error line.
      await expect(field).toHaveAccessibleDescription(error);
    }
    await expect(contact).toBeFocused();

    // Typing clears that field's error; the other stays flagged.
    await contact.fill('+255700000000');
    await expect(contact).not.toHaveAttribute('aria-invalid', 'true');
    await expect(contact).toHaveAccessibleDescription('');
    await expect(message).toHaveAttribute('aria-invalid', 'true');
    expect(posts, 'no request reaches the API').toEqual([]);
    expect(new URL(page.url()).pathname).toBe('/contact');
  });

  test('shows its own failure copy for a non-JSON error page, and converts nothing', async ({ page }) => {
    await page.route('**/api/enquiries', (route: Route) =>
      route.request().method() === 'POST'
        ? route.fulfill({ status: 502, contentType: 'text/html', body: '<html><body><h1>502 Bad Gateway</h1></body></html>' })
        : route.fallback(),
    );
    const form = await openForm(page);
    await form.locator('[name="contactMethod"]').fill('e2e@example.com');
    await form.locator('[name="message"]').fill('Automated contract test, please ignore.');
    await form.getByRole('button', { name: copy.submit }).click();

    await expect(form.getByRole('status')).toHaveText(copy.messages.failed);
    await expect(form.locator('[name="message"]'), 'the message is kept for a retry').toHaveValue('Automated contract test, please ignore.');
    expect(await conversions(page)).toEqual([]);
  });

  test('routes the payload, the email and the WhatsApp message to the chosen company', async ({ page }) => {
    const payloads: Record<string, unknown>[] = [];
    await page.route('**/api/enquiries', async (route) => {
      if (route.request().method() !== 'POST') return route.fallback();
      payloads.push(route.request().postDataJSON() as Record<string, unknown>);
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ ok: true, id: 'e2e-intent', emailStatus: 'not_configured', storageStatus: 'stored' }),
      });
    });
    const form = await openForm(page);
    const fuel = enquiryIntents.find((intent) => intent.id === 'mwanjalisi')!;

    // The radio itself is visually hidden; people click its option tile.
    await form.getByText(fuel.segmentLabel, { exact: true }).click();
    await expect(form.getByRole('radio', { name: fuel.segmentLabel })).toBeChecked();
    await expect(form).toContainText(`${copy.routedToPrefix} ${fuel.routeTo}`);

    const mailto = decodeURIComponent((await form.locator('a[href^="mailto:"]').getAttribute('href')) ?? '');
    expect(mailto).toContain(`subject=${fuel.subject}`);
    const whatsapp = decodeURIComponent((await form.locator('a[href*="wa.me/"]').getAttribute('href')) ?? '');
    expect(whatsapp).toContain(`${copy.preparedMessage.routeTo}: ${fuel.routeTo}`);

    await form.locator('[name="contactMethod"]').fill('+255700000000');
    await form.locator('[name="message"]').fill('Automated contract test, please ignore.');
    await form.getByRole('button', { name: copy.submit }).click();

    await expect(form.getByRole('status')).toHaveText(copy.messages.sentAndStored);
    expect(payloads).toHaveLength(1);
    expect(payloads[0]).toMatchObject({ intentId: 'mwanjalisi', sourcePath: '/contact', website: '' });
    await expect(form.locator('[name="message"]'), 'the message clears after a successful submit, as before').toHaveValue('');
    const [event] = await conversions(page);
    expect(event).toMatchObject({ intent_id: 'mwanjalisi', route_to: fuel.routeTo, enquiry_id: 'e2e-intent', email_status: 'not_configured' });
  });
});
