import type { ReactNode } from 'react';
import { contact } from '@/content/contact';
import { contactPage } from '@/content/contactPage';
import { businessEnquirySubject } from '@/content/enquiry';
import { withFlags } from '@/content/flags';
import { Bento, BentoCell, ContactLink, Container, Eyebrow, Heading, Icon, Section, keepCompounds, type BentoSpan, type IconName } from '@/ui';
import { DirectionsLink } from '@/sections/locations/DirectionsLink';
import { MapFacade } from '@/sections/locations/MapFacade';
import { contactSectionIds } from './ids';

/** A contact card: its line icon, what it is, then the way to use it. */
function ContactCard({ icon, title, span = 'third', children }: { icon: IconName; title: string; span?: BentoSpan; children: ReactNode }) {
  return (
    <BentoCell span={span}>
      <Icon name={icon} size="lg" strokeWidth={1.4} className="text-accent" />
      <Heading as="h3" size="h4" className="mt-5 md:mt-8">
        {title}
      </Heading>
      <div className="mt-2 flex flex-1 flex-col">{children}</div>
    </BentoCell>
  );
}

/** A phone number or the email address as a plain link, 44px tall. */
const valueLink =
  'inline-flex min-h-11 items-center self-start break-all text-body-lg text-accent-fg decoration-1 underline-offset-4 hover:underline';

/**
 * "Group headquarters": the contact cards, as a bento on the six-column
 * grid (lg): phone · WhatsApp · email (a third each), then the head office
 * with its directions link and the postal address (half each), then the
 * map facade across the row, a slim bar until it is opened.
 * Every number, address and href comes from src/content/contact.ts (the
 * tel:, wa.me/ and mailto: forms ConversionTracker classifies). Under it,
 * why the group is based at Mpemba-Tunduma; the unsourced growth claim
 * stays out (flags.songweGrowthClaim).
 */
export function ContactFindUs() {
  const { findUs, mapTitle, contextHeading, contextCards } = contactPage;
  return (
    <Section id={contactSectionIds.findUs} labelledBy="find-us-title">
      <Container>
        <Eyebrow>{findUs.eyebrow}</Eyebrow>
        <Heading as="h2" id="find-us-title" size="h1" className="mt-2">
          {findUs.title}
        </Heading>

        <Bento className="mt-10 md:mt-14">
          <ContactCard icon="phone" title={findUs.phoneLabel}>
            <ContactLink kind="tel" phone={contact.primaryPhone} appearance="plain" className={valueLink}>
              {contact.primaryPhoneDisplay}
            </ContactLink>
            <ContactLink kind="tel" phone={contact.secondaryPhone} appearance="plain" className={valueLink}>
              {contact.secondaryPhoneDisplay}
            </ContactLink>
          </ContactCard>

          <ContactCard icon="whatsapp" title={findUs.whatsappLabel}>
            <p className="text-body text-fg-muted">{contact.primaryPhoneDisplay}</p>
            <ContactLink kind="whatsapp" appearance="chevron" className="mt-auto self-start pt-4">
              {findUs.whatsappAction}
            </ContactLink>
          </ContactCard>

          <ContactCard icon="mail" title={findUs.emailLabel}>
            <ContactLink kind="mailto" subject={businessEnquirySubject} appearance="plain" className={valueLink}>
              {contact.email}
            </ContactLink>
          </ContactCard>

          <ContactCard icon="map-pin" title={findUs.headOfficeLabel} span="half">
            <address className="text-body-lg not-italic text-fg">
              {contact.headOfficeLines.map((line) => (
                <span key={line} className="block">
                  {line}
                </span>
              ))}
            </address>
            <DirectionsLink className="mt-auto self-start pt-5" />
          </ContactCard>

          <ContactCard icon="document" title={findUs.postalLabel} span="half">
            <address className="text-body-lg not-italic text-fg">
              {contact.postalLines.map((line) => (
                <span key={line} className="block">
                  {line}
                </span>
              ))}
            </address>
          </ContactCard>

          <MapFacade title={mapTitle} layout="bar" icon="globe" className="md:col-span-6" />
        </Bento>

        <div className="mt-16 md:mt-20">
          <Heading as="h3" size="h3">
            {contextHeading}
          </Heading>
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
