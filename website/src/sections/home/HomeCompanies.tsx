import { getCompanyBySlug, type Company } from '@/content/companies';
import { homeCompanyTiles, homeTileActions, type HomeCompanyTile } from '@/content/home';
import { mediaImage, type MediaId } from '@/content/media';
import { companyUrl } from '@/content/site';
import type { Tone } from '@/design/tokens';
import { ChevronLink, Container, Eyebrow, Heading, Media, Section, cn, keepCompounds } from '@/ui';

const chapterPhotos: Record<string, MediaId> = {
  'mwanjalisi-oil': 'mpemba-dusk',
  'westsides-company': 'westsides-order-truck',
  'itemba-enterprises': 'logistics-truck-front',
};
export type CompanyTileProps = { company: Company; tile: HomeCompanyTile; tone: Tone; photoFirst?: boolean };

export function CompanyTile({ company, tile, tone, photoFirst = false }: CompanyTileProps) {
  const href = companyUrl(company.slug);
  const photo = mediaImage(chapterPhotos[company.slug] ?? 'mpemba-dusk');
  return (
    <Section tone={tone} accent={company.accent} labelledBy={'tile-' + company.slug} className="border-b border-line">
      <Container className="grid items-center gap-10 lg:grid-cols-2 lg:gap-20">
        <div>
          <Eyebrow dot>{tile.eyebrow}</Eyebrow>
          <Heading as="h2" id={'tile-' + company.slug} size="display" className="mt-4">{tile.name}</Heading>
          <p className="mt-6 max-w-lg text-body-lg text-fg-muted">{keepCompounds(tile.summary)}</p>
          <div className="mt-8 flex flex-wrap gap-x-8 gap-y-4">
            <ChevronLink href={href} context={tile.name}>{homeTileActions.explore}</ChevronLink>
            <ChevronLink href={href + '#enquire'} context={tile.name}>{homeTileActions.enquire}</ChevronLink>
          </div>
        </div>
        <figure className={cn('w-full max-w-md lg:justify-self-end', photoFirst && 'lg:order-first lg:justify-self-start')}>
          <Media media={photo} alt={photo.alt} aspect="4/3" radius="tile" sizes="(min-width: 1024px) 448px, (min-width: 640px) 448px, calc(100vw - 44px)" />
          <figcaption className="mt-3 flex items-center gap-3 text-caption text-fg-muted">
            <span aria-hidden="true" className="h-px w-8 bg-accent" />{company.shortName}
          </figcaption>
        </figure>
      </Container>
    </Section>
  );
}

export function HomeCompanies() {
  return <>{homeCompanyTiles.map((tile, index) => {
    const company = getCompanyBySlug(tile.companySlug);
    return company ? <CompanyTile key={tile.companySlug} company={company} tile={tile} tone={index === 1 ? 'alt' : 'light'} photoFirst={index === 1} /> : null;
  })}</>;
}
