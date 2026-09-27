/**
 * Page group P4: /insights, the four insight articles and /faq, rendered
 * with react-dom/server (server components; next/navigation's usePathname
 * is mocked for the EnquiryRouter island). Markup contracts:
 *
 * - /insights: its metadata, one h1, every guide linked (the featured one
 *   beside its lead visual), the Blog JSON-LD with all four posts under
 *   the baseline @id, no enquiry form, and the visible trail.
 * - Articles: exactly the four slugs; article metadata with its dates and
 *   keywords; the display title as the one h1; the publication date as a
 *   visible <time datetime> matching the Article JSON-LD (which carries an
 *   image); a 680px reading column; the lead visual (a photograph, or a
 *   typographic panel where no strong one exists); the compact form on
 *   General in #enquire; a general enquiry never sent to /partnerships;
 *   the trail matching its BreadcrumbList.
 * - /faq: the twelve topic anchors in order, 34 disclosure rows and a
 *   FAQPage with exactly those 34 questions, the CollectionPage (@id
 *   /faq#faq) of the twelve topics, every topic link landing, the compact
 *   form on General, and the flag-resolved group answers.
 * - None of them renders anything at opacity 0 or mentions manufacturing.
 */
import { createElement as h } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { enquiryPrompts } from '@/content/enquiry';
import { faqPage, faqSections, groupFaqs } from '@/content/faqs';
import { flags } from '@/content/flags';
import { insightArticles, insightsPage, isLeadPhoto, type InsightArticle } from '@/content/insights';
import { getMedia } from '@/content/media';
import { absoluteUrl, site } from '@/content/site';
import { headlineText } from '@/content/types';
import { formatDate } from '@/sections/insights/ArticleMeta';

vi.mock('next/navigation', async (importOriginal) => ({
  ...(await importOriginal<typeof import('next/navigation')>()),
  usePathname: () => '/insights',
}));

const IndexModule = await import('@/app/insights/page');
const ArticleModule = await import('@/app/insights/[slug]/page');
const FaqModule = await import('@/app/faq/page');

