import { contactActionLabels } from '@/content/contact';
import { servicesPage } from '@/content/services';
import { ButtonLink, ContactLink, CtaBand } from '@/ui';

/**
 * The closing call to action: the group's routing promise ("Every sector.
 * One front door.") with the enquiry pill (the general form on /contact),
 * WhatsApp and Call. White, so the page's last tile stands apart from the
 * grey footer. The contact hrefs come from src/content/contact.ts, in the
 * forms ConversionTracker classifies.
 */
export function ServicesClosing() {
  const { closing } = servicesPage;
  return (
    <CtaBand
      titleId="closing-title"
      title={closing.title}
      lede={closing.body}
      tone="light"
      actions={
        <>
          <ButtonLink href={closing.action.href} size="lg">
            {closing.action.label}
          </ButtonLink>
          <ContactLink kind="whatsapp" appearance="chevron" size="lg" aria-label={contactActionLabels.whatsapp}>
            {closing.channels.whatsapp}
          </ContactLink>
          <ContactLink kind="tel" appearance="chevron" size="lg" aria-label={contactActionLabels.call}>
            {closing.channels.call}
          </ContactLink>
        </>
      }
    />
  );
}
