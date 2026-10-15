import { insightArticles, insightsPage, type InsightArticle } from '@/content/insights';
import { insightUrl } from '@/content/site';
import {
  ButtonLink,
  ChevronLink,
  Container,
  CtaBand,
  Eyebrow,
  Heading,
  HeadlineText,
  PageHero,
  Section,
  SmartLink,
  keepCompounds,
} from '@/ui';
import { ArticleMeta } from './ArticleMeta';
import { InsightLeadVisual } from './InsightLeadVisual';

/**
 * The /insights hero: the page's one h1 ("Practical guides for business
 * enquiries.", the second phrase on its own line from `md`) and who the
 * guides are for. Static server HTML, no media: the featured guide below
 * carries the page's one visual.
 */
export function InsightsHero() {
  const { hero } = insightsPage;
  return (
    <PageHero
      align="start"
      eyebrow={hero.eyebrow}
      title={<HeadlineText headline={hero.headline} variant="break" />}
      titleSize="display"
      titleMeasure="wide"
      lede={hero.lede}
    />
  );
}

/**
 * The featured guide, straight under the hero on the same white (as a
 * company page's "At a glance"): its text flush left beside its lead visual
 * (a typographic panel on ink), in the home company tiles' split.
 */
export function InsightsFeatured({ article }: { article: InsightArticle }) {
  const { featured } = insightsPage;
  return (
    <Section space="none" labelledBy="featured-title" className="pb-section">
      <Container className="grid items-center gap-10 md:gap-12 lg:grid-cols-2 lg:gap-16">
        <div>
          <Eyebrow tone="gold">{featured.eyebrow}</Eyebrow>
          <Heading as="h2" id="featured-title" size="h1" className="mt-3">
            {article.displayTitle}
          </Heading>
          <p className="mt-5 max-w-[38rem] text-body-lg text-fg-muted">{keepCompounds(article.summary)}</p>
          <ArticleMeta article={article} className="mt-5" />
          <ChevronLink href={insightUrl(article.slug)} context={article.displayTitle} className="mt-7">
            {featured.action}
          </ChevronLink>
        </div>
        <InsightLeadVisual article={article} frame="feature" className="lg:justify-self-end" />
      </Container>
    </Section>
  );
}

/**
 * "Guides by need": numbered editorial rows with the guide title, date,
 * summary and a descriptive route to the full article.
 */
export function InsightsGuides({ articles }: { articles: readonly InsightArticle[] }) {
  const { more } = insightsPage;
  return (
    <Section tone="alt" labelledBy="guides-title">
      <Container>
        <div className="max-w-[40rem]">
          <Eyebrow>{more.eyebrow}</Eyebrow>
          <Heading as="h2" id="guides-title" size="h1" className="mt-2">
            {more.title}
          </Heading>
        </div>
        <ul role="list" className="mt-10 border-b border-line md:mt-14">
          {articles.map((article, index) => (
            <li key={article.slug} className="grid gap-4 border-t border-line py-7 md:grid-cols-[3rem_minmax(0,5fr)_minmax(0,7fr)] md:gap-8 md:py-10">
              <span aria-hidden="true" className="text-h3 tabular-nums text-gold-fg">{String(index + 2).padStart(2, '0')}</span>
              <div>
                <Eyebrow>{article.eyebrow}</Eyebrow>
                <Heading as="h3" size="h3" className="mt-3">
                  <SmartLink href={insightUrl(article.slug)} className="decoration-1 underline-offset-4 hover:underline">{article.displayTitle}</SmartLink>
                </Heading>
                <ArticleMeta article={article} className="mt-4" />
              </div>
              <div>
                <p className="text-body-lg text-fg-muted">{keepCompounds(article.summary)}</p>
                <ChevronLink href={insightUrl(article.slug)} context={article.displayTitle} className="mt-5">{more.action}</ChevronLink>
              </div>
            </li>
          ))}
        </ul>
      </Container>
    </Section>
  );
}

/**
 * "Need a direct route?": the closing band, on white above the grey
 * footer, for an enquiry that spans more than one company: the capability
 * map as the pill, partnerships and the logistics guide as chevron links.
 */
export function InsightsDirectRoute() {
  const { directRoute } = insightsPage;
  const [primary, ...rest] = directRoute.links;
  return (
    <CtaBand
      titleId="direct-route-title"
      title={directRoute.title}
      lede={directRoute.body}
      tone="light"
      actions={
        <>
          {primary ? (
            <ButtonLink href={primary.href} size="lg">
              {primary.label}
            </ButtonLink>
          ) : null}
          {rest.map((link) => (
            <ChevronLink key={link.href} href={link.href} size="body-lg">
              {link.label}
            </ChevronLink>
          ))}
        </>
      }
    />
  );
}

/** The featured guide first (the newest by list order), then the rest. */
export function insightsOrder(): { featured: InsightArticle; rest: InsightArticle[] } {
  const [featured, ...rest] = insightArticles;
  if (!featured) throw new Error('insights: no articles');
  return { featured, rest };
}
