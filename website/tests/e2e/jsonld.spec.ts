/**
 * Structured data validation on every route (server HTML, JavaScript off).
 *
 * @contract (holds on origin/main and must keep holding):
 *   - every JSON-LD block parses; every top-level entity has @context
 *     schema.org and an @type;
 *   - the group Organization (@id …/#organization) is on every page, @id
 *     references resolve on the page, and no @id is defined twice;
 *   - telephones are E.164 numbers (visual separators allowed) and are the
 *     group's baseline numbers;
 *   - BreadcrumbList is well formed (positions 1..n, home first, the page
 *     itself last) and, WHEN the page shows a visible trail
 *     (`nav[aria-label*=breadcrumb]`), the JSON-LD matches it item for item;
 *   - every FAQPage question is rendered on the page; Articles have a
 *     headline and a valid datePublished.
 *
 * @quality (the rebuild's structured-data fixes; expected to fail on
 * origin/main until the pages are rebuilt):
 *   - telephones are canonical E.164 with no separators;
 *   - the group is never re-declared inline; it is referenced by @id;
 *   - every inner page has a visible breadcrumb trail and BreadcrumbList;
 *   - Article dates are visible on the page.
 */
import { baseline } from './support/baseline';
import { findRenderedQuestions, readBreadcrumbTrails } from './support/dom';
import { expect, openRoute, test } from './support/fixtures';
import {
  E164,
  allNodes,
  e164Digits,
  isReference,
  parseBlocks,
  telephonesIn,
  topLevelEntities,
  typesOf,
  type LdNode,
} from './support/jsonld';
import { ORG_ID, ROUTES, SITE_ORIGIN } from './support/routes';
import type { Page } from '@playwright/test';

const SCHEMA_CONTEXT = /^https?:\/\/schema\.org\/?$/;

// Group phone numbers in the baseline JSON-LD, separators removed.
const BASELINE_PHONES = new Set(
  Object.values(baseline().routes).flatMap((r) => r.jsonLd.flatMap((b) => telephonesIn(b.data).map(e164Digits))),
);

type LdPage = {
  entities: LdNode[];
  nodes: LdNode[];
  parseErrors: string[];
  canonical: string | null;
};

async function readLd(page: Page): Promise<LdPage> {
  const { raw, canonical } = await page.evaluate(() => ({
    raw: [...document.querySelectorAll('script[type="application/ld+json"]')].map((s) => s.textContent ?? ''),
    canonical: document.querySelector('link[rel="canonical"]')?.getAttribute('href') ?? null,
  }));
  const blocks = parseBlocks(raw);
  return {
    entities: blocks.flatMap((b) => topLevelEntities(b.data)),
    nodes: blocks.flatMap((b) => allNodes(b.data)),
    parseErrors: blocks.filter((b) => b.error).map((b) => `block ${b.index}: ${b.error}`),
    canonical,
  };
}

const sameUrl = (a: string | null | undefined, b: string | null | undefined): boolean => {
  if (!a || !b) return false;
  try {
    return new URL(a, SITE_ORIGIN).href === new URL(b, SITE_ORIGIN).href;
  } catch {
    return false;
  }
};

type ListItem = { position?: unknown; name?: unknown; item?: unknown };

function itemUrl(item: unknown): string | null {
  if (typeof item === 'string') return item;
  if (item && typeof item === 'object' && typeof (item as LdNode)['@id'] === 'string') return (item as LdNode)['@id'] as string;
  return null;
}

