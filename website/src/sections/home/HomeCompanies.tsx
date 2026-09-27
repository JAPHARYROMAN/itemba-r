import { getCompanyBySlug, type Company } from '@/content/companies';
import { homeCompanyTiles, homeTileActions, type HomeCompanyTile } from '@/content/home';
import { companyUrl } from '@/content/site';
import type { Tone } from '@/design/tokens';
import { Showcase } from '@/sections/company/Showcase';
import { ChevronLink, Container, Eyebrow, Heading, Reveal, Section } from '@/ui';

/**
 * The home rhythm for the three tiles: the energy tile carries the dusk
 * photograph on black, then white, then the alternate grey.
 */
const tileTones: readonly Tone[] = ['cinema', 'light', 'alt'];

export type CompanyTileProps = {
  company: Company;
  tile: HomeCompanyTile;
  tone: Tone;
};

/**
 * One company, one full-width tile, as Apple sets a product on its home
 * page: the accent dot and legal name, the name as a display headline,
 * what it does, "Explore ›" and "Enquire ›", then its photographs. The
 * links go to the company page and straight to its enquiry form there.
 */
export function CompanyTile({ company, tile, tone }: CompanyTileProps) {
  const titleId = `tile-${company.slug}`;
  const href = companyUrl(company.slug);
  return (
    <Section tone={tone} accent={company.accent} labelledBy={titleId}>
      <Container className="text-center">
        <Eyebrow dot>{company.legalName}</Eyebrow>
        <Heading as="h2" id={titleId} size="display" className="mt-3">
          {tile.name}
        </Heading>
        <p className="mt-2 text-h3 font-normal text-fg md:mt-3">{tile.eyebrow}</p>
        <p className="mx-auto mt-5 max-w-[38rem] text-body-lg text-fg-muted">{tile.summary}</p>
        <div className="mt-7 flex flex-wrap items-center justify-center gap-x-8 gap-y-3">
          <ChevronLink href={href} size="lede" context={tile.name}>
            {homeTileActions.explore}
          </ChevronLink>
          <ChevronLink href={`${href}#enquire`} size="lede" context={tile.name}>
            {homeTileActions.enquire}
          </ChevronLink>
        </div>
      </Container>
      <Reveal>
        <Container size="wide" className="mt-12 md:mt-16">
          <Showcase photos={company.showcase} />
        </Container>
      </Reveal>
    </Section>
  );
}

/** 3. The three company tiles, in public order. */
export function HomeCompanies() {
  return (
    <>
      {homeCompanyTiles.map((tile, index) => {
        const company = getCompanyBySlug(tile.companySlug);
        if (!company) return null;
        return <CompanyTile key={tile.companySlug} company={company} tile={tile} tone={tileTones[index % tileTones.length] ?? 'light'} />;
      })}
    </>
  );
}
