import { futurePlans } from '@/content/profile';
import { ReportHeader, ReportList, ReportSection, ReportSplit } from './ReportSection';

/** §14, Future Plans: where the group is going, as rows marked with a forward arrow (plans, not claims). */
export function ProfileFuturePlans() {
  return (
    <ReportSection id="future-plans">
      <ReportSplit header={<ReportHeader id="future-plans" />}>
        <ReportList items={futurePlans} icon="arrow-right" />
      </ReportSplit>
    </ReportSection>
  );
}
