import { financialOverview } from '@/content/profile';
import { keepCompounds } from '@/ui';
import { ReportHeader, ReportSection, ReportSplit } from './ReportSection';

/**
 * §11, Financial Overview: why no figures are published, and how
 * authorised reviewers receive the statements. No numbers are shown.
 */
export function ProfileFinancial() {
  const [first, ...rest] = financialOverview;
  return (
    <ReportSection id="financial-overview" tone="alt">
      <ReportSplit header={<ReportHeader id="financial-overview" />}>
        <p className="text-lede text-fg">{keepCompounds(first)}</p>
        {rest.map((paragraph) => (
          <p key={paragraph} className="mt-6 text-body-lg text-fg-muted">
            {keepCompounds(paragraph)}
          </p>
        ))}
      </ReportSplit>
    </ReportSection>
  );
}
