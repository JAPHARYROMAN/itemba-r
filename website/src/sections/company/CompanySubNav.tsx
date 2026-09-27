import { companyPageCopy, type Company } from '@/content/companies';
import { SubNav } from '@/ui';

/** Section anchors on a company page, in page order (ids of the sections below). */
export const companySectionIds = {
  whatWeDo: 'what-we-do',
  sites: 'sites',
  strengths: 'strengths',
  faq: 'faq',
  enquire: 'enquire',
} as const;

/**
 * The sticky local bar of a company page, as on an Apple product page: the
 * company's name beside its accent dot, the section anchors (in the bar
 * from `md`, in a chevron menu beside the name on phones) and the Enquire
 * pill, which jumps to the form preset to this company.
 */
export function CompanySubNav({ company }: { company: Company }) {
  const { nav } = companyPageCopy;
  const ids = companySectionIds;
  return (
    <SubNav
      title={company.shortName}
      label={`${company.shortName} ${nav.labelSuffix}`}
      accent={company.accent}
      menuLabel={nav.menu}
      links={[
        { href: `#${ids.whatWeDo}`, label: nav.whatWeDo },
        { href: `#${ids.sites}`, label: nav.sites },
        { href: `#${ids.strengths}`, label: nav.strengths },
        { href: `#${ids.faq}`, label: nav.faq },
      ]}
      cta={{ href: `#${ids.enquire}`, label: nav.enquire }}
    />
  );
}
