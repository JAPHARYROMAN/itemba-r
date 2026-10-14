import { capabilitiesPage } from '@/content/capabilities';
import { getCompanyBySlug } from '@/content/companies';
import { profilePdfHref } from '@/content/profile/cover';
import { serviceAreas, serviceIcons } from '@/content/services';
import { ButtonLink, ChevronLink, HeadlineText, PageHero, Shortcuts } from '@/ui';
import { capabilitiesSectionIds as ids } from './ids';

/** Editorial capability introduction with a shortcut to every service and its operating owner. */
export function CapabilitiesHero() {
  const { hero } = capabilitiesPage;
  const shortcuts = serviceAreas.map((service) => ({
    href: `#${service.slug}`,
    label: service.shortTitle,
    icon: serviceIcons[service.visual],
    accent: getCompanyBySlug(service.companySlug)?.accent,
  }));
  return (
    <PageHero
      align="start"
      eyebrow={hero.eyebrow}
      title={<HeadlineText headline={hero.headline} variant="muted-break" />}
      titleSize="display"
      titleMeasure="wide"
      lede={hero.lede}
      actions={
        <>
          <ButtonLink href={`#${ids.enquire}`} size="lg">
            {hero.enquire}
          </ButtonLink>
          <ChevronLink href={profilePdfHref('group')} download size="body-lg">
            {hero.download} ({hero.downloadFormat})
          </ChevronLink>
        </>
      }
    >
      <Shortcuts label={hero.shortcutsLabel} items={shortcuts} columns={6} className="mt-6 md:mt-10" />
    </PageHero>
  );
}
