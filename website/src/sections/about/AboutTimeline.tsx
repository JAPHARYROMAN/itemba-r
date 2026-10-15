import { aboutPage, type Milestone } from '@/content/about';
import { Container, Eyebrow, Heading, Lede, Section, keepCompounds } from '@/ui';

/** Current operating focus; dates appear only when the content supplies a verified date. */
export function AboutTimeline() {
  const { timeline } = aboutPage;
  const milestones: readonly Milestone[] = timeline.milestones;
  return (
    <Section tone="alt" labelledBy="timeline-title">
      <Container>
        <div className="grid items-end gap-6 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)] lg:gap-16">
          <div>
            <Eyebrow>{timeline.eyebrow}</Eyebrow>
            <Heading as="h2" id="timeline-title" size="h1" className="mt-2">
              {timeline.title}
            </Heading>
          </div>
          <Lede tone="muted" className="max-w-[40rem]">{timeline.lede}</Lede>
        </div>
        <ol role="list" className="mt-10 grid gap-8 md:mt-14 md:grid-cols-3 md:gap-10">
          {milestones.map((milestone) => (
            <li key={milestone.year} className="border-t-2 border-gold pt-6">
              <p className="text-h2 text-gold-fg">
                {milestone.dateTime ? <time dateTime={milestone.dateTime}>{milestone.year}</time> : milestone.year}
              </p>
              <Heading as="h3" size="h4" className="mt-5">{keepCompounds(milestone.title)}</Heading>
              <p className="mt-2 text-body-lg text-fg-muted">{keepCompounds(milestone.detail)}</p>
            </li>
          ))}
        </ol>
      </Container>
    </Section>
  );
}
