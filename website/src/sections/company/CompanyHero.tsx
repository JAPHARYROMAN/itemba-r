import { companyPageCopy, type Company } from '@/content/companies';
import { profilePdfHref } from '@/content/profile/cover';
import { ButtonLink, ChevronLink, PageHero } from '@/ui';
import { companySectionIds } from './CompanySubNav';
import { LeadPhoto, heroFrame } from './LeadPhoto';

/**
 * The company hero: the accent dot and what the company does, its short
 * name as the page's h1 (the registered name appears once, in "At a
 * glance"), a one-sentence lede, then the two actions (enquire here, or
 * take the ready-made company profile away as a PDF, the link at the
 * pill's own size) and its hero photograph, which is never the one its
 * home tile shows. One template for every company (LeadPhoto heroFrame):
 * a 2400px landscape runs 2:1 under the text in the content width; any
 * other photograph stands beside the text.
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
      title={company.shortName}
      titleSize="display"
      lede={company.lede}
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
      mediaSize="content"
      media={<LeadPhoto photo={photo} shape={frame.shape} width={frame.width} priority />}
    />
  );
}
