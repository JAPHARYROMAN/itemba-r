import { servicesPage } from '@/content/services';
import { ButtonLink, ChevronLink, HeadlineText, PageHero } from '@/ui';

/**
 * The /services hero: "Find the service. Meet the team behind it." as
 * Apple's two-tone line (the second sentence in the secondary colour, on
 * its own line), one sentence on how the services are organised, and the
 * two ways on: the companies, or a general enquiry (the chevron at the
 * pill's own size). Text only: the directory below opens with the page's
 * one photograph, so the first screen stays calm. Static server HTML.
 */
export function ServicesHero() {
  const { hero } = servicesPage;
  const [companies, enquire] = hero.actions;
  return (
    <PageHero
      eyebrow={hero.eyebrow}
      title={<HeadlineText headline={hero.headline} variant="muted-break" />}
      titleSize="display"
      lede={hero.lede}
      actions={
        <>
          {companies ? (
            <ButtonLink href={companies.href} size="lg">
              {companies.label}
            </ButtonLink>
          ) : null}
          {enquire ? (
            <ChevronLink href={enquire.href} size="body-lg">
              {enquire.label}
            </ChevronLink>
          ) : null}
        </>
      }
    />
  );
}
