import { aboutPage } from '@/content/about';
import { ButtonLink, ChevronLink, HeadlineText, PageHero } from '@/ui';

/** Left-aligned group introduction with direct routes to the companies and the profile. */
export function AboutHero() {
  const { hero } = aboutPage;
  const [companies, profile] = hero.actions;
  return (
    <PageHero
      align="start"
      eyebrow={hero.eyebrow}
      title={<HeadlineText headline={hero.headline} variant="muted-break" breakFrom="always" />}
      titleSize="display-xl"
      titleMeasure="wide"
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
