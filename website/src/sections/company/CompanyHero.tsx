import { companyPageCopy, type Company } from '@/content/companies';
import { profilePdfHref } from '@/content/profile/cover';
import { ButtonLink, ChevronLink, PageHero } from '@/ui';
import { companySectionIds } from './CompanySubNav';
import { Showcase } from './Showcase';

/**
 * The company hero: the accent dot and what the company does, its name as
 * the page's h1, its summary, then the two actions (enquire here, or take
 * the ready-made company profile away as a PDF) and its lead photographs.
 */
export function CompanyHero({ company }: { company: Company }) {
  const { hero } = companyPageCopy;
  return (
    <PageHero
      accent={company.accent}
      eyebrow={company.eyebrow}
      eyebrowDot
      title={company.name}
      titleSize="display"
      lede={company.summary}
      actions={
        <>
          <ButtonLink href={`#${companySectionIds.enquire}`} size="lg">
            {hero.enquire}
          </ButtonLink>
          <ChevronLink href={profilePdfHref(company.id)} download size="lede">
            {hero.download} ({hero.downloadFormat})
          </ChevronLink>
        </>
      }
      media={<Showcase photos={company.showcase} priority />}
    />
  );
}
