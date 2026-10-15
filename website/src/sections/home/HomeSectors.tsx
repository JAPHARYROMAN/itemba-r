import { getCompanyBySlug } from '@/content/companies';
import { homeSectors } from '@/content/home';
import { getServiceBySlug } from '@/content/services';
import { serviceUrl } from '@/content/site';
import { Chevron, ChevronLink, Container, Eyebrow, Heading, Icon, Section, SmartLink } from '@/ui';

export function HomeSectors() {
  return (
    <Section tone="cinema" labelledBy="sectors-title">
      <Container>
        <div className="grid gap-6 lg:grid-cols-2 lg:gap-20">
          <div><Eyebrow>{homeSectors.eyebrow}</Eyebrow><Heading as="h2" id="sectors-title" size="display" className="mt-3">{homeSectors.title}</Heading></div>
          <p className="max-w-lg self-end text-body-lg text-fg-muted">{homeSectors.body}</p>
        </div>
        <ul className="mt-12 grid gap-x-14 md:grid-cols-2">
          {homeSectors.items.map((item) => {
            const service = getServiceBySlug(item.serviceSlug);
            const company = service ? getCompanyBySlug(service.companySlug) : undefined;
            return <li key={item.serviceSlug} data-accent={company?.accent} className="border-t border-line">
              <SmartLink href={serviceUrl(item.serviceSlug)} className="group flex min-h-[120px] items-center gap-5 py-6">
                <Icon name={item.icon} size="md" className="shrink-0 text-accent" />
                <div className="flex-1"><Heading as="h3" size="h4">{item.name}</Heading><p className="mt-2 text-caption text-fg-muted">{homeSectors.runBy} {company?.shortName}</p></div>
                <Chevron className="text-accent-fg transition-transform group-hover:translate-x-1" />
              </SmartLink>
            </li>;
          })}
        </ul>
        <div className="mt-8 flex flex-col gap-6 border-t border-line pt-8 md:flex-row md:items-center md:justify-between">
          <p className="text-body-lg text-fg-muted">{homeSectors.routing.body}</p>
          <ChevronLink href={homeSectors.routing.link.href}>{homeSectors.routing.link.label}</ChevronLink>
        </div>
      </Container>
    </Section>
  );
}
