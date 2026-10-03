import { partnershipAreas, partnershipsPage } from '@/content/partnerships';
import { headlineText } from '@/content/types';
import { ButtonLink, ChevronLink, PageHero, Shortcuts } from '@/ui';
import { partnershipsSectionIds as ids } from './ids';
import { routeAccent } from './routeAccent';

/**
 * The hero of an Apple support-style page: typographic and centred, the
 * lead line "Partner with Itemba Group." as the h1, the lede, the two
 * actions (this page's enquiry form, and the capability page for checking
 * the fit first), then the four partnership routes as shortcuts, each
 * jumping to its card. A route's icon takes the accent of the company its
 * enquiry type routes to (the group gold for the group office). Static
 * server HTML: nothing here animates.
 */
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
      eyebrow={hero.eyebrow}
      title={headlineText(hero.headline)}
      titleSize="display"
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
