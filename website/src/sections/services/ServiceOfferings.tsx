import type { Company } from '@/content/companies';
import { servicePageCopy, type ServiceArea } from '@/content/services';
import { serviceUrl } from '@/content/site';
import { ChevronLink, Container, Eyebrow, Heading, Icon, Section, Stat, keepCompounds } from '@/ui';
import { serviceSectionIds } from './ServiceSubNav';

export function ServiceOfferings({ service, company }: { service: ServiceArea; company: Company }) {
  const copy = servicePageCopy;
  return (
    <Section tone="alt" accent={company.accent} id={serviceSectionIds.offerings} labelledBy="offerings-title">
      <Container>
        <div className="grid gap-10 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)] lg:gap-20">
          <div>
            <Eyebrow dot>{company.shortName}</Eyebrow>
            <Heading as="h2" id="offerings-title" size="h1" className="mt-4">{copy.offeringsHeading}</Heading>
            <p className="mt-6 max-w-2xl text-lede text-fg-muted">{keepCompounds(service.overview)}</p>
          </div>
          <div className="border-t border-line pt-6 lg:border-l lg:border-t-0 lg:pl-10 lg:pt-0">
            {service.keyStat ? (
              <>
                <Eyebrow>{copy.keyFigure}</Eyebrow>
                <dl className="mt-5"><Stat value={service.keyStat.value} label={service.keyStat.label} size="display" tone="accent" /></dl>
              </>
            ) : null}
            <h3 className={service.keyStat ? 'mt-8 text-eyebrow text-fg-muted' : 'text-eyebrow text-fg-muted'}>{copy.audienceLabel}</h3>
            <ul role="list" className="mt-4 space-y-2">
              {service.audience.map((audience) => <li key={audience} className="text-body text-fg">{keepCompounds(audience)}</li>)}
            </ul>
          </div>
        </div>
        <div className="mt-12 divide-y divide-line border-y border-line md:mt-16">
          {service.features.map((feature, index) => (
            <article key={feature.title} className="grid gap-5 py-7 md:grid-cols-[3rem_minmax(0,1fr)_minmax(0,1.3fr)] md:gap-8 md:py-9">
              <span aria-hidden="true" className="text-caption tabular-nums text-accent-fg">{String(index + 1).padStart(2, '0')}</span>
              <div className="flex items-start gap-4">
                <Icon name={feature.icon} size="md" className="mt-1 shrink-0 text-accent" />
                <Heading as="h3" size="h3">{feature.title}</Heading>
              </div>
              <div>
                <p className="max-w-xl text-body-lg text-fg-muted">{keepCompounds(feature.body)}</p>
                {feature.serviceSlug ? <ChevronLink href={serviceUrl(feature.serviceSlug)} context={feature.title} className="mt-4">{copy.featureAction}</ChevronLink> : null}
              </div>
            </article>
          ))}
        </div>
      </Container>
    </Section>
  );
}