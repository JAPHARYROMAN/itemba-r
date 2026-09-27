import type { ReactNode } from 'react';
import { getCompanyBySlug } from '@/content/companies';
import { findIntent } from '@/content/enquiry';
import { partnershipAreas, partnershipsPage, type PartnershipArea } from '@/content/partnerships';
import { getServiceBySlug } from '@/content/services';
import { companyUrl, serviceUrl } from '@/content/site';
import { Card, ChevronLink, Container, Eyebrow, Heading, Icon, Section, SmartLink, cn, keepCompounds } from '@/ui';
import { partnershipsSectionIds as ids } from './ids';
import { routeAccent } from './routeAccent';

const { routes } = partnershipsPage;

type RelatedLink = { href: string; label: string };

/** A row of the card's fact list: a label beside its value (stacked on phones). */
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
 * One partnership route as a card: its line icon (in the accent of the
 * company its enquiry goes to), the title and who it is for; then a short
 * fact list (where it is routed, and the companies and services behind it);
 * and at the foot, the enquiry type to choose in the form below, beside the
 * jump to it. The page is static and the form opens on the general route,
 * so the card names the option rather than preselecting it, marked as the
 * form marks it: ink for the group office, the company accent otherwise.
 */
function RouteCard({ area }: { area: PartnershipArea }) {
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
    <li id={area.id} data-accent={routeAccent(area)} className="flex">
      <Card as="article" padding="none" className="flex w-full flex-col p-7 md:p-10">
        <Icon name={area.icon} size="lg" strokeWidth={1.4} className="text-accent" />
        <Heading as="h3" size="h3" className="mt-8">
          {area.title}
        </Heading>
        <p className="mt-3 text-body text-fg-muted">{keepCompounds(area.summary)}</p>

        <h4 className="mt-8 text-eyebrow text-fg">{routes.goodFitLabel}</h4>
        {/*
         * One audience per line on phones; from `sm` one running line, the
         * audiences set apart by quiet middots, as Apple lists a spec.
         */}
        <ul role="list" className="mt-2 space-y-1 text-body text-fg sm:space-y-0">
          {area.goodFit.map((fit, index) => (
            <li key={fit} className="sm:inline">
              {keepCompounds(fit)}
              {index < area.goodFit.length - 1 ? (
                <span aria-hidden="true" className="hidden px-2 text-fg-muted sm:inline">
                  ·
                </span>
              ) : null}
            </li>
          ))}
        </ul>

        <dl className="mt-8 border-t border-line">
          <FactRow term={routes.routedToPrefix}>{area.routeTo}</FactRow>
          <FactRow term={routes.companiesLabel}>
            <LinkRow links={companies} />
          </FactRow>
          <FactRow term={routes.servicesLabel}>
            <LinkRow links={services} />
          </FactRow>
        </dl>

        <div className="mt-auto flex flex-wrap items-center justify-between gap-x-6 gap-y-3 pt-8">
          <p className="flex flex-wrap items-center gap-x-2 text-caption text-fg-muted">
            {routes.formHint}
            <span className="inline-flex items-center gap-1.5 font-semibold text-fg">
              <span aria-hidden="true" className={cn('size-2 shrink-0 rounded-full', intent.id === 'general' ? 'bg-fg' : 'bg-accent')} />
              {intent.segmentLabel}
            </span>
          </p>
          <ChevronLink href={`#${ids.enquire}`} tone="gold" context={area.title}>
            {routes.action}
          </ChevronLink>
        </div>
      </Card>
    </li>
  );
}

/**
 * "Start with the right operating team": the four partnership routes, two
 * by two from `md`, white cards on the alternate grey. Each card is the
 * target of its hero shortcut.
 */
export function PartnershipsRoutes() {
  return (
    <Section tone="alt" id={ids.routes} labelledBy="routes-title">
      <Container>
        <div className="mx-auto max-w-prose text-center">
          <Eyebrow>{routes.eyebrow}</Eyebrow>
          <Heading as="h2" id="routes-title" size="h1" className="mt-2">
            {routes.title}
          </Heading>
        </div>
        <ul role="list" className="mt-10 grid gap-3 md:mt-16 md:grid-cols-2 md:gap-4">
          {partnershipAreas.map((area) => (
            <RouteCard key={area.id} area={area} />
          ))}
        </ul>
      </Container>
    </Section>
  );
}
