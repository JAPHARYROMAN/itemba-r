import { aboutPage } from '@/content/about';
import { Container, Eyebrow, Heading, Lede, Section, cn, keepCompounds } from '@/ui';

/**
 * The milestones strip, 2012 to 2025, oldest first (the history's own
 * order, with 2017's three entries kept in date order). From `xl` it runs
 * as one horizontal strip across the wide container: a hairline joins the
 * gold dots, each year set large above what happened. Below `xl`, where
 * seven columns would be too narrow to read, the same list stands
 * vertically beside a rail. A real ordered list with <time> elements; the
 * rail and the dots are decorative.
 */
export function AboutTimeline() {
  const { timeline } = aboutPage;
  const last = timeline.milestones.length - 1;
  return (
    <Section tone="alt" labelledBy="timeline-title">
      <Container>
        <div className="mx-auto max-w-prose text-center">
          <Eyebrow>{timeline.eyebrow}</Eyebrow>
          <Heading as="h2" id="timeline-title" size="h1" className="mt-2">
            {timeline.title}
          </Heading>
          <Lede tone="muted" className="mx-auto mt-5 max-w-[40rem] md:mt-6">
            {timeline.lede}
          </Lede>
        </div>
      </Container>

      <Container size="wide" className="mt-12 md:mt-16">
        <ol role="list" className="mx-auto max-w-xl xl:grid xl:max-w-[77.5rem] xl:grid-cols-7 xl:gap-4">
          {timeline.milestones.map((milestone, index) => (
            <li key={milestone.year} className={cn('relative pl-9 xl:pl-0 xl:pr-2 xl:pt-10', index !== last && 'pb-10 xl:pb-0')}>
              {index !== last ? (
                <span
                  aria-hidden="true"
                  className="absolute left-[5px] top-2 h-full w-px bg-line-strong/50 xl:left-0 xl:top-[5px] xl:h-px xl:w-[calc(100%+1rem)]"
                />
              ) : null}
              <span
                aria-hidden="true"
                className="absolute left-0 top-1.5 size-[11px] rounded-full bg-gold ring-4 ring-surface xl:top-0"
              />
              <p className="text-h3 tabular-nums text-fg">
                <time dateTime={milestone.dateTime}>{milestone.year}</time>
              </p>
              <p className="mt-2 text-body font-semibold text-fg xl:mt-3">{keepCompounds(milestone.title)}</p>
              <p className="mt-1 text-body text-fg-muted xl:text-caption">{keepCompounds(milestone.detail)}</p>
            </li>
          ))}
        </ol>
      </Container>
    </Section>
  );
}
