import { aboutPage } from '@/content/about';
import { ButtonLink, ChevronLink, HeadlineText, PageHero } from '@/ui';

/**
 * The About hero: "Built for Tanzania. Built to last." as Apple's two-tone
 * line (the second sentence in the secondary grey, on its own line at every
 * width), the group in one sentence, and the two ways on: the companies,
 * and the ready-made profile for banks and partners. Typographic, with no
 * photograph: the page's one photograph is the Songwe landscape at the
 * foot, where it says where the group is; every other strong photograph
 * is a forecourt canopy the home page already shows. Static server HTML.
 */
export function AboutHero() {
  const { hero } = aboutPage;
  const [companies, profile] = hero.actions;
  return (
    <PageHero
      eyebrow={hero.eyebrow}
      title={<HeadlineText headline={hero.headline} variant="muted-break" breakFrom="always" />}
      titleSize="display-xl"
      lede={hero.lede}
      actions={
        <>
          <ButtonLink href={companies.href} size="lg">
            {companies.label}
          </ButtonLink>
          <ChevronLink href={profile.href} size="body-lg">
            {profile.label}
          </ChevronLink>
        </>
      }
    />
  );
}
