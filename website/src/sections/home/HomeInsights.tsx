import { homeInsights } from '@/content/home';
import { insightArticles } from '@/content/insights';
import { insightUrl } from '@/content/site';
import { CardLink, ChevronLink, Container, Eyebrow, Heading, Section } from '@/ui';

/**
 * 7. The insights row: the three latest guides for suppliers, buyers and
 * partners. Three across from `md`; on phones a horizontal row that snaps
 * card by card (the next card peeks in at the edge), so three stacked cards
 * do not add a screen and a half to the page. Each card is one link, so the
 * row is reachable and scrolls with the keyboard.
 */
export function HomeInsights() {
  const articles = insightArticles.slice(0, homeInsights.count);
  return (
    <Section tone="alt" labelledBy="insights-title">
      <Container>
        <div className="flex flex-col gap-6 md:flex-row md:items-end md:justify-between">
          <div className="max-w-[40rem]">
            <Eyebrow>{homeInsights.eyebrow}</Eyebrow>
            <Heading as="h2" id="insights-title" size="h1" className="mt-2">
              {homeInsights.title}
            </Heading>
          </div>
          <ChevronLink href={homeInsights.all.href} className="shrink-0">
            {homeInsights.all.label}
          </ChevronLink>
        </div>
        <ul
          role="list"
          className="-mx-gutter mt-10 flex snap-x snap-mandatory scroll-px-gutter gap-3 overflow-x-auto px-gutter pb-2 md:mx-0 md:mt-12 md:grid md:grid-cols-3 md:gap-6 md:overflow-visible md:px-0 md:pb-0"
        >
          {articles.map((article) => (
            <li key={article.slug} className="flex w-[82%] max-w-sm shrink-0 snap-start md:w-auto md:max-w-none">
              <CardLink
                href={insightUrl(article.slug)}
                eyebrow={article.eyebrow}
                title={article.displayTitle}
                description={article.summary}
                cta={homeInsights.action}
                className="w-full"
              />
            </li>
          ))}
        </ul>
      </Container>
    </Section>
  );
}
