import { getCompanyBySlug } from '@/content/companies';
import { homeSectors, type HomeSector } from '@/content/home';
import { getServiceBySlug } from '@/content/services';
import { serviceUrl } from '@/content/site';
import {
  Bento,
  BentoCell,
  Chevron,
  ChevronLink,
  Container,
  Eyebrow,
  Heading,
  Icon,
  Lede,
  Media,
  Reveal,
  Section,
  SmartLink,
  type BentoSpan,
} from '@/ui';

/**
 * The bento's shape on the six-column grid (lg):
 *   energy (2/3, with its photograph) · trade (1/3)
 *   logistics · construction · hospitality (1/3 each)
 *   real estate (1/3) · the routing promise (2/3, black)
 * From `md` to `lg` the cells pair up two by two; phones stack them.
 * Only the lead cell carries a photograph, so no picture repeats one the
 * company tiles above already show, and Itemba Estate stays a typographic
 * tile (flags.estateImagery).
 */
const spans: readonly BentoSpan[] = ['two-thirds', 'third', 'third', 'third', 'third', 'third'];

/** A stretched title link: the whole cell is one target named by the sector. */
const stretchedLink =
  'after:absolute after:inset-0 after:rounded-tile focus-visible:outline-none focus-visible:after:outline focus-visible:after:outline-2 focus-visible:after:-outline-offset-2 focus-visible:after:outline-focus';

function SectorCell({ item, span, lead }: { item: HomeSector; span: BentoSpan; lead: boolean }) {
  const service = getServiceBySlug(item.serviceSlug);
  const company = service ? getCompanyBySlug(service.companySlug) : undefined;
  const text = (
    <div className="flex flex-1 flex-col p-7 md:p-8">
      <Icon name={item.icon} size="lg" strokeWidth={1.4} className="text-accent" />
      <Heading as="h3" size="h3" className="mt-6 md:mt-10">
        <SmartLink href={serviceUrl(item.serviceSlug)} className={stretchedLink}>
          {item.name}
        </SmartLink>
      </Heading>
      {company ? (
        <p className="mt-2 flex items-center gap-2 text-caption text-fg-muted">
          <span aria-hidden="true" className="size-1.5 shrink-0 rounded-full bg-accent" />
          {homeSectors.runBy} {company.shortName}
        </p>
      ) : null}
      <span aria-hidden="true" className="mt-auto inline-flex items-center gap-[0.3em] pt-6 text-body text-accent-fg md:pt-8">
        {homeSectors.action}
        <Chevron />
      </span>
    </div>
  );

  return (
    // Each cell is its own tone element, so the company accent re-maps the
    // accent text colour too (theme.ts resolves --accent-fg on the tone).
    <BentoCell
      span={span}
      tone="alt"
      accent={company?.accent}
      padding="none"
      className={lead ? 'group transition-shadow duration-base ease-apple hover:shadow-card md:flex-row' : 'group transition-shadow duration-base ease-apple hover:shadow-card'}
    >
      {text}
      {lead ? (
        <Reveal className="relative aspect-[4/3] md:aspect-auto md:w-1/2 md:shrink-0">
          <Media
            media={item.image}
            alt={item.image.alt}
            fill
            sizes="(min-width: 1068px) 356px, (min-width: 768px) 50vw, calc(100vw - 44px)"
          />
        </Reveal>
      ) : null}
    </BentoCell>
  );
}

/** 4. "Six sectors. One corridor.": every sector, the company that runs it, and the one front door. */
export function HomeSectors() {
  const { routing } = homeSectors;
  return (
    <Section labelledBy="sectors-title">
      <Container>
        <div className="mx-auto max-w-prose text-center">
          <Eyebrow>{homeSectors.eyebrow}</Eyebrow>
          <Heading as="h2" id="sectors-title" size="display" className="mt-2">
            {homeSectors.title}
          </Heading>
          <Lede tone="muted" className="mx-auto mt-5 max-w-[40rem] md:mt-6">
            {homeSectors.body}
          </Lede>
        </div>

        <Bento className="mt-12 md:mt-16">
          {homeSectors.items.map((item, index) => (
            <SectorCell key={item.serviceSlug} item={item} span={spans[index] ?? 'third'} lead={index === 0} />
          ))}
          <BentoCell span="half" tone="cinema" className="justify-center lg:col-span-4">
            <Heading as="h3" size="h3">
              {routing.title}
            </Heading>
            <p className="mt-3 max-w-[30rem] text-body-lg text-fg-muted">{routing.body}</p>
            <ChevronLink href={routing.link.href} className="mt-6">
              {routing.link.label}
            </ChevronLink>
          </BentoCell>
        </Bento>
      </Container>
    </Section>
  );
}
