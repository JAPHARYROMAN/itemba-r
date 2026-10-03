import { contactActionLabels } from '@/content/contact';
import { contactPage } from '@/content/contactPage';
import { headlineText } from '@/content/types';
import { ButtonLink, ContactLink, PageHero } from '@/ui';
import { contactSectionIds } from './ids';

/**
 * The /contact hero, as an Apple support page opens: the page's name as
 * the h1, one sentence, then the ways in: the enquiry form just below (the
 * pill), or WhatsApp and a call straight away (the quick-contact bar steps
 * aside on this page, so a phone visitor gets them here). No photograph:
 * the form is the point of the page and follows directly.
 */
export function ContactHero() {
  const { hero, quickActions } = contactPage;
  return (
    <PageHero
      eyebrow={hero.eyebrow}
      title={headlineText(hero.headline)}
      titleSize="display"
      lede={hero.lede}
      actions={
        <>
          <ButtonLink href={`#${contactSectionIds.enquire}`} size="lg">
            {hero.enquire}
          </ButtonLink>
          <ContactLink kind="whatsapp" appearance="chevron" size="lg" aria-label={contactActionLabels.whatsapp}>
            {quickActions.whatsapp}
          </ContactLink>
          <ContactLink kind="tel" appearance="chevron" size="lg" aria-label={contactActionLabels.call}>
            {quickActions.call}
          </ContactLink>
        </>
      }
    />
  );
}
