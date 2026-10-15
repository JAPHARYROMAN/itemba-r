import { homeHero } from '@/content/home';
import { ButtonLink, ChevronLink, Container, Eyebrow, Heading, Media, Section, keepCompounds } from '@/ui';

export function HomeHero() {
  const [explore, enquire] = homeHero.actions;
  return (
    <Section tone="cinema" space="none" labelledBy="page-title" className="home-hero">
      <div className="home-hero-photo">
        <Media media={homeHero.image} alt={homeHero.image.alt} fill priority sizes="(min-width: 1440px) 1000px, (min-width: 1024px) 70vw, 100vw" />
      </div>
      <Container className="relative z-10">
        <div className="home-hero-copy">
          <Eyebrow tone="gold">{homeHero.eyebrow}</Eyebrow>
          <Heading as="h1" id="page-title" size="display-xl" className="mt-6 max-w-[46rem] max-md:text-[2.625rem]">
            {keepCompounds(homeHero.headline.lead)}{' '}
            <span className="mt-2 block text-gold-fg">{keepCompounds(homeHero.headline.accent ?? '')}</span>
          </Heading>
          <p className="mt-7 max-w-lg text-body-lg text-fg-muted">{homeHero.lede}</p>
          <div className="mt-9 flex flex-wrap items-center gap-x-7 gap-y-5">
            {enquire ? <ButtonLink href={enquire.href} size="lg">{enquire.label}</ButtonLink> : null}
            {explore ? <ChevronLink href={explore.href}>{explore.label}</ChevronLink> : null}
          </div>
        </div>
      </Container>
    </Section>
  );
}
