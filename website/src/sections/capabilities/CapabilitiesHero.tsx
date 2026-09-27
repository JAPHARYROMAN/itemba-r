import { capabilitiesPage } from '@/content/capabilities';
import { getCompanyBySlug } from '@/content/companies';
import { profilePdfHref } from '@/content/profile/cover';
import { serviceAreas, serviceIcons } from '@/content/services';
import { ButtonLink, ChevronLink, HeadlineText, PageHero } from '@/ui';
import { capabilitiesSectionIds as ids } from './ids';
import { Shortcuts } from './Shortcuts';

/**
 * The hero of an Apple support-style page: typographic, centred, no
 * photograph (no master is both strong enough and wide enough to lead
 * here). "Verify the fit." in ink, "Contact the right team." in the quieter
 * grey on its own line, as Apple sets a two-part line; the lede; the two
 * actions (this page's enquiry form, and the group's ready-made profile and
 * capability statement as a PDF); then the six services as shortcuts, each
 * icon in the accent of the company that runs it, jumping to its row of the
 * capability map. Static server HTML: nothing here animates.
 */
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
      eyebrow={hero.eyebrow}
      title={<HeadlineText headline={hero.headline} variant="muted-break" />}
      titleSize="display"
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
