import type { ReactNode } from 'react';
import { isPhoto, type Company } from '@/content/companies';
import { servicePageCopy, type ServiceArea, type ServiceVisual } from '@/content/services';
import { companyUrl } from '@/content/site';
import { LeadPhoto, heroFrame } from '@/sections/company/LeadPhoto';
import { ButtonLink, ChevronLink, PageHero, TypePanel, keepCompounds } from '@/ui';
import { serviceSectionIds } from './ServiceSubNav';

/**
 * The hero's visual and how it sits:
 * - a photograph takes the company hero's frame (LeadPhoto heroFrame): a
 *   2400px landscape runs 2:1 under the text in the content width; any
 *   other photograph stands beside the text, square;
 * - where no strong photograph exists (hospitality, whose room photograph
 *   is low-resolution; real estate, flags.estateImagery), a typographic
 *   panel stands beside the text in its place, 4:3 on phones.
 */
function heroMedia(visual: ServiceVisual): { layout: 'framed' | 'split'; media: ReactNode } {
  if (isPhoto(visual)) {
    const frame = heroFrame(visual);
    return {
      layout: frame.layout,
      media: <LeadPhoto photo={visual} shape={frame.shape} width={frame.width} zoom={frame.zoom} priority />,
    };
  }
  return {
    layout: 'split',
    media: (
      <TypePanel
        icon={visual.icon}
        statement={visual.statement}
        caption={visual.caption}
        className="aspect-[4/3] w-full sm:aspect-square"
      />
    ),
  };
}

/**
 * The service hero, on the company template: the accent dot and the
 * sector, the service as the page's h1, a one-sentence lede, then the two
 * actions (enquire here, or meet the company that runs it, the link at the
 * pill's own size) and its visual. Static server HTML: the hero and its
 * LCP image never animate.
 */
export function ServiceHero({ service, company }: { service: ServiceArea; company: Company }) {
  const { hero } = servicePageCopy;
  const { layout, media } = heroMedia(service.heroVisual);
  return (
    <PageHero
      accent={company.accent}
      eyebrow={service.eyebrow}
      eyebrowDot
      // "Cross-Border" (about 6.6em) fits a phone's line at the h1's size: never split it at the dash.
      title={keepCompounds(service.title)}
      titleSize="display"
      lede={service.lede}
      actions={
        <>
          <ButtonLink href={`#${serviceSectionIds.enquire}`} size="lg">
            {hero.enquire}
          </ButtonLink>
          <ChevronLink href={companyUrl(company.slug)} size="body-lg">
            {`${hero.runBy} ${company.shortName}`}
          </ChevronLink>
        </>
      }
      mediaLayout={layout}
      mediaSize="content"
      media={media}
    />
  );
}
