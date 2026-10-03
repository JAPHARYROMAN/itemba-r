import { getCompanyBySlug, isPhoto } from '@/content/companies';
import { homeCompanyTiles } from '@/content/home';
import type { Tone } from '@/design/tokens';
import { isPortrait } from '@/sections/company/LeadPhoto';
import { CompanyTile } from '@/sections/home/HomeCompanies';

/** The home rhythm: the dusk photograph on black, then white, then the alternate grey. */
const tileTones: readonly Tone[] = ['cinema', 'light', 'alt'];

/**
 * The three company tiles, the home page's own component, in public order:
 * the accent dot and legal name, the company, what it does, one sentence,
 * and the two links (the company page, and its enquiry form there). Each
 * tile sits in a wrapper carrying the company's anchor (#mwanjalisi,
 * #westsides, #enterprises), so links to the original bands still land;
 * the global scroll padding clears the nav. Split tiles alternate the side
 * of their visual, as on home.
 */
export function CompaniesTiles() {
  let splits = 0;
  return (
    <>
      {homeCompanyTiles.map((tile, index) => {
        const company = getCompanyBySlug(tile.companySlug);
        if (!company) return null;
        const visual = company.tileVisual;
        const split = !isPhoto(visual) || isPortrait(visual);
        const photoFirst = split && splits++ % 2 === 1;
        return (
          <div key={company.id} id={company.id}>
            <CompanyTile company={company} tile={tile} tone={tileTones[index % tileTones.length] ?? 'light'} photoFirst={photoFirst} />
          </div>
        );
      })}
    </>
  );
}
