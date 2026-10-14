import type { ReactNode } from 'react';
import { getCompanyBySlug } from '@/content/companies';
import { findIntent } from '@/content/enquiry';
import { partnershipAreas, partnershipsPage, type PartnershipArea } from '@/content/partnerships';
import { getServiceBySlug } from '@/content/services';
import { companyUrl, serviceUrl } from '@/content/site';
import { ChevronLink, Container, Eyebrow, Heading, Icon, Section, SmartLink, cn, keepCompounds } from '@/ui';
import { partnershipsSectionIds as ids } from './ids';
import { routeAccent } from './routeAccent';

const { routes } = partnershipsPage;

type RelatedLink = { href: string; label: string };

/** A route's fact list: labels beside values, stacked on phones. */
function FactRow({ term, children }: { term: string; children: ReactNode }) {
  return (
    <div className="grid gap-1 border-b border-line py-3 sm:grid-cols-[6.5rem_minmax(0,1fr)] sm:gap-4">
      <dt className="text-caption text-fg-muted">{term}</dt>
      <dd className="text-caption text-fg">{children}</dd>
    </div>
  );
}

/** Links in a fact row, group gold as every link on the page. */
function LinkRow({ links }: { links: readonly RelatedLink[] }) {
  return (
    <ul role="list" className="flex flex-wrap gap-x-4 gap-y-1">
      {links.map((link) => (
        <li key={link.href}>
          <SmartLink href={link.href} className="text-gold-fg decoration-1 underline-offset-4 hover:underline">
            {link.label}
          </SmartLink>
        </li>
      ))}
    </ul>
  );
}

/**
 * A numbered route with audience on the left and operating ownership on
 * the right. The form starts on General, so each route names the option
 * to choose without adding client state.
 */
function RouteCard({ area, index }: { area: PartnershipArea; index: number }) {
  const intent = findIntent(area.intentId);
  const companies = area.companySlugs.flatMap((slug) => {
    const company = getCompanyBySlug(slug);
    return company ? [{ href: companyUrl(slug), label: company.shortName }] : [];
  });
  const services = area.serviceSlugs.flatMap((slug) => {
    const service = getServiceBySlug(slug);
    return service ? [{ href: serviceUrl(slug), label: service.shortTitle }] : [];
  });
  return (
    <li id={area.id} data-accent={routeAccent(area)} className="border-t border-line py-8 md:py-12">
      <article className="grid gap-8 lg:grid-cols-[minmax(0,6fr)_minmax(0,6fr)] lg:gap-16">
        <div>
          <div className="flex items-center gap-4">
            <span aria-hidden="true" className="text-h3 tabular-nums text-gold-fg">{String(index + 1).padStart(2, '0')}</span>
            <Icon name={area.icon} size="lg" strokeWidth={1.4} className="text-accent" />
          </div>
          <Heading as="h3" size="h2" className="mt-5">
            {area.title}
          </Heading>
          <p className="mt-3 text-body-lg text-fg-muted">{keepCompounds(area.summary)}</p>
          <h4 className="mt-8 text-eyebrow text-fg">{routes.goodFitLabel}</h4>
          <ul role="list" className="mt-2 space-y-1 text-body text-fg sm:space-y-0">
            {area.goodFit.map((fit, index) => (
              <li key={fit} className="sm:inline">
                {keepCompounds(fit)}
                {index < area.goodFit.length - 1 ? (
                  <span aria-hidden="true" className="hidden px-2 text-fg-muted sm:inline">·</span>
                ) : null}
              </li>
            ))}
          </ul>
        </div>
        <div className="flex flex-col">
          <dl className="border-t border-line">
            <FactRow term={routes.routedToPrefix}>{area.routeTo}</FactRow>
            <FactRow term={routes.companiesLabel}><LinkRow links={companies} /></FactRow>
            <FactRow term={routes.servicesLabel}><LinkRow links={services} /></FactRow>
          </dl>
          <div className="mt-auto flex flex-wrap items-center justify-between gap-x-6 gap-y-3 pt-8">
            <p className="flex flex-wrap items-center gap-x-2 text-caption text-fg-muted">
              {routes.formHint}
              <span className="inline-flex items-center gap-1.5 font-semibold text-fg">
                <span aria-hidden="true" className={cn('size-2 shrink-0 rounded-full', intent.id === 'general' ? 'bg-fg' : 'bg-accent')} />
                {intent.segmentLabel}
              </span>
            </p>
            <ChevronLink href={`#${ids.enquire}`} tone="gold" context={area.title}>{routes.action}</ChevronLink>
          </div>
        </div>
      </article>
    </li>
  );
}

/**
 * Four editorial rows on the warm canvas. Each route preserves its hero
 * shortcut anchor and its company and service links.
 */
export function PartnershipsRoutes() {
  return (
    <Section tone="alt" id={ids.routes} labelledBy="routes-title">
      <Container>
        <div className="max-w-[46rem]">
          <Eyebrow>{routes.eyebrow}</Eyebrow>
          <Heading as="h2" id="routes-title" size="h1" className="mt-2">
            {routes.title}
          </Heading>
        </div>
        <ol role="list" className="mt-10 border-b border-line md:mt-14">
          {partnershipAreas.map((area, index) => (
            <RouteCard key={area.id} area={area} index={index} />
          ))}
        </ol>
      </Container>
    </Section>
  );
}
