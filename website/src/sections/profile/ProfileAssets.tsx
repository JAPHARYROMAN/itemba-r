import { assetCapacity, assetIcons, assetsNote } from '@/content/profile';
import { Card, Heading, Icon, keepCompounds } from '@/ui';
import { ReportHeader, ReportSection } from './ReportSection';

/**
 * §10, Assets and Capacity: six capabilities, each under its line icon in
 * group gold, three across from `lg`; then the note on what is shared only
 * with authorised reviewers (capacities, values and schedules are not
 * published).
 */
export function ProfileAssets() {
  return (
    <ReportSection id="assets-capacity">
      <ReportHeader id="assets-capacity" />
      <ul role="list" className="mt-10 grid gap-4 md:mt-14 md:grid-cols-2 lg:grid-cols-3">
        {assetCapacity.map((item, index) => (
          <Card key={item.title} as="li">
            <Icon name={assetIcons[index] ?? 'trade'} size="lg" strokeWidth={1.4} className="text-accent" />
            <Heading as="h3" size="h5" className="mt-8">
              {item.title}
            </Heading>
            <p className="mt-2 text-body text-fg-muted">{keepCompounds(item.body)}</p>
          </Card>
        ))}
      </ul>
      <p className="mt-8 max-w-[46rem] text-caption text-fg-muted">{keepCompounds(assetsNote)}</p>
    </ReportSection>
  );
}
