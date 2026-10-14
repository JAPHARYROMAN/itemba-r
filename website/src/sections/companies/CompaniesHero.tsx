import { companies, companiesPage } from '@/content/companies';
import type { CompanyId } from '@/content/types';
import { HeadlineText, Icon, PageHero, SmartLink, type IconName } from '@/ui';

const companyIcons: Record<CompanyId, IconName> = { mwanjalisi: 'energy', westsides: 'trade', enterprises: 'logistics' };

export function CompaniesHero() {
  const { hero } = companiesPage;
  return (
    <PageHero eyebrow={hero.eyebrow} title={<HeadlineText headline={hero.headline} variant="muted-break" breakFrom="always" />} titleSize="display" lede={hero.lede} align="start">
      <nav aria-label={companiesPage.jumpLabel}>
        <ul role="list" className="grid gap-3 sm:grid-cols-3">
          {companies.map((company, index) => (
            <li key={company.id} data-accent={company.accent}>
              <SmartLink href={`#${company.id}`} className="group flex min-h-16 items-center gap-4 border-y border-line py-4 text-body text-fg transition-colors hover:text-accent-fg">
                <span aria-hidden="true" className="text-caption tabular-nums text-fg-muted">{String(index + 1).padStart(2, '0')}</span>
                <Icon name={companyIcons[company.id]} size="md" className="shrink-0 text-accent" />
                <span>{company.shortName}</span>
              </SmartLink>
            </li>
          ))}
        </ul>
      </nav>
    </PageHero>
  );
}