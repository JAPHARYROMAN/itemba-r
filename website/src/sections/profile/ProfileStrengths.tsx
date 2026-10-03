import { strengths } from '@/content/profile';
import { ReportHeader, ReportList, ReportSection, ReportSplit } from './ReportSection';

/**
 * §13, Competitive Strengths: the report's closing cinema tile, as the
 * reference strengths tile sets them: each strength a line on black,
 * marked with a check in gold, beside the heading.
 */
export function ProfileStrengths() {
  return (
    <ReportSection id="competitive-strengths" tone="cinema">
      <ReportSplit header={<ReportHeader id="competitive-strengths" />}>
        <ReportList items={strengths} />
      </ReportSplit>
    </ReportSection>
  );
}
