import { homeHero } from '@/content/home';
import { headlineText } from '@/content/types';
import { LeadPhoto } from '@/sections/company/LeadPhoto';
import { ButtonLink, ChevronLink, PageHero, keepCompounds } from '@/ui';

/**
 * The headline's longest word group, "Tanzania–Zambia", is about 7.6em
 * wide. Below `md` the h1 is display-xl (48px, then 8vw) wherever that
 * fits the line, and just small enough to fit it on the narrowest phones
 * (about 40px at 360px), so the compound is never split at its dash; from
 * `md` it is display-xl as set. Chapter titles are 32px at 360px and
 * statements 33px (the h1 and `statement` sizes), so the lead line leads
 * them by at least 1.2x at every phone width.
 */
const phoneFit = 'max-md:text-[length:min(max(3rem,8vw),calc((100vw_-_2.75rem)_/_7.8))]';

/**
 * 1. The hero: the lead line verbatim as the page's only h1, at the largest
 * size on the site (display-xl), so it leads everything below it, and wide
 * enough to set in two lines on a desktop, so the photograph's canopy
 * clears the fold under it; the group in one sentence; the two ways in (the
 * companies, an enquiry), the chevron link at the pill's own size so the
 * primary action leads; then ITEMBA-MPEMBA under a big sky. On phones the
 * photograph is cropped 1.5x tighter on the canopy, so the station and its
 * ITEMBA signs read at 316px wide. Static server HTML: the hero and its
 * LCP photograph never animate.
 */
export function HomeHero() {
  const [explore, enquire] = homeHero.actions;
  return (
    <PageHero
      eyebrow={homeHero.eyebrow}
      title={keepCompounds(headlineText(homeHero.headline))}
      titleSize="display-xl"
      titleMeasure="wide"
      titleClassName={phoneFit}
      lede={homeHero.lede}
      actions={
        <>
          {explore ? (
            <ButtonLink href={explore.href} size="lg">
              {explore.label}
            </ButtonLink>
          ) : null}
          {enquire ? (
            <ChevronLink href={enquire.href} size="body-lg">
              {enquire.label}
            </ChevronLink>
          ) : null}
        </>
      }
      media={<LeadPhoto photo={homeHero.image} shape="cinema" width="wide" priority zoom={1.5} />}
    />
  );
}
