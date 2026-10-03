import { isPhoto, type Company } from '@/content/companies';
import { profilePdfHref } from '@/content/profile/cover';
import { servicePageCopy, siblingServices, type ServiceArea } from '@/content/services';
import { companyUrl, serviceUrl } from '@/content/site';
import { LeadPhoto } from '@/sections/company/LeadPhoto';
import { ChevronLink, Container, Eyebrow, FactList, Heading, Reveal, Section, TypePanel, keepCompounds } from '@/ui';
import { serviceSectionIds } from './ServiceSubNav';

/**
 * "The company behind it": the page's one cinema tile. The company's short
 * name as the h2, what it is in one sentence, its registered name and
 * incorporation (the facts a bank or partner looks for), the other
 * services it runs, then the ways on: its page, and its ready-made profile
 * as a PDF.
 *
 * Its visual leads on every screen (first on phones, on the left from
 * `lg`): a photograph the page shows nowhere else, square in a 440px
 * column (the WESTSIDES signboard), or a typographic panel on the raised
 * black where no such photograph is strong enough.
 */
export function ServiceCompany({ service, company }: { service: ServiceArea; company: Company }) {
  const copy = servicePageCopy.company;
  const visual = service.companyVisual;
  const siblings = siblingServices(service);
  return (
    <Section tone="cinema" accent={company.accent} id={serviceSectionIds.company} labelledBy="company-title">
      <Container className="grid items-center gap-10 md:gap-12 lg:grid-cols-[minmax(0,27.5rem)_minmax(0,1fr)] lg:gap-16">
        <div>
          <Eyebrow dot>{copy.eyebrow}</Eyebrow>
          <Heading as="h2" id="company-title" size="h1" className="mt-3">
            {company.shortName}
          </Heading>
          <p className="mt-5 max-w-[38rem] text-body-lg text-fg md:text-lede">{keepCompounds(company.overview.lead)}</p>
          <FactList
            layout="grid"
            className="mt-8 lg:grid-cols-2"
            items={[
              { key: 'name', term: copy.registeredName, detail: company.legalName },
              { key: 'incorporated', term: copy.incorporated, detail: company.legal.incorporationDate },
            ]}
          />
          {siblings.length ? (
            <>
              <h3 className="mt-10 text-eyebrow text-fg-muted">{`${copy.alsoFrom} ${company.shortName}`}</h3>
              <ul role="list" className="mt-2 border-t border-line">
                {siblings.map((sibling) => (
                  <li key={sibling.slug} className="border-b border-line">
                    <ChevronLink href={serviceUrl(sibling.slug)} size="body-lg" className="py-3">
                      {sibling.title}
                    </ChevronLink>
                  </li>
                ))}
              </ul>
            </>
          ) : null}
          <div className="mt-8 flex flex-wrap items-center gap-x-8 gap-y-3">
            <ChevronLink href={companyUrl(company.slug)}>{`${copy.explore} ${company.shortName}`}</ChevronLink>
            <ChevronLink href={profilePdfHref(company.id)} download>
              {`${copy.download} (${copy.downloadFormat})`}
            </ChevronLink>
          </div>
        </div>
        {isPhoto(visual) ? (
          <Reveal className="order-first mx-auto w-full max-w-md lg:mx-0 lg:max-w-none">
            <LeadPhoto photo={visual} shape="square" width="split" />
          </Reveal>
        ) : (
          <TypePanel
            icon={visual.icon}
            statement={visual.statement}
            caption={visual.caption}
            className="order-first mx-auto aspect-square w-full max-w-md lg:mx-0 lg:max-w-none"
          />
        )}
      </Container>
    </Section>
  );
}
