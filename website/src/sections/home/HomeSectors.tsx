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
  cn,
  type BentoSpan,
} from '@/ui';

/**
 * The bento's shape on the six-column grid (lg):
 *   energy (2/3, with its photograph) · trade (1/3)
 *   logistics · construction · hospitality (1/3 each)
 *   real estate (1/3) · the routing promise (2/3, black)
 * From `md` to `lg` the cells pair up two by two. Phones get a compact
 * two-column grid: icon, sector and the company that runs it, each card one
 * link, and no photograph; the routing promise spans both columns.
 * Only the lead cell carries a photograph, and it is not one the company
 * tiles above or the company pages show; Itemba Estate stays a
 * typographic tile (flags.estateImagery).
 */
const spans: readonly BentoSpan[] = ['two-thirds', 'third', 'third', 'third', 'third', 'third'];

/** A stretched title link: the whole cell is one target named by the sector. */
const stretchedLink =
  'after:absolute after:inset-0 after:rounded-tile focus-visible:outline-none focus-visible:after:outline focus-visible:after:outline-2 focus-visible:after:-outline-offset-2 focus-visible:after:outline-focus';

function SectorCell({ item, span, lead }: { item: HomeSector; span: BentoSpan; lead: boolean }) {
  const service = getServiceBySlug(item.serviceSlug);
  const company = service ? getCompanyBySlug(service.companySlug) : undefined;
  const text = (
    <div className="flex flex-1 flex-col p-5 md:p-8">
      <Icon name={item.icon} size="md" strokeWidth={1.4} className="text-accent md:size-8" />
      <Heading as="h3" size="h3" className="mt-4 max-md:text-body-lg max-md:font-semibold md:mt-10">
        <SmartLink href={serviceUrl(item.serviceSlug)} className={stretchedLink}>
          {item.name}
        </SmartLink>
      </Heading>
      {company ? (
        <p className="mt-1.5 flex items-center gap-2 text-caption text-fg-muted md:mt-2">
          <span aria-hidden="true" className="size-1.5 shrink-0 rounded-full bg-accent" />
          {homeSectors.runBy} {company.shortName}
        </p>
      ) : null}
      <span aria-hidden="true" className="mt-auto hidden items-center gap-[0.3em] pt-8 text-body text-accent-fg md:inline-flex">
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
      className={cn('group transition-shadow duration-base ease-apple hover:shadow-card', lead && 'md:flex-row')}
    >
      {text}
      {lead ? (
        <Reveal className="relative hidden md:block md:w-1/2 md:shrink-0">
          <Media
            media={item.image}
            alt={item.image.alt}
            fill
            sizes="(min-width: 1112px) 356px, (min-width: 1024px) calc((100vw - 44px) / 3), 50vw"
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
          <Heading as="h2" id="sectors-title" size="h1" className="mt-2">
            {homeSectors.title}
          </Heading>
          <Lede tone="muted" className="mx-auto mt-5 max-w-[40rem] md:mt-6">
            {homeSectors.body}
          </Lede>
        </div>

        <Bento phoneColumns={2} className="mt-10 md:mt-16">
          {homeSectors.items.map((item, index) => (
            <SectorCell key={item.serviceSlug} item={item} span={spans[index] ?? 'third'} lead={index === 0} />
          ))}
          <BentoCell span="half" tone="cinema" className="col-span-2 justify-center lg:col-span-4">
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
