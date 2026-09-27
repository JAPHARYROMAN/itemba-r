import { companies, companiesPage } from '@/content/companies';
import type { CompanyId } from '@/content/types';
import { HeadlineText, Icon, PageHero, SmartLink, type IconName } from '@/ui';

/** Each company's line icon in the hero's jump links (the icons its tiles and panels use). */
const companyIcons: Record<CompanyId, IconName> = {
  mwanjalisi: 'energy',
  westsides: 'trade',
  enterprises: 'logistics',
};

/**
 * The companies index hero: "Three companies. Six sectors." as the
 * two-tone line, the independence of each company in one sentence, and,
 * as on Apple's product-family pages, a row of the three companies (a line
 * icon in each accent over the short name) that jumps to each company's
 * tile (#mwanjalisi, #westsides, #enterprises, anchors kept from the
 * original page). No photograph: the tiles below carry them.
 */
export function CompaniesHero() {
  const { hero } = companiesPage;
  return (
    <PageHero
      eyebrow={hero.eyebrow}
      title={<HeadlineText headline={hero.headline} variant="muted-break" breakFrom="always" />}
      titleSize="display"
      lede={hero.lede}
    >
      <nav aria-label={hero.eyebrow}>
        <ul role="list" className="mx-auto grid max-w-lg grid-cols-3 gap-2 md:gap-4">
          {companies.map((company) => (
            <li key={company.id} data-accent={company.accent}>
              <SmartLink
                href={`#${company.id}`}
                className="group flex min-h-11 flex-col items-center gap-2.5 rounded-card px-1 py-3 text-caption text-fg transition-colors duration-fast ease-apple hover:bg-surface-alt md:text-body"
              >
                <Icon name={companyIcons[company.id]} size="lg" strokeWidth={1.4} className="text-accent" />
                <span className="text-balance">{company.shortName}</span>
              </SmartLink>
            </li>
          ))}
        </ul>
      </nav>
    </PageHero>
  );
}
