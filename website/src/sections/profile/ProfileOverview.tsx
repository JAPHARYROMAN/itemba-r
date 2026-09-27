import { contact } from '@/content/contact';
import { overviewFacts, overviewParagraphs } from '@/content/profile';
import { ContactLink, FactList, keepCompounds } from '@/ui';
import { ReportHeader, ReportSection, ReportSplit } from './ReportSection';

/**
 * §2, Company Overview: the group in two paragraphs (the first set as the
 * chapter's lead), then its type, location and public contact as a quiet
 * fact list. The public contact is the group inbox, as a mailto: link.
 */
export function ProfileOverview() {
  const [first, ...rest] = overviewParagraphs;
  return (
    <ReportSection id="company-overview">
      <ReportSplit header={<ReportHeader id="company-overview" />}>
        {first ? <p className="text-lede text-fg">{keepCompounds(first)}</p> : null}
        {rest.map((paragraph) => (
          <p key={paragraph} className="mt-6 text-body-lg text-fg-muted">
            {keepCompounds(paragraph)}
          </p>
        ))}
        <FactList
          className="mt-10"
          items={overviewFacts.map((fact) => ({
            key: fact.label,
            term: fact.label,
            detail:
              fact.value === contact.email ? (
                <ContactLink kind="mailto" appearance="plain" className="break-all text-gold-fg hover:underline">
                  {fact.value}
                </ContactLink>
              ) : (
                keepCompounds(fact.value)
              ),
          }))}
        />
      </ReportSplit>
    </ReportSection>
  );
}