test.describe('contract › structured data', { tag: '@contract' }, () => {
  test.use({ javaScriptEnabled: false });

  test.beforeEach(async ({ page }) => {
    await page.route('**/*', (route) =>
      ['image', 'font', 'media'].includes(route.request().resourceType()) ? route.abort() : route.fallback(),
    );
  });

  for (const pathname of ROUTES) {
    test(`${pathname}: JSON-LD is valid and consistent with the page`, async ({ page }) => {
      await openRoute(page, pathname);
      const ld = await readLd(page);
      const problems: string[] = [...ld.parseErrors.map((e) => `does not parse: ${e}`)];

      if (!ld.entities.length) problems.push('no JSON-LD on the page');
      for (const e of ld.entities) {
        const label = `${typesOf(e).join('/') || '?'} ${String(e['@id'] ?? e.name ?? '')}`.trim();
        if (typeof e['@context'] !== 'string' || !SCHEMA_CONTEXT.test(e['@context'])) {
          problems.push(`${label}: @context ${JSON.stringify(e['@context'])} is not schema.org`);
        }
        if (!typesOf(e).length) problems.push(`${label}: missing @type`);
      }

      // ── Group organisation and @id integrity ──
      const org = ld.entities.find((e) => e['@id'] === ORG_ID);
      if (!org) problems.push(`the group Organization ${ORG_ID} is missing`);
      else if (!typesOf(org).includes('Organization')) problems.push(`${ORG_ID} is typed ${JSON.stringify(org['@type'])}`);

      const defined = new Map<string, number>();
      for (const e of ld.entities) {
        if (typeof e['@id'] === 'string') defined.set(e['@id'], (defined.get(e['@id']) ?? 0) + 1);
      }
      for (const [id, count] of defined) if (count > 1) problems.push(`${id} is defined ${count} times`);
      const definedAnywhere = new Set(
        ld.nodes.filter((n) => !isReference(n) && typeof n['@id'] === 'string').map((n) => n['@id'] as string),
      );
      for (const ref of ld.nodes.filter(isReference)) {
        const id = ref['@id'] as string;
        if (!definedAnywhere.has(id)) problems.push(`reference to ${id} does not resolve on this page`);
      }

      // ── Telephones ──
      for (const phone of ld.nodes.flatMap((n) => telephonesIn({ telephone: n.telephone }))) {
        const digits = e164Digits(phone);
        if (!E164.test(digits)) problems.push(`telephone ${JSON.stringify(phone)} is not an E.164 number`);
        else if (!BASELINE_PHONES.has(digits)) problems.push(`telephone ${phone} is not one of the group's numbers`);
      }

      // ── Breadcrumbs ──
      const crumbs = ld.entities.filter((e) => typesOf(e).includes('BreadcrumbList'));
      if (crumbs.length > 1) problems.push(`${crumbs.length} BreadcrumbList entities`);
      const crumb = crumbs[0];
      const items = (Array.isArray(crumb?.itemListElement) ? crumb.itemListElement : []) as ListItem[];
      if (crumb) {
        if (!items.length) problems.push('BreadcrumbList has no items');
        items.forEach((it, i) => {
          if (Number(it.position) !== i + 1) problems.push(`breadcrumb item ${i} has position ${String(it.position)}`);
          if (typeof it.name !== 'string' || !it.name.trim()) problems.push(`breadcrumb item ${i + 1} has no name`);
          const url = itemUrl(it.item);
          if (url !== null && !url.startsWith(SITE_ORIGIN)) problems.push(`breadcrumb item ${i + 1} URL ${url} is not absolute on ${SITE_ORIGIN}`);
          if (url === null && i < items.length - 1) problems.push(`breadcrumb item ${i + 1} has no URL`);
        });
        if (items.length && !sameUrl(itemUrl(items[0]?.item), SITE_ORIGIN)) problems.push('breadcrumb does not start at home');
        const lastUrl = itemUrl(items[items.length - 1]?.item);
        if (lastUrl !== null && !sameUrl(lastUrl, ld.canonical)) problems.push(`last breadcrumb ${lastUrl} is not the page (${ld.canonical})`);
      }
      const trails = (await page.evaluate(readBreadcrumbTrails)).filter((t) => t.visible && t.items.length >= 2);
      for (const trail of trails) {
        if (!crumb) {
          problems.push(`visible breadcrumb trail (${trail.items.map((i) => i.name).join(' › ')}) has no BreadcrumbList`);
          continue;
        }
        const visibleNames = trail.items.map((i) => i.name);
        const ldNames = items.map((i) => String(i.name ?? '').replace(/\s+/g, ' ').trim());
        if (JSON.stringify(visibleNames) !== JSON.stringify(ldNames)) {
          problems.push(`visible trail ${JSON.stringify(visibleNames)} ≠ BreadcrumbList ${JSON.stringify(ldNames)}`);
        }
        trail.items.forEach((vis, i) => {
          if (vis.href && !sameUrl(vis.href, itemUrl(items[i]?.item))) {
            problems.push(`visible trail item "${vis.name}" links ${vis.href}, BreadcrumbList says ${itemUrl(items[i]?.item)}`);
          }
        });
      }

      // ── FAQPage ──
      const questions: string[] = [];
      for (const faq of ld.entities.filter((e) => typesOf(e).includes('FAQPage'))) {
        const main = (Array.isArray(faq.mainEntity) ? faq.mainEntity : []) as LdNode[];
        if (!main.length) problems.push('FAQPage has no questions');
        for (const q of main) {
          const answer = q.acceptedAnswer as LdNode | undefined;
          if (!typesOf(q).includes('Question') || typeof q.name !== 'string') problems.push(`FAQ entry is not a named Question: ${JSON.stringify(q).slice(0, 80)}`);
          else questions.push(q.name);
          if (!answer || !typesOf(answer).includes('Answer') || typeof answer.text !== 'string' || !answer.text.trim()) {
            problems.push(`FAQ "${String(q.name)}" has no Answer text`);
          }
        }
      }
      if (questions.length) {
        const rendered = await page.evaluate(findRenderedQuestions, questions);
        for (const [q, ok] of Object.entries(rendered)) if (!ok) problems.push(`FAQ question not rendered on the page: "${q}"`);
      }

      // ── Article ──
      for (const article of ld.entities.filter((e) => typesOf(e).includes('Article'))) {
        if (typeof article.headline !== 'string' || !article.headline.trim()) problems.push('Article has no headline');
        if (typeof article.datePublished !== 'string' || Number.isNaN(Date.parse(article.datePublished))) {
          problems.push(`Article datePublished ${JSON.stringify(article.datePublished)} is not a date`);
        }
      }

      expect(problems, `${pathname} structured data`).toEqual([]);
    });
  }
});

