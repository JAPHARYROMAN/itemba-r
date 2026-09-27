import { contactActionLabels } from '@/content/contact';
import { locationsPage } from '@/content/locations';
import { ButtonLink, ContactLink, CtaBand } from '@/ui';

/**
 * The index's closing call to action, as home's: the Enquire pill to the
 * general enquiry form on /contact, then WhatsApp and Call. The contact
 * hrefs come from src/content/contact.ts in the forms ConversionTracker
 * classifies. White, so it stands apart from the grey footer below.
 */
export function LocationsClosing() {
  const { closing } = locationsPage;
  return (
    <CtaBand
      titleId="closing-title"
      title={closing.title}
      lede={closing.body}
      tone="light"
      actions={
        <>
          <ButtonLink href={closing.enquire.href} size="lg">
            {closing.enquire.label}
          </ButtonLink>
          <ContactLink kind="whatsapp" appearance="chevron" size="lg" aria-label={contactActionLabels.whatsapp}>
            {closing.whatsapp}
          </ContactLink>
          <ContactLink kind="tel" appearance="chevron" size="lg" aria-label={contactActionLabels.call}>
            {closing.call}
          </ContactLink>
        </>
      }
    />
  );
}
