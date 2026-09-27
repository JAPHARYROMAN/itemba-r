import { companies, getCompanyBySlug } from '@/content/companies';
import { insightPageCopy, type InsightArticle } from '@/content/insights';
import { locationProfiles } from '@/content/locations';
import { crumbs } from '@/content/nav';
import { serviceAreas } from '@/content/services';
import { companyUrl, locationUrl, serviceUrl } from '@/content/site';
import { ButtonLink, Chevron, ChevronLink, Container, Heading, Lede, Section, SmartLink, keepCompounds } from '@/ui';

type RelatedLink = { href: string; name: string; detail: string };

/**
 * One column of related pages: a small label, then hairline rows, each one
 * link (the page's name, a quiet line under it and a chevron), at least
 * 44px tall.
 */
function RelatedList({ id, title, links }: { id: string; title: string; links: readonly RelatedLink[] }) {
  if (!links.length) return null;
  return (
    <div>
      <h3 id={id} className="text-eyebrow text-fg-muted">
        {title}
      </h3>
      <ul role="list" aria-labelledby={id} className="mt-3 border-b border-line">
        {links.map((link) => (
          <li key={link.href} className="border-t border-line">
            <SmartLink
              href={link.href}
              className="group flex min-h-11 items-center justify-between gap-4 py-4 decoration-1 underline-offset-4 focus-visible:outline-offset-2"
            >
              <span>
                <span className="block text-body-lg font-semibold text-fg group-hover:underline">{keepCompounds(link.name)}</span>
                <span className="mt-0.5 block text-caption text-fg-muted">{keepCompounds(link.detail)}</span>
              </span>
              <Chevron className="text-gold-fg" />
            </SmartLink>
          </li>
        ))}
      </ul>
    </div>
  );
}

/**
 * "Continue from this guide", on the alternate grey after the article: the
 * guide's next step (the page's one pill; a general enquiry lands on the
 * form below) and the way back to every insight, then the services,
 * companies and place the guide covers.
 */
export function InsightContinue({ article }: { article: InsightArticle }) {
  const copy = insightPageCopy;
  // Short names, as on home: the registered forms stay on the company pages.
  const services = serviceAreas
    .filter((service) => article.serviceSlugs.includes(service.slug))
    .map((service) => ({
      href: serviceUrl(service.slug),
      name: service.title,
      detail: getCompanyBySlug(service.companySlug)?.shortName ?? service.companyName,
    }));
  const related = companies
    .filter((company) => article.companySlugs.includes(company.slug))
    .map((company) => ({ href: companyUrl(company.slug), name: company.shortName, detail: company.eyebrow }));
  const places = locationProfiles
    .filter((location) => article.locationSlugs.includes(location.slug))
    .map((location) => ({ href: locationUrl(location.slug), name: location.shortTitle, detail: location.eyebrow }));

  return (
    <Section tone="alt" labelledBy="continue-title">
      <Container>
        <div className="max-w-[40rem]">
          <Heading as="h2" id="continue-title" size="h1">
            {copy.continueCta.title}
          </Heading>
          <Lede tone="muted" className="mt-5">
            {copy.continueCta.body}
          </Lede>
          <div className="mt-8 flex flex-wrap items-center gap-x-8 gap-y-4">
            <ButtonLink href={article.cta.href} size="lg">
              {article.cta.label}
            </ButtonLink>
            <ChevronLink href={crumbs.insights.path} size="body-lg">
              {copy.continueCta.moreLabel}
            </ChevronLink>
          </div>
        </div>

        <div className="mt-14 grid gap-10 md:mt-16 md:grid-cols-3 md:gap-8">
          <RelatedList id="related-services" title={copy.relatedServices} links={services} />
          <RelatedList id="related-companies" title={copy.relatedCompanies} links={related} />
          <RelatedList id="related-location" title={copy.relatedLocation} links={places} />
        </div>
      </Container>
    </Section>
  );
}