test.describe('quality › structured data', { tag: '@quality' }, () => {
  test.use({ javaScriptEnabled: false });

  test.beforeEach(async ({ page }) => {
    await page.route('**/*', (route) =>
      ['image', 'font', 'media'].includes(route.request().resourceType()) ? route.abort() : route.fallback(),
    );
  });

  for (const pathname of ROUTES) {
    test(`${pathname}: structured data meets the rebuild spec`, async ({ page }) => {
      await openRoute(page, pathname);
      const ld = await readLd(page);
      const problems: string[] = [];

      for (const phone of ld.nodes.flatMap((n) => telephonesIn({ telephone: n.telephone }))) {
        if (!E164.test(phone)) problems.push(`telephone ${JSON.stringify(phone)} is not canonical E.164 (no spaces)`);
      }

      const groupName = typeof ld.entities.find((e) => e['@id'] === ORG_ID)?.name === 'string'
        ? (ld.entities.find((e) => e['@id'] === ORG_ID)?.name as string)
        : 'Itemba Group';
      for (const n of ld.nodes) {
        if (n['@id'] === ORG_ID || isReference(n)) continue;
        if (typesOf(n).includes('Organization') && n.name === groupName) {
          problems.push(`the group is re-declared inline (${JSON.stringify(n).slice(0, 100)}…); reference {"@id": "${ORG_ID}"} instead`);
        }
      }

      if (pathname !== '/') {
        const trails = (await page.evaluate(readBreadcrumbTrails)).filter((t) => t.visible && t.items.length >= 2);
        if (!trails.length) problems.push('no visible breadcrumb trail (nav[aria-label="Breadcrumb"])');
        if (!ld.entities.some((e) => typesOf(e).includes('BreadcrumbList'))) problems.push('no BreadcrumbList JSON-LD');
      }

      for (const article of ld.entities.filter((e) => typesOf(e).includes('Article'))) {
        const published = typeof article.datePublished === 'string' ? article.datePublished.slice(0, 10) : null;
        if (!published) continue;
        const visible = await page.evaluate(
          (day) =>
            [...document.querySelectorAll('time[datetime]')].some(
              (t) => (t.getAttribute('datetime') ?? '').startsWith(day) && t.checkVisibility() && (t.textContent ?? '').trim() !== '',
            ),
          published,
        );
        if (!visible) problems.push(`Article datePublished ${published} is not shown as a visible <time datetime>`);
      }

      expect(problems, `${pathname} structured-data quality`).toEqual([]);
    });
  }
});
