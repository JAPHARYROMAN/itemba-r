import { getCompanyBySlug, type Company } from '@/content/companies';
import { homeCompanyTiles, homeTileActions, type HomeCompanyTile } from '@/content/home';
import { companyUrl } from '@/content/site';
import type { Tone } from '@/design/tokens';
import { LeadPhoto, isPortrait } from '@/sections/company/LeadPhoto';
import { ChevronLink, Container, Eyebrow, Heading, Reveal, Section, cn, keepCompounds } from '@/ui';

/**
 * The home rhythm for the three tiles: the energy tile carries the dusk
 * photograph on black, then white, then the alternate grey.
 */
const tileTones: readonly Tone[] = ['cinema', 'light', 'alt'];

export type CompanyTileProps = {
  company: Company;
  tile: HomeCompanyTile;
  tone: Tone;
  /** Split tiles alternate sides: the photograph on the right, then on the left. */
  photoFirst?: boolean;
};

/**
 * The accent dot and legal name, the name at h1 size (a chapter under the
 * hero's display-xl line), what it does, the summary and the two links.
 * Centred; a split tile sets it flush left beside its photograph from `lg`.
 */
function TileText({ company, tile, split }: { company: Company; tile: HomeCompanyTile; split: boolean }) {
  const href = companyUrl(company.slug);
  return (
    <div className={cn('text-center', split && 'lg:text-left')}>
      <Eyebrow dot>{company.legalName}</Eyebrow>
      <Heading as="h2" id={`tile-${company.slug}`} size="h1" className="mt-3">
        {tile.name}
      </Heading>
      <p className="mt-2 text-h3 font-normal text-fg">{keepCompounds(tile.eyebrow)}</p>
      <p className={cn('mx-auto mt-5 max-w-[38rem] text-body-lg text-fg-muted', split && 'lg:mx-0')}>{keepCompounds(tile.summary)}</p>
      <div className={cn('mt-7 flex flex-wrap items-center justify-center gap-x-8 gap-y-3', split && 'lg:justify-start')}>
        <ChevronLink href={href} size="lede" context={tile.name}>
          {homeTileActions.explore}
        </ChevronLink>
        <ChevronLink href={`${href}#enquire`} size="lede" context={tile.name}>
          {homeTileActions.enquire}
        </ChevronLink>
      </div>
    </div>
  );
}

/**
 * One company, one tile, as Apple sets a product on its home page, with
 * one photograph:
 * - a landscape photograph runs across the tile under the centred text,
 *   in the 1068px content width (where the dusk master stays sharp);
 * - a portrait photograph stands beside the text from `lg` (a split tile,
 *   in a 440px column), and under it, square, on smaller screens.
 * The links go to the company page and straight to its enquiry form there.
 */
export function CompanyTile({ company, tile, tone, photoFirst = false }: CompanyTileProps) {
  const titleId = `tile-${company.slug}`;
  const photo = company.tileImage;

  if (isPortrait(photo)) {
    return (
      <Section tone={tone} accent={company.accent} labelledBy={titleId}>
        <Container className="grid items-center gap-10 md:gap-12 lg:grid-cols-2 lg:gap-16">
          <TileText company={company} tile={tile} split />
          <Reveal className={cn('mx-auto w-full max-w-md lg:max-w-[27.5rem]', photoFirst && 'lg:order-first')}>
            <LeadPhoto photo={photo} shape="portrait" width="split" />
          </Reveal>
        </Container>
      </Section>
    );
  }

  return (
    <Section tone={tone} accent={company.accent} labelledBy={titleId}>
      <Container>
        <TileText company={company} tile={tile} split={false} />
      </Container>
      <Reveal>
        <Container className="mt-12 md:mt-16">
          <LeadPhoto photo={photo} shape="panorama" width="content" />
        </Container>
      </Reveal>
    </Section>
  );
}

/** 3. The three company tiles, in public order; split tiles alternate the photograph's side. */
export function HomeCompanies() {
  let splits = 0;
  return (
    <>
      {homeCompanyTiles.map((tile, index) => {
        const company = getCompanyBySlug(tile.companySlug);
        if (!company) return null;
        const photoFirst = isPortrait(company.tileImage) && splits++ % 2 === 1;
        return (
          <CompanyTile
            key={tile.companySlug}
            company={company}
            tile={tile}
            tone={tileTones[index % tileTones.length] ?? 'light'}
            photoFirst={photoFirst}
          />
        );
      })}
    </>
  );
}
