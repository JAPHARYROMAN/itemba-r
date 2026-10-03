import type { Company } from '@/content/companies';
import { servicePageCopy, type ServiceArea } from '@/content/services';
import { SubNav } from '@/ui';

/** Section anchors on a service page, in page order (ids of the sections below). */
export const serviceSectionIds = {
  offerings: 'offerings',
  where: 'sites',
  company: 'company',
  faq: 'faq',
  enquire: 'enquire',
} as const;

/**
 * The sticky local bar of a service page, as on the company pages: the
 * page's short name (service.navTitle) beside the running company's accent
 * dot, the section anchors (in the bar from `md`, in a chevron menu beside
 * the name on phones) and the Enquire pill, which jumps to the form preset
 * to the company that runs the service.
 */
export function ServiceSubNav({ service, company }: { service: ServiceArea; company: Company }) {
  const { nav } = servicePageCopy;
  const ids = serviceSectionIds;
  return (
    <SubNav
      title={service.navTitle}
      label={`${service.navTitle} ${nav.labelSuffix}`}
      accent={company.accent}
      menuLabel={nav.menu}
      links={[
        { href: `#${ids.offerings}`, label: nav.offerings },
        { href: `#${ids.where}`, label: service.where.nav },
        { href: `#${ids.company}`, label: nav.company },
        { href: `#${ids.faq}`, label: nav.faq },
      ]}
      cta={{ href: `#${ids.enquire}`, label: nav.enquire }}
    />
  );
}
