import { bankingPurposes } from '@/content/profile';
import { Card, keepCompounds } from '@/ui';
import { ReportHeader, ReportSection, ReportSplit } from './ReportSection';

/**
 * §15, Purpose of Banking Relationship: the four reasons the group seeks
 * formal banking support, the chapter a bank reads first, as numbered
 * cards two by two from `sm` (white on the grey tile).
 */
export function ProfileBanking() {
  return (
    <ReportSection id="banking-purpose" tone="alt">
      <ReportSplit header={<ReportHeader id="banking-purpose" />}>
        <ol role="list" className="grid gap-4 sm:grid-cols-2">
          {bankingPurposes.map((purpose, index) => (
            <Card key={purpose} as="li" className="flex flex-col">
              <span aria-hidden="true" className="text-h3 tabular-nums text-gold-fg">
                {String(index + 1).padStart(2, '0')}
              </span>
              <p className="mt-6 text-body text-fg">{keepCompounds(purpose)}</p>
            </Card>
          ))}
        </ol>
      </ReportSplit>
    </ReportSection>
  );
}
