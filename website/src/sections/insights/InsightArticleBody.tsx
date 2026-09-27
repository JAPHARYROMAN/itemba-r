import { Fragment } from 'react';
import { insightPageCopy, type InsightArticle } from '@/content/insights';
import { Chip, ChipList, Container, Eyebrow, Heading, Lede, Prose, Section, keepCompounds } from '@/ui';
import { ArticleMeta } from './ArticleMeta';
import { InsightLeadVisual } from './InsightLeadVisual';

/**
 * The article itself, as Apple's newsroom sets a story: everything in one
 * 680px reading column, flush left and centred on the page.
 * - The header: the guide's category, its title (the page's one h1, in the
 *   site's sentence case), the summary as the lede and the date line (the
 *   visible <time> the Article JSON-LD dates must match).
 * - The lead visual: a strong photograph with its caption, or a
 *   typographic panel on ink where no strong photograph exists.
 * - The body: 19px prose, each section an h2 with its paragraph and points.
 * - The foot: who the guide is written for.
 * Static server HTML: nothing here fades in, and nothing is hidden before
 * paint.
 */
export function InsightArticleBody({ article }: { article: InsightArticle }) {
  return (
    <Section as="article" labelledBy="page-title" space="none" className="pb-section pt-10 md:pt-14">
      <Container size="measure">
        <header>
          <Eyebrow>{article.eyebrow}</Eyebrow>
          <Heading as="h1" id="page-title" size="h1" className="mt-3">
            {article.displayTitle}
          </Heading>
          <Lede className="mt-5 max-md:text-body-lg md:mt-6">
            {article.summary}
          </Lede>
          <ArticleMeta article={article} className="mt-6 border-t border-line pt-5 md:mt-8" />
        </header>

        <InsightLeadVisual article={article} frame="article" className="mt-10 md:mt-12" />

        <Prose className="mt-12 md:mt-16">
          {article.sections.map((section) => (
            <Fragment key={section.heading}>
              <h2>{keepCompounds(section.heading)}</h2>
              <p>{keepCompounds(section.body)}</p>
              {section.points?.length ? (
                <ul>
                  {section.points.map((point) => (
                    <li key={point}>{keepCompounds(point)}</li>
                  ))}
                </ul>
              ) : null}
            </Fragment>
          ))}
        </Prose>

        <footer className="mt-14 border-t border-line pt-6 md:mt-16">
          <p className="text-eyebrow text-fg-muted">{insightPageCopy.meta.audience}</p>
          <ChipList className="mt-3">
            {article.audience.map((audience) => (
              <Chip key={audience} as="li">
                {audience}
              </Chip>
            ))}
          </ChipList>
        </footer>
      </Container>
    </Section>
  );
}
