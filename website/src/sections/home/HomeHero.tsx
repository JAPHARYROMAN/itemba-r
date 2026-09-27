import { homeHero } from '@/content/home';
import { headlineText } from '@/content/types';
import { Showcase } from '@/sections/company/Showcase';
import { ButtonLink, ChevronLink, PageHero } from '@/ui';

/**
 * 1. The hero: the lead line verbatim as the page's only h1, the group in
 * one sentence, the two ways in (the companies, an enquiry), then
 * ITEMBA-MPEMBA under a big sky. Static server HTML: the hero and its LCP
 * photograph never animate.
 */
export function HomeHero() {
  const [explore, enquire] = homeHero.actions;
  return (
    <PageHero
      eyebrow={homeHero.eyebrow}
      title={headlineText(homeHero.headline)}
      titleSize="display"
      lede={homeHero.lede}
      actions={
        <>
          {explore ? (
            <ButtonLink href={explore.href} size="lg">
              {explore.label}
            </ButtonLink>
          ) : null}
          {enquire ? (
            <ChevronLink href={enquire.href} size="lede">
              {enquire.label}
            </ChevronLink>
          ) : null}
        </>
      }
      media={<Showcase photos={[homeHero.image]} priority />}
    />
  );
}
