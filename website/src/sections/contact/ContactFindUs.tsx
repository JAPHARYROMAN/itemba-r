import { contact } from '@/content/contact';
import { contactPage } from '@/content/contactPage';
import { businessEnquirySubject } from '@/content/enquiry';
import { withFlags } from '@/content/flags';
import { ContactLink, Container, DirectionsLink, Eyebrow, Heading, Icon, MapFacade, Section, keepCompounds } from '@/ui';
import { contactSectionIds } from './ids';

const valueLink =
  'inline-flex min-h-11 items-center self-start break-all text-body-lg text-gold-fg decoration-1 underline-offset-4 hover:underline md:text-lede';

/** Direct contact channels beside the office address; the map stays optional and works without JavaScript. */
export function ContactFindUs() {
  const { findUs, mapTitle, contextHeading, contextCards } = contactPage;
  return (
    <Section id={contactSectionIds.findUs} labelledBy="find-us-title">
      <Container>
        <Eyebrow>{findUs.eyebrow}</Eyebrow>
        <Heading as="h2" id="find-us-title" size="h1" className="mt-2">
          {findUs.title}
        </Heading>

        <div className="mt-10 grid items-start gap-10 md:mt-14 lg:grid-cols-[minmax(0,6fr)_minmax(0,6fr)] lg:gap-16">
          <div className="border-b border-line">
            <div className="border-t border-line py-6 md:py-8">
              <Heading as="h3" size="h5" className="flex items-center gap-3">
                <Icon name="phone" size="md" className="text-accent" />{findUs.phoneLabel}
              </Heading>
              <div className="mt-3 flex flex-col items-start">
                <ContactLink kind="tel" phone={contact.primaryPhone} appearance="plain" className={valueLink}>{contact.primaryPhoneDisplay}</ContactLink>
                <ContactLink kind="tel" phone={contact.secondaryPhone} appearance="plain" className={valueLink}>{contact.secondaryPhoneDisplay}</ContactLink>
              </div>
            </div>
            <div className="border-t border-line py-6 md:py-8">
              <Heading as="h3" size="h5" className="flex items-center gap-3">
                <Icon name="whatsapp" size="md" className="text-accent" />{findUs.whatsappLabel}
              </Heading>
              <p className="mt-3 text-body-lg text-fg-muted">{contact.primaryPhoneDisplay}</p>
              <ContactLink kind="whatsapp" appearance="chevron" className="mt-3">{findUs.whatsappAction}</ContactLink>
            </div>
            <div className="border-t border-line py-6 md:py-8">
              <Heading as="h3" size="h5" className="flex items-center gap-3">
                <Icon name="mail" size="md" className="text-accent" />{findUs.emailLabel}
              </Heading>
              <ContactLink kind="mailto" subject={businessEnquirySubject} appearance="plain" className={`mt-3 ${valueLink}`}>{contact.email}</ContactLink>
            </div>
          </div>

          <div>
            <div data-tone="cinema" className="rounded-tile bg-surface p-7 md:p-10">
              <Icon name="map-pin" size="lg" strokeWidth={1.4} className="text-accent" />
              <Heading as="h3" size="h4" className="mt-5">{findUs.headOfficeLabel}</Heading>
              <address className="mt-3 text-body-lg not-italic text-fg md:text-lede">
                {contact.headOfficeLines.map((line) => <span key={line} className="block">{line}</span>)}
              </address>
              <DirectionsLink className="mt-5" />
              <div className="mt-8 border-t border-line pt-6">
                <Heading as="h3" size="h5">{findUs.postalLabel}</Heading>
                <address className="mt-2 text-body not-italic text-fg-muted">
                  {contact.postalLines.map((line) => <span key={line} className="block">{line}</span>)}
                </address>
              </div>
            </div>
          </div>
        </div>
        <MapFacade title={mapTitle} layout="bar" icon="globe" className="mt-6" />

        <div className="mt-16 border-t border-line pt-8 md:mt-20">
          <Heading as="h3" size="h3">{contextHeading}</Heading>
          <ul role="list" className="mt-6 grid gap-x-10 gap-y-2 md:grid-cols-2">
            {withFlags(contextCards).map((card) => (
              <li key={card.id} className="flex gap-4 border-t border-line py-6">
                <Icon name={card.icon} size="md" strokeWidth={1.4} className="mt-0.5 text-accent" />
                <div>
                  <h4 className="text-body-lg font-semibold text-fg">{card.title}</h4>
                  <p className="mt-1 text-body text-fg-muted">{keepCompounds(card.summary)}</p>
                </div>
              </li>
            ))}
          </ul>
        </div>
      </Container>
    </Section>
  );
}
