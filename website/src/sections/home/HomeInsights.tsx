import { homeInsights } from '@/content/home';
import { insightArticles } from '@/content/insights';
import { insightUrl } from '@/content/site';
import { CardLink, ChevronLink, Container, Eyebrow, Grid, Heading, Section } from '@/ui';

/** 7. The insights row: the three latest guides for suppliers, buyers and partners. */
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
        <Grid cols={3} className="mt-10 md:mt-12">
          {articles.map((article) => (
            <CardLink
              key={article.slug}
              href={insightUrl(article.slug)}
              eyebrow={article.eyebrow}
              title={article.displayTitle}
              description={article.summary}
              cta={homeInsights.action}
            />
          ))}
        </Grid>
      </Container>
    </Section>
  );
}
