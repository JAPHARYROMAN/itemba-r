import { partnershipAreas, partnershipsPage } from '@/content/partnerships';
import { headlineText } from '@/content/types';
import { ButtonLink, ChevronLink, PageHero, Shortcuts } from '@/ui';
import { partnershipsSectionIds as ids } from './ids';
import { routeAccent } from './routeAccent';

/** Editorial introduction for suppliers, buyers and partners, with anchors to the four routes. */
export function PartnershipsHero() {
  const { hero } = partnershipsPage;
  const shortcuts = partnershipAreas.map((area) => ({
    href: `#${area.id}`,
    label: area.shortTitle,
    icon: area.icon,
    accent: routeAccent(area),
  }));
  return (
    <PageHero
      align="start"
      eyebrow={hero.eyebrow}
      title={headlineText(hero.headline)}
      titleSize="display"
      titleMeasure="wide"
      lede={hero.lede}
      actions={
        <>
          <ButtonLink href={`#${ids.enquire}`} size="lg">
            {hero.enquire}
          </ButtonLink>
          <ChevronLink href={hero.link.href} size="body-lg">
            {hero.link.label}
          </ChevronLink>
        </>
      }
    >
      <Shortcuts label={hero.shortcutsLabel} items={shortcuts} columns={4} className="mt-6 md:mt-10" />
    </PageHero>
  );
}
