import { contact } from '@/content/contact';
import { enquiryPrompts } from '@/content/enquiry';
import { profileScreenCopy } from '@/content/profile';
import EnquiryRouter from '@/islands/EnquiryRouter';
import { ContactLink, FactList, Heading, cn } from '@/ui';
import { ENQUIRE_ID } from './ProfileSubNav';
import { ReportHeader, ReportSection, ReportSplit } from './ReportSection';

const link = 'text-gold-fg decoration-1 underline-offset-4 hover:underline';

/** Address lines, one per line. */
function Lines({ lines }: { lines: readonly string[] }) {
  return (
    <>
      {lines.map((line) => (
        <span key={line} className="block">
          {line}
        </span>
      ))}
    </>
  );
}

/**
 * §16, Contact Information: the group office's address, postal box, phone
 * lines and inbox under the heading (every href from src/content/contact.ts,
 * in the forms ConversionTracker classifies), and the compact enquiry form
 * beside them, the target of every Enquire action on the page (#enquire).
 * The form is print-hidden, as on origin/main.
 */
export function ProfileContact() {
  const labels = profileScreenCopy.contact;
  return (
    <ReportSection id="contact-information">
      <ReportSplit
        header={
          <ReportHeader id="contact-information">
            <Heading as="h3" size="h5" className="mt-10">
              {labels.heading}
            </Heading>
            <FactList
              className="mt-4"
              items={[
                { key: 'office', term: labels.headOffice, detail: <Lines lines={contact.headOfficeLines} /> },
                { key: 'postal', term: labels.postal, detail: <Lines lines={contact.postalLines} /> },
                {
                  key: 'phone',
                  term: labels.phone,
                  detail: (
                    <>
                      <ContactLink kind="tel" phone={contact.primaryPhone} appearance="plain" className={cn('block w-fit', link)}>
                        {contact.primaryPhoneDisplay}
                      </ContactLink>
                      <ContactLink kind="tel" phone={contact.secondaryPhone} appearance="plain" className={cn('block w-fit', link)}>
                        {contact.secondaryPhoneDisplay}
                      </ContactLink>
                    </>
                  ),
                },
                {
                  key: 'email',
                  term: labels.email,
                  detail: (
                    <ContactLink kind="mailto" appearance="plain" className={cn('break-all', link)}>
                      {contact.email}
                    </ContactLink>
                  ),
                },
              ]}
            />
          </ReportHeader>
        }
      >
        <div id={ENQUIRE_ID}>
          <EnquiryRouter
            compact
            headingLevel={3}
            title={enquiryPrompts.companyProfile.title}
            description={enquiryPrompts.companyProfile.description}
            className="print-hidden"
          />
        </div>
      </ReportSplit>
    </ReportSection>
  );
}
