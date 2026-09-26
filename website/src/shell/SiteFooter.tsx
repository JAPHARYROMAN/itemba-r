import Link from 'next/link';
import { companies } from '@/content/companies';
import { contact, contactActionLabels, mailtoWithSubject, mapsDirectionsUrl, telHref } from '@/content/contact';
import { businessEnquirySubject } from '@/content/enquiry';
import { locationProfiles } from '@/content/locations';
import { brandLabel, footerCopy, footerDirectory } from '@/content/nav';
import { serviceAreas } from '@/content/services';
import { companyUrl, locationUrl, serviceUrl, site } from '@/content/site';
import { VisuallyHidden } from '@/ui/a11y';
import { SmartLink } from '@/ui/actions';
import { Breadcrumbs, type BreadcrumbItem } from '@/ui/Breadcrumbs';
import { cn } from '@/ui/cn';
import { Icon } from '@/ui/Icon';
import { Container } from '@/ui/layout';
import { Crest } from './Crest';

type FooterLink = {
  label: string;
  href: string;
  /** Accessible name when the visible label is short ("Call" → "Call Itemba Group"). */
  ariaLabel?: string;
  /** Opens in a new tab (the map directions). */
  external?: boolean;
};

type FooterColumn = { id: string; title: string; links: FooterLink[] };

/** The five directory columns: Group · Companies · Services · Resources · Contact. */
function directory(): FooterColumn[] {
  const { group, companies: companiesColumn, services, resources, contact: contactColumn } = footerDirectory;
  return [
    {
      id: 'group',
      title: group.title,
      links: [
        ...group.links,
        ...locationProfiles.map((location) => ({ label: location.shortTitle, href: locationUrl(location.slug) })),
      ],
    },
    {
      id: 'companies',
      title: companiesColumn.title,
      links: [companiesColumn.overview, ...companies.map((company) => ({ label: company.shortName, href: companyUrl(company.slug) }))],
    },
    {
      id: 'services',
      title: services.title,
      links: [services.overview, ...serviceAreas.map((service) => ({ label: service.shortTitle, href: serviceUrl(service.slug) }))],
    },
    { id: 'resources', title: resources.title, links: [...resources.links] },
    {
      id: 'contact',
      title: contactColumn.title,
      links: [
        contactColumn.page,
        { label: contactColumn.call, href: telHref(contact.primaryPhone), ariaLabel: contactActionLabels.call },
        { label: contactColumn.whatsapp, href: contact.whatsapp, ariaLabel: contactActionLabels.whatsappFooter },
        { label: contactColumn.email, href: mailtoWithSubject(businessEnquirySubject), ariaLabel: contactActionLabels.email },
        { label: contactColumn.directions, href: mapsDirectionsUrl(), external: true },
      ],
    },
  ];
}

function DirectoryLink({ link, className }: { link: FooterLink; className: string }) {
  const classes = cn(
    'text-fg/80 transition-colors duration-fast ease-apple hover:text-fg hover:underline hover:underline-offset-2',
    className,
  );
  if (link.external) {
    return (
      <a href={link.href} target="_blank" rel="noopener noreferrer" className={classes}>
        <span>{link.label}</span>
        <Icon name="arrow-up-right" size="em" className="ml-0.5" />
        <VisuallyHidden> {footerDirectory.contact.newTab}</VisuallyHidden>
      </a>
    );
  }
  return (
    <SmartLink href={link.href} aria-label={link.ariaLabel} className={classes}>
      {link.label}
    </SmartLink>
  );
}

/** "A, B and C". */
const listFormat = new Intl.ListFormat('en-GB', { style: 'long', type: 'conjunction' });

const inlineLink = 'text-fg/80 underline decoration-fg/30 underline-offset-2 transition-colors duration-fast hover:text-fg hover:decoration-fg';

