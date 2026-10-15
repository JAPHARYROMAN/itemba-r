import { contactActionLabels } from '@/content/contact';
import { contactPage } from '@/content/contactPage';
import { headlineText } from '@/content/types';
import { ButtonLink, ContactLink, PageHero } from '@/ui';
import { contactSectionIds } from './ids';

/** Charcoal contact introduction with immediate form, WhatsApp and phone actions. */
export function ContactHero() {
  const { hero, quickActions } = contactPage;
  return (
    <PageHero
      align="start"
      tone="cinema"
      eyebrow={hero.eyebrow}
      title={headlineText(hero.headline)}
      titleSize="display"
      titleMeasure="wide"
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
