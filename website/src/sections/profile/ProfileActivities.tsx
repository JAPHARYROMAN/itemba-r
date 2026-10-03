import { businessActivities, profileScreenCopy } from '@/content/profile';
import { Card, Eyebrow, Heading, keepCompounds } from '@/ui';
import { ReportHeader, ReportSection } from './ReportSection';

type Activity = (typeof businessActivities)[number];

/** Hairline rows: Westsides' three divisions (numbered), or a company's lines of business. */
function ActivityDetail({ activity }: { activity: Activity }) {
  if ('divisions' in activity) {
    return (
      <ol role="list" className="mt-6 border-t border-line">
        {activity.divisions.map((division, index) => (
          <li key={division.name} className="border-b border-line py-4">
            <p className="text-caption text-fg-muted">
              {profileScreenCopy.divisionLabel} {index + 1}
            </p>
            <h4 className="mt-0.5 text-body font-semibold text-fg">{keepCompounds(division.name)}</h4>
            <p className="mt-1 text-body text-fg-muted">{keepCompounds(division.detail)}</p>
          </li>
        ))}
      </ol>
    );
  }
  return (
    <ul role="list" className="mt-6 border-t border-line">
      {activity.points.map((point) => (
        <li key={point} className="border-b border-line py-3 text-body text-fg">
          {keepCompounds(point)}
        </li>
      ))}
    </ul>
  );
}

/**
 * §4, Business Activities: one card per company, in public order, each
 * with the company (its accent dot), what it does and its lines of
 * business; Westsides lists its three divisions. Three across from `lg`.
 */
export function ProfileActivities() {
  return (
    <ReportSection id="business-activities">
      <ReportHeader id="business-activities" />
      <ul role="list" className="mt-10 grid gap-4 md:mt-14 lg:grid-cols-3">
        {businessActivities.map((activity) => (
          <Card key={activity.company} as="li" accent={activity.companyId} className="flex flex-col">
            <Eyebrow dot tone="muted">
              {activity.company}
            </Eyebrow>
            <Heading as="h3" size="h4" className="mt-3">
              {activity.title}
            </Heading>
            <p className="mt-3 text-body text-fg-muted">{keepCompounds(activity.summary)}</p>
            <ActivityDetail activity={activity} />
          </Card>
        ))}
      </ul>
    </ReportSection>
  );
}
