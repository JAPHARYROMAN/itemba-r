import { complianceItems } from '@/content/profile';
import { ReportHeader, ReportList, ReportSection, ReportSplit } from './ReportSection';

/** §12, Compliance Information: how records and statutory documents are kept, as checked rows. */
export function ProfileCompliance() {
  return (
    <ReportSection id="compliance-information">
      <ReportSplit header={<ReportHeader id="compliance-information" />}>
        <ReportList items={complianceItems} />
      </ReportSplit>
    </ReportSection>
  );
}
