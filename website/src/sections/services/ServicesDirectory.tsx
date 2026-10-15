import { companies, type Company } from '@/content/companies';
import { serviceAreas, serviceIcons, servicesPage, type ServiceArea } from '@/content/services';
import { companyUrl, serviceUrl } from '@/content/site';
import { Chevron, ChevronLink, Container, Eyebrow, Heading, Icon, Media, Section, SmartLink, keepCompounds } from '@/ui';

function ServiceRow({ service, index }: { service: ServiceArea; index: number }) {
  const photo = service.slug === servicesPage.directory.feature.serviceSlug ? servicesPage.directory.feature.image : undefined;
  return (
    <li className="group relative border-t border-line py-7 first:border-t-0 md:py-8">
      {photo ? <Media media={photo} alt={photo.alt} sizes="(min-width: 1280px) 720px, (min-width: 1024px) 60vw, calc(100vw - 44px)" aspect="2/1" className="mb-7 overflow-hidden rounded-card" /> : null}
      <div className="flex items-start gap-4 md:gap-5">
        <span aria-hidden="true" className="pt-1 text-caption tabular-nums text-accent-fg">{String(index + 1).padStart(2, '0')}</span>
        <div className="min-w-0 flex-1">
          <Heading as="h3" size="h3">
            <SmartLink href={serviceUrl(service.slug)} className="after:absolute after:inset-0 focus-visible:outline-none focus-visible:after:outline focus-visible:after:outline-2 focus-visible:after:outline-focus">{keepCompounds(service.title)}</SmartLink>
          </Heading>
          <p className="mt-3 max-w-xl text-body-lg text-fg-muted">{keepCompounds(service.lede)}</p>
          <p className="mt-4 text-caption text-fg">{service.tags}</p>
          <span aria-hidden="true" className="mt-5 inline-flex items-center gap-2 text-body text-accent-fg">{servicesPage.directory.cardAction}<Chevron /></span>
        </div>
        <Icon name={serviceIcons[service.visual]} size="md" className="mt-1 shrink-0 text-accent" />
      </div>
    </li>
  );
}

function CompanyGroup({ company, services }: { company: Company; services: readonly ServiceArea[] }) {
  return (
    <div data-accent={company.accent} className="grid gap-8 border-t border-line pt-10 lg:grid-cols-[minmax(0,1fr)_minmax(0,2fr)] lg:gap-16 md:pt-12">
      <div>
        <Eyebrow dot>{company.sector}</Eyebrow>
        <Heading as="h2" id={`services-${company.slug}`} size="h2" className="mt-4">{company.shortName}</Heading>
        <ChevronLink href={companyUrl(company.slug)} className="mt-6">{`${servicesPage.directory.explore} ${company.shortName}`}</ChevronLink>
      </div>
      <ul role="list">
        {services.map((service, index) => <ServiceRow key={service.slug} service={service} index={index} />)}
      </ul>
    </div>
  );
}

export function ServicesDirectory() {
  return (
    <Section tone="alt" label={servicesPage.directory.label}>
      <Container className="space-y-12 md:space-y-16">
        {companies.map((company) => {
          const services = serviceAreas.filter((service) => service.companySlug === company.slug);
          return services.length ? <CompanyGroup key={company.slug} company={company} services={services} /> : null;
        })}
      </Container>
    </Section>
  );
}