import { corridorOpportunity, targetMarketGroups } from '@/content/profile';
import { Card, Heading, Icon, keepCompounds } from '@/ui';
import { ReportHeader, ReportSection } from './ReportSection';

/**
 * §6, Target Market: the corridor opportunity first, as an ink card across
 * the chapter (the transit market is the group's defining audience), then
 * the four audience groups, two by two from `md`: each with the line icon of
 * the business that serves it (in its accent) and its customers as hairline
 * rows. The groups are the print profile's, so the screen and the PDF list
 * the same markets, each once.
 */
export function ProfileMarkets() {
  return (
    <ReportSection id="target-market">
      <ReportHeader id="target-market" />
      <Card tone="cinema" accent="mwanjalisi" padding="lg" className="mt-10 grid gap-6 md:mt-14 md:grid-cols-[auto_minmax(0,1fr)] md:gap-10">
        <Icon name="map-pin" size="xl" strokeWidth={1.2} className="text-accent" />
        <div>
          <Heading as="h3" size="h3">
            {corridorOpportunity.title}
          </Heading>
          <p className="mt-4 max-w-[46rem] text-body-lg text-fg-muted">{keepCompounds(corridorOpportunity.body)}</p>
        </div>
      </Card>
      <ul role="list" className="mt-4 grid gap-4 md:grid-cols-2">
        {targetMarketGroups.map((group) => (
          <Card key={group.title} as="li" accent={group.accent}>
            <Icon name={group.icon} size="lg" strokeWidth={1.4} className="text-accent" />
            <Heading as="h3" size="h4" className="mt-6">
              {group.title}
            </Heading>
            <ul role="list" className="mt-5 border-t border-line">
              {group.points.map((point) => (
                <li key={point} className="border-b border-line py-3 text-body text-fg-muted">
                  {keepCompounds(point)}
                </li>
              ))}
            </ul>
          </Card>
        ))}
      </ul>
    </ReportSection>
  );
}
