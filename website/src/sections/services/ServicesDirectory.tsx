import { companies, type Company } from '@/content/companies';
import type { MediaImage } from '@/content/media';
import { serviceAreas, serviceIcons, servicesPage, type ServiceArea } from '@/content/services';
import { companyUrl, serviceUrl } from '@/content/site';
import {
  Bento,
  BentoCell,
  Chevron,
  ChevronLink,
  Container,
  Eyebrow,
  Heading,
  Icon,
  Media,
  Reveal,
  Section,
  SmartLink,
  cn,
  keepCompounds,
  type BentoSpan,
} from '@/ui';

/** A stretched title link: the whole card is one target, named by the service. */
const stretchedLink =
  'after:absolute after:inset-0 after:rounded-tile focus-visible:outline-none focus-visible:after:outline focus-visible:after:outline-2 focus-visible:after:-outline-offset-2 focus-visible:after:outline-focus';

/** One company's cards share a row: one runs full width, two by halves, three by thirds. */
const spanFor = (count: number): BentoSpan => (count >= 3 ? 'third' : count === 2 ? 'half' : 'full');

/**
 * A service card: the sector's line icon in the company accent, the service
 * (one link, stretched over the card), the sentence that says what it is,
 * a short line of what it covers and "Learn more ›" (decorative: the link's
 * name is the title). The featured card runs full width with its
 * photograph beside the text from `md`, above it on phones.
 */
function ServiceCard({ service, span, photo }: { service: ServiceArea; span: BentoSpan; photo?: MediaImage }) {
  return (
    <BentoCell
      as="li"
      span={span}
      padding="none"
      className={cn('group transition-shadow duration-base ease-apple hover:shadow-card', photo && 'lg:flex-row')}
    >
      {photo ? (
        // Kept from the top (the canopy, its ITEMBA sign and the sky) in a
        // wide frame: about 5:3 beside the text from `lg`, 2:1 above it from
        // `sm`, 3:2 on phones. The bare forecourt at the foot is trimmed.
        <Reveal className="relative aspect-[3/2] sm:aspect-[2/1] lg:order-2 lg:aspect-auto lg:min-h-96 lg:w-3/5 lg:shrink-0">
          <Media
            media={photo}
            alt={photo.alt}
            fill
            position="top"
            sizes="(min-width: 1112px) 641px, (min-width: 1024px) calc((100vw - 44px) * 0.6), calc(100vw - 44px)"
          />
        </Reveal>
      ) : null}
      <div className={cn('flex flex-1 flex-col p-7 md:p-8', photo && 'lg:p-10')}>
        <Icon name={serviceIcons[service.visual]} size="lg" strokeWidth={1.4} className="text-accent" />
        <Heading as="h3" size="h3" className="mt-8 md:mt-10">
          <SmartLink href={serviceUrl(service.slug)} className={stretchedLink}>
            {keepCompounds(service.title)}
          </SmartLink>
        </Heading>
        <p className={cn('mt-3 text-body text-fg-muted', photo && 'md:text-body-lg')}>{keepCompounds(service.lede)}</p>
        <p className="mt-4 text-caption text-fg">{service.tags}</p>
        <span aria-hidden="true" className="mt-auto inline-flex items-center gap-[0.3em] pt-8 text-body text-gold-fg">
          {servicesPage.directory.cardAction}
          <Chevron />
        </span>
      </div>
    </BentoCell>
  );
}

/** One company and the services it runs, in its accent. */
function CompanyGroup({ company, services }: { company: Company; services: readonly ServiceArea[] }) {
  const { directory } = servicesPage;
  const titleId = `services-${company.slug}`;
  const span = spanFor(services.length);
  return (
    <div data-accent={company.accent}>
      <div className="flex flex-wrap items-end justify-between gap-x-8 gap-y-3">
        <div>
          <Eyebrow dot tone="gold">
            {company.sector}
          </Eyebrow>
          <Heading as="h2" id={titleId} size="h2" className="mt-2">
            {company.shortName}
          </Heading>
        </div>
        <ChevronLink href={companyUrl(company.slug)} tone="gold" className="md:mb-1">
          {`${directory.explore} ${company.shortName}`}
        </ChevronLink>
      </div>
      <Bento as="ul" className="mt-6 md:mt-8">
        {services.map((service) => (
          <ServiceCard
            key={service.slug}
            service={service}
            span={span}
            photo={service.slug === directory.feature.serviceSlug ? directory.feature.image : undefined}
          />
        ))}
      </Bento>
    </div>
  );
}

/**
 * The directory: every service, grouped under the company that runs it, so
 * the page answers its headline (find the service, meet the team behind
 * it) in one screen per company. Mwanjalisi Oil's one service runs full
 * width with the page's one photograph; Westsides' three and Itemba
 * Enterprises' two share their rows. The company names are the h2s, the
 * services their h3s. White cards on the alternate grey. As on home (a
 * group page), links and eyebrows are group gold and each company shows in
 * its dots and line icons only.
 */
export function ServicesDirectory() {
  return (
    <Section tone="alt" label={servicesPage.directory.label}>
      <Container className="space-y-16 md:space-y-24">
        {companies.map((company) => {
          const services = serviceAreas.filter((service) => service.companySlug === company.slug);
          return services.length ? <CompanyGroup key={company.slug} company={company} services={services} /> : null;
        })}
      </Container>
    </Section>
  );
}
