import { companyPageCopy, type Company } from '@/content/companies';
import { profilePdfHref } from '@/content/profile/cover';
import { ButtonLink, ChevronLink, PageHero } from '@/ui';
import { companySectionIds } from './CompanySubNav';
import { LeadPhoto, heroFrame } from './LeadPhoto';

/**
 * The company hero: the accent dot and what the company does, its name as
 * the page's h1, its summary, then the two actions (enquire here, or take
 * the ready-made company profile away as a PDF, the link at the pill's own
 * size) and its hero photograph, which is never the one its home tile
 * shows. A 2400px landscape runs wide; a smaller landscape stays in the
 * prose width; a portrait photograph stands beside the text.
 */
export function CompanyHero({ company }: { company: Company }) {
  const { hero } = companyPageCopy;
  const photo = company.heroImage;
  const frame = heroFrame(photo);
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
          <ChevronLink href={profilePdfHref(company.id)} download size="body-lg">
            {hero.download} ({hero.downloadFormat})
          </ChevronLink>
        </>
      }
      mediaLayout={frame.layout}
      mediaSize={frame.width === 'prose' ? 'prose' : 'wide'}
      media={<LeadPhoto photo={photo} shape={frame.shape} width={frame.width} priority />}
    />
  );
}
