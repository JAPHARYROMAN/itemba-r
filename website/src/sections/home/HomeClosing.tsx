import { contactActionLabels } from '@/content/contact';
import { homeClosing } from '@/content/home';
import { ButtonLink, ChevronLink, ContactLink, CtaBand } from '@/ui';

/**
 * 8. The closing call to action: "Let's move something together." with the
 * Enquire pill, WhatsApp and Call. The contact hrefs come from
 * src/content/contact.ts in the forms ConversionTracker classifies.
 */
export function HomeClosing() {
  const [enquire] = homeClosing.actions;
  return (
    <CtaBand
      titleId="closing-title"
      title={homeClosing.title}
      lede={homeClosing.body}
      tone="light"
      actions={
        <>
          {enquire ? (
            <ButtonLink href={enquire.href} size="lg">
              {enquire.label}
            </ButtonLink>
          ) : null}
          <ContactLink kind="whatsapp" appearance="chevron" size="lg" aria-label={contactActionLabels.whatsapp}>
            {homeClosing.channels.whatsapp}
          </ContactLink>
          <ContactLink kind="tel" appearance="chevron" size="lg" aria-label={contactActionLabels.call}>
            {homeClosing.channels.call}
          </ContactLink>
        </>
      }
    >
      <ChevronLink href={homeClosing.link.href} size="caption">
        {homeClosing.link.label}
      </ChevronLink>
    </CtaBand>
  );
}
