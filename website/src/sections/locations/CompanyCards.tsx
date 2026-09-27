import type { Company } from '@/content/companies';
import { companyUrl } from '@/content/site';
import { CardLink, cn } from '@/ui';

/**
 * The operating companies as three whole-card links, each in its own
 * accent: the sector beside the accent dot, the short name, the one-line
 * lede and "Learn more ›". Used by the location profile and /contact, so a
 * visitor can always reach the company pages (the legacy contact page
 * listed them without links).
 */
export function CompanyCards({ companies, action, className }: { companies: readonly Company[]; action: string; className?: string }) {
  return (
    <ul role="list" className={cn('grid gap-4 md:grid-cols-3 md:gap-5', className)}>
      {companies.map((company) => (
        <CardLink
          key={company.slug}
          as="li"
          accent={company.accent}
          href={companyUrl(company.slug)}
          eyebrow={company.sector}
          eyebrowDot
          title={company.shortName}
          description={company.lede}
          cta={action}
        />
      ))}
    </ul>
  );
}