/**
 * The global footer, Apple-dense: 12px type on the #f5f5f7 alt tile.
 *
 * 1. The crest and the group's structure in one line.
 * 2. The directory: five columns from `md`; below it, disclosure rows built
 *    on <details> (no JS), as on Apple's phone footer.
 * 3. "More ways to reach us", with the head office, phone and email.
 * 4. The legal line: © Itemba Group · www.itembagrouptz.com.
 *
 * A page's breadcrumbs sit above it (FooterTrail). Every contact href comes
 * from src/content/contact.ts, in the forms ConversionTracker classifies.
 * `.site-footer` is hidden in print (src/styles/print.css).
 */
export function SiteFooter() {
  const columns = directory();
  const { reachUs } = footerCopy;
  const year = new Date().getFullYear();

  return (
    <footer data-tone="alt" className="site-footer text-legal text-fg-muted">
      <Container size="content" className="pb-6 pt-5 md:pb-5">
        <div className="flex flex-col gap-3 border-b border-line pb-4 md:flex-row md:items-center md:gap-8">
          <Link href="/" aria-label={brandLabel} className="-ml-1 flex h-11 w-fit shrink-0 items-center px-1">
            <Crest />
          </Link>
          <p className="max-w-[46rem]">
            {listFormat.format(companies.map((company) => company.name))} {footerCopy.companiesNote}
          </p>
        </div>

        <nav aria-label={footerDirectory.label}>
          <div className="hidden gap-x-6 pb-2 pt-6 md:grid md:grid-cols-5">
            {columns.map((column) => (
              <div key={column.id}>
                <h2 className="mb-1.5 font-semibold text-fg">{column.title}</h2>
                <ul>
                  {column.links.map((link) => (
                    <li key={link.href} className="mb-0.5">
                      <DirectoryLink link={link} className="inline-flex min-h-6 items-center" />
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>

          <div className="md:hidden">
            {columns.map((column) => (
              <details key={column.id} className="group border-b border-line">
                <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-4 font-semibold text-fg [&::-webkit-details-marker]:hidden">
                  {column.title}
                  <Icon
                    name="chevron-down"
                    size="xs"
                    strokeWidth={1.8}
                    className="text-fg-muted transition-transform duration-base ease-apple group-open:rotate-180"
                  />
                </summary>
                <ul className="pb-2 pl-3">
                  {column.links.map((link) => (
                    <li key={link.href}>
                      <DirectoryLink link={link} className="flex min-h-11 items-center" />
                    </li>
                  ))}
                </ul>
              </details>
            ))}
          </div>
        </nav>

        <address className="py-4 not-italic md:pb-3 md:pt-8">
          {reachUs.lead} {reachUs.visit} {contact.headOffice}, {reachUs.call}{' '}
          <a href={telHref(contact.primaryPhone)} className={inlineLink}>
            {contact.primaryPhoneDisplay}
          </a>
          , {reachUs.email}{' '}
          <a href={mailtoWithSubject(businessEnquirySubject)} className={inlineLink}>
            {contact.email}
          </a>
          .
        </address>

        <div className="flex flex-col gap-1 border-t border-line pt-3 md:flex-row md:items-center md:justify-between md:gap-6">
          <p>
            {footerCopy.copyright} {year} {site.name}. {footerCopy.rightsReserved}
          </p>
          <p>{site.domain}</p>
        </div>
      </Container>
    </footer>
  );
}

/**
 * A page's breadcrumb trail, drawn as the footer's top row (Apple puts the
 * breadcrumbs at the top of the footer). A layout cannot read the page's
 * trail, so each inner page renders this as the LAST element of its content,
 * directly above SiteFooter; it shares the footer's tile, width and type.
 * The visible trail and the BreadcrumbList JSON-LD come from the same items
 * (src/ui/Breadcrumbs.tsx), so a page renders one FooterTrail and no other
 * BreadcrumbList.
 */
export function FooterTrail({ items }: { items: readonly BreadcrumbItem[] }) {
  return (
    <div data-tone="alt" data-print="hide">
      <Container size="content">
        <div className="border-b border-line py-1 md:py-1.5">
          <Breadcrumbs items={items} size="legal" />
        </div>
      </Container>
    </div>
  );
}
