import { attachments, attachmentsNote, profileScreenCopy } from '@/content/profile';
import { ChevronLink, keepCompounds } from '@/ui';
import { ENQUIRE_ID } from './ProfileSubNav';
import { ReportHeader, ReportList, ReportSection, ReportSplit } from './ReportSection';

/**
 * §17, Attachments: the supporting documents available on request, each
 * marked as a document (none is published here), the note on how they are
 * shared, and a link to the enquiry form to ask for them.
 */
export function ProfileAttachments() {
  return (
    <ReportSection id="attachments" tone="alt">
      <ReportSplit header={<ReportHeader id="attachments" />}>
        <ReportList items={attachments} icon="document" />
        <p className="mt-8 text-body text-fg-muted">{keepCompounds(attachmentsNote)}</p>
        <ChevronLink href={`#${ENQUIRE_ID}`} tone="gold" className="mt-6">
          {profileScreenCopy.attachments.request}
        </ChevronLink>
      </ReportSplit>
    </ReportSection>
  );
}