const decode = (s: string) =>
  s.replace(/&amp;/g, '&').replace(/&#x27;/g, "'").replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>');
const textOf = (html: string) => decode(html.replace(/<[^>]*>/g, '')).replace(/\s+/g, ' ').trim();
const tags = (html: string, tag: string) => [...html.matchAll(new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)</${tag}>`, 'g'))].map((m) => textOf(m[1] ?? ''));
const hrefs = (html: string) => [...html.matchAll(/href="([^"]*)"/g)].map((m) => decode(m[1] ?? ''));
const ids = (html: string) => new Set([...html.matchAll(/\sid="([^"]*)"/g)].map((m) => m[1] ?? ''));
const jsonLd = (html: string) =>
  [...html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)].flatMap((m) => {
    const data = JSON.parse(m[1] ?? 'null') as unknown;
    return (Array.isArray(data) ? data : [data]) as Array<Record<string, unknown>>;
  });
const photos = (html: string) =>
  [...html.matchAll(/<img\b[^>]*\ssrc="([^"]*)"/g)]
    .map((m) => {
      const src = decode(m[1] ?? '');
      return src.startsWith('/_next/image') ? (new URL(src, 'http://x').searchParams.get('url') ?? '') : src;
    })
    .filter((src) => src.startsWith('/images/'));
const withoutScripts = (html: string) => html.replace(/<script\b[\s\S]*?<\/script>/g, '');
const ORG_ID = `${absoluteUrl('/')}#organization`;

/** The visible trail's names, and the BreadcrumbList's, for a page. */
function trails(html: string) {
  const trail = html.match(/<nav aria-label="Breadcrumb"[\s\S]*?<\/nav>/)?.[0] ?? '';
  const crumbs = jsonLd(html).filter((e) => e['@type'] === 'BreadcrumbList');
  const names = ((crumbs[0]?.itemListElement ?? []) as Array<{ name: string }>).map((item) => item.name);
  return { visible: tags(trail, 'li'), ld: names, count: crumbs.length };
}

function commonChecks(html: string) {
  expect(html).not.toMatch(/opacity:\s*0(?![.\d])/);
  expect(textOf(withoutScripts(html))).not.toMatch(/manufactur/i);
  expect(html.match(/<h1\b/g)).toHaveLength(1);
  // Only photographs may fade up: no text in a data-reveal block.
  for (const block of html.matchAll(/<div data-reveal=""[^>]*>([\s\S]*?)<\/div>/g)) {
    expect(textOf(block[1] ?? '')).toBe('');
  }
}

describe('/insights', () => {
  const html = renderToStaticMarkup(h(IndexModule.default));
  const text = textOf(withoutScripts(html));

  it('keeps its metadata', () => {
    const { metadata } = IndexModule;
    expect(metadata.title).toBe(insightsPage.meta.title);
    expect(metadata.description).toBe(insightsPage.meta.description);
    expect(metadata.alternates?.canonical).toBe(absoluteUrl('/insights'));
    expect(metadata.openGraph).toMatchObject({
      title: insightsPage.meta.ogTitle,
      description: insightsPage.meta.ogDescription,
      url: absoluteUrl('/insights'),
    });
    expect(metadata.twitter).toEqual({ card: 'summary_large_image' });
  });

  it('has one h1, the lead line, and links every guide', () => {
    expect(tags(html, 'h1')).toEqual([headlineText(insightsPage.hero.headline)]);
    for (const article of insightArticles) expect(hrefs(html), article.slug).toContain(`/insights/${article.slug}`);
    // The featured guide: its title as a chapter heading, beside its lead visual, with its date.
    const featured = insightArticles[0]!;
    expect(tags(html, 'h2')).toContain(featured.displayTitle);
    expect(html).toContain(`<time dateTime="${featured.publishedAt}">${formatDate(featured.publishedAt)}</time>`);
    if (!isLeadPhoto(featured.lead) && featured.lead.kind === 'type') expect(text).toContain(featured.lead.statement);
    expect(text).toContain(insightsPage.more.title);
    expect(text).toContain(insightsPage.directRoute.title);
  });

  it('has no enquiry form (the quick-contact bar serves phones)', () => {
    expect(html).not.toContain('data-enquiry-router');
  });

  it('publishes the Blog with every guide under the baseline @id, and the visible trail', () => {
    const blog = jsonLd(html).find((e) => e['@type'] === 'Blog');
    expect(blog?.['@id']).toBe(`${absoluteUrl('/insights')}#insights`);
    expect(blog?.publisher).toEqual({ '@id': ORG_ID });
    const posts = blog?.blogPost as Array<Record<string, unknown>>;
    expect(posts.map((p) => p.url)).toEqual(insightArticles.map((a) => absoluteUrl(`/insights/${a.slug}`)));
    expect(posts.map((p) => p.datePublished)).toEqual(insightArticles.map((a) => a.publishedAt));
    for (const post of posts) expect(post['@type']).toBe('BlogPosting');
    const trail = trails(html);
    expect(trail.count).toBe(1);
    expect(trail.ld).toEqual(['Home', 'Insights']);
    expect(trail.visible).toEqual(trail.ld);
  });

  it('renders nothing hidden and never mentions manufacturing', () => commonChecks(html));
});

async function renderArticle(article: InsightArticle) {
  return renderToStaticMarkup(await ArticleModule.default({ params: Promise.resolve({ slug: article.slug }) }));
}

describe('insight articles', () => {
  it('exist for exactly the four guides, and no other slug', async () => {
    expect(ArticleModule.dynamicParams).toBe(false);
    expect(ArticleModule.generateStaticParams()).toEqual(insightArticles.map((a) => ({ slug: a.slug })));
    await expect(ArticleModule.default({ params: Promise.resolve({ slug: 'unknown' }) })).rejects.toThrow();
  });

  it.each(insightArticles.map((a) => [a.slug, a] as const))('%s: metadata', async (_slug, article) => {
    const metadata = await ArticleModule.generateMetadata({ params: Promise.resolve({ slug: article.slug }) });
    expect(metadata.title).toBe(article.title);
    expect(metadata.description).toBe(article.metaDescription);
    expect(metadata.keywords).toEqual(article.keywords);
    expect(metadata.alternates?.canonical).toBe(absoluteUrl(`/insights/${article.slug}`));
    expect(metadata.openGraph).toMatchObject({
      type: 'article',
      title: `${article.title} | ${site.name}`,
      description: article.metaDescription,
      publishedTime: article.publishedAt,
      modifiedTime: article.updatedAt,
    });
  });

  it.each(insightArticles.map((a) => [a.slug, a] as const))('%s: page', async (_slug, article) => {
    const html = await renderArticle(article);
    const text = textOf(withoutScripts(html));
    const pageIds = ids(html);

    // One h1 (the display title), in the 680px reading column, with the summary and every section.
    expect(tags(html, 'h1')).toEqual([article.displayTitle]);
    const body = html.match(/<article[^>]*aria-labelledby="page-title"[\s\S]*?<\/article>/)?.[0] ?? '';
    expect(body).toContain('max-w-measure');
    expect(textOf(body)).toContain(article.summary);
    for (const section of article.sections) {
      expect(tags(body, 'h2')).toContain(section.heading);
      expect(textOf(body)).toContain(section.body);
      for (const point of section.points ?? []) expect(tags(body, 'li')).toContain(point);
    }
    for (const audience of article.audience) expect(tags(body, 'li')).toContain(audience);

    // The date the Article JSON-LD publishes is on the page, in a <time datetime>.
    expect(html).toContain(`<time dateTime="${article.publishedAt}">${formatDate(article.publishedAt)}</time>`);
    const ld = jsonLd(html).find((e) => e['@type'] === 'Article');
    expect(ld?.['@id']).toBe(`${absoluteUrl(`/insights/${article.slug}`)}#article`);
    expect(ld?.datePublished).toBe(article.publishedAt);
    expect(ld?.image).toBe(absoluteUrl(`/insights/${article.slug}/opengraph-image`));
    expect(ld?.author).toEqual({ '@id': ORG_ID });

    // The lead visual: one photograph with its caption, or a typographic panel.
    const shown = photos(html);
    const lead = article.lead;
    if (isLeadPhoto(lead)) {
      expect(shown).toEqual([lead.src]);
      expect(getMedia(lead.media).width, 'a sharp master for the 680px column').toBeGreaterThanOrEqual(1280);
      if (lead.caption) expect(text).toContain(lead.caption);
    } else {
      expect(shown).toEqual([]);
      expect(body).toContain('data-type-panel=""');
      const statement = lead.kind === 'lineup' ? headlineText(lead.statement) : lead.statement;
      expect(textOf(body)).toContain(statement);
    }

    // The compact form, on General, in #enquire; the article's pill lands on the page or its own route.
    expect(html.match(/data-enquiry-router=""/g)).toHaveLength(1);
    expect(html).toContain('data-default-intent="general"');
    expect(pageIds).toContain('enquire');
    expect(tags(html, 'h2')).toContain(enquiryPrompts.insightArticle.title);
    if (article.cta.href.startsWith('#')) expect(pageIds).toContain(article.cta.href.slice(1));
    expect(hrefs(html)).toContain(article.cta.href);
    expect(hrefs(html)).toContain('/insights');

    // Related pages: every service, company and place the guide names.
    for (const slug of article.serviceSlugs) expect(hrefs(html)).toContain(`/services/${slug}`);
    for (const slug of article.companySlugs) expect(hrefs(html)).toContain(`/companies/${slug}`);
    for (const slug of article.locationSlugs) expect(hrefs(html)).toContain(`/locations/${slug}`);

    const trail = trails(html);
    expect(trail.count).toBe(1);
    expect(trail.ld).toEqual(['Home', 'Insights', article.displayTitle]);
    expect(trail.visible).toEqual(trail.ld);

    commonChecks(html);
  });

  it('sends a general enquiry to the page form, never to /partnerships (C0)', () => {
    const routing = insightArticles.find((a) => a.slug === 'route-business-enquiry-itemba-group')!;
    expect(routing.cta).toEqual({ label: 'Route an enquiry', href: '#enquire' });
  });

  it('never repeats the retired lead frames', () => {
    for (const article of insightArticles) {
      if (isLeadPhoto(article.lead)) expect(['mpemba-coach-canopy', 'westsides-beer-delivery']).not.toContain(article.lead.media);
    }
  });
});

describe('/faq', () => {
  const html = renderToStaticMarkup(h(FaqModule.default));
  const sections = faqSections();
  const pageIds = ids(html);

  it('keeps its metadata', () => {
    const { metadata } = FaqModule;
    expect(metadata.title).toBe(faqPage.meta.title);
    expect(metadata.description).toBe(faqPage.meta.description);
    expect(metadata.alternates?.canonical).toBe(absoluteUrl('/faq'));
    expect(metadata.openGraph).toMatchObject({ title: faqPage.meta.ogTitle, description: faqPage.meta.ogDescription });
  });

  it('keeps the twelve topic anchors, in order, and every topic link lands', () => {
    const order = [...html.matchAll(/<div id="([^"]+)" role="group"/g)].map((m) => m[1]);
    expect(order).toEqual(sections.map((s) => s.id));
    expect(order).toHaveLength(12);
    for (const href of hrefs(html).filter((href) => href.startsWith('#') && href !== '#main-content')) {
      expect(pageIds, href).toContain(href.slice(1));
    }
    for (const section of sections) expect(hrefs(html)).toContain(`#${section.id}`);
  });

  it('shows 34 questions as disclosure rows, and the FAQPage lists exactly those', () => {
    expect(html.match(/<details\b/g)).toHaveLength(34);
    const shown = tags(html, 'h4');
    const faq = jsonLd(html).find((e) => e['@type'] === 'FAQPage');
    const questions = (faq?.mainEntity as Array<{ name: string }>).map((q) => q.name);
    expect(questions).toHaveLength(34);
    expect(shown).toEqual(questions);
  });

  it('uses the flag-resolved group answers (no manufacturing)', () => {
    expect(flags.mentionManufacturing).toBe(false);
    for (const faq of groupFaqs) expect(textOf(html)).toContain(faq.answer);
  });

  it('publishes the CollectionPage of the twelve topics under the baseline @id', () => {
    const page = jsonLd(html).find((e) => e['@type'] === 'CollectionPage');
    expect(page?.['@id']).toBe(`${absoluteUrl('/faq')}#faq`);
    const items = (page?.mainEntity as { itemListElement: Array<{ url: string; name: string }> }).itemListElement;
    expect(items.map((i) => i.url)).toEqual(sections.map((s) => `${absoluteUrl('/faq')}#${s.id}`));
  });

  it('has the compact form on General in #enquire, and the visible trail', () => {
    expect(html.match(/data-enquiry-router=""/g)).toHaveLength(1);
    expect(html).toContain('data-default-intent="general"');
    expect(pageIds).toContain('enquire');
    expect(tags(html, 'h2')).toContain(enquiryPrompts.faq.title);
    const trail = trails(html);
    expect(trail.count).toBe(1);
    expect(trail.ld).toEqual(['Home', faqPage.crumb]);
    expect(trail.visible).toEqual(trail.ld);
  });

  it('renders nothing hidden and never mentions manufacturing', () => commonChecks(html));
});
