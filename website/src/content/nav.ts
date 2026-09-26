/**
 * Navigation and shell copy: the global nav, the mobile menu sheet, the
 * quick-contact bar and the footer directory.
 *
 * Small and client-safe: the SiteNav and QuickContact islands import it. The
 * footer's company, service and location links come from their own content
 * modules (read by the server SiteFooter), so no name is repeated here.
 */
import type { LinkItem } from './types';

/** Global nav (plan): Group, Companies, Services, Locations, Insights, Profile, Contact + the Enquire pill. */
export const headerLinks: LinkItem[] = [
  { href: '/about', label: 'Group' },
  { href: '/companies', label: 'Companies' },
  { href: '/services', label: 'Services' },
  { href: '/locations', label: 'Locations' },
  { href: '/insights', label: 'Insights' },
  { href: '/company-profile', label: 'Profile' },
  { href: '/contact', label: 'Contact' },
];

/** The persistent Enquire pill: the full enquiry router on /partnerships. */
export const headerCta: LinkItem = { href: '/partnerships', label: 'Enquire' };

/** Accessible name of every crest link to the home page. */
export const brandLabel = 'Itemba Group home';

/** Shell copy: the skip link, the nav landmark and the mobile menu controls. */
export const shellCopy = {
  skipLink: 'Skip to content',
  navLabel: 'Primary',
  menuOpen: 'Menu',
  menuClose: 'Close menu',
} as const;

/**
 * The mobile quick-contact bar (Call · WhatsApp · Enquire). "Enquire" is the
 * email action, so its accessible name adds `enquireContext`.
 */
export const quickContactCopy = {
  label: 'Quick contact',
  call: 'Call',
  whatsapp: 'WhatsApp',
  enquire: 'Enquire',
  enquireContext: 'by email',
} as const;

/** The footer directory: five columns, as on Apple's footer. */
export const footerDirectory = {
  label: 'Site directory',
  group: {
    title: 'Group',
    links: [
      { label: 'About Itemba Group', href: '/about' },
      { label: 'Capabilities', href: '/capabilities' },
      { label: 'Partnerships', href: '/partnerships' },
      { label: 'Locations', href: '/locations' },
    ],
  },
  companies: {
    title: 'Companies',
    overview: { label: 'All companies', href: '/companies' },
  },
  services: {
    title: 'Services',
    overview: { label: 'All services', href: '/services' },
  },
  resources: {
    title: 'Resources',
    links: [
      { label: 'Insights', href: '/insights' },
      { label: 'Company Profile', href: '/company-profile' },
      { label: 'FAQ', href: '/faq' },
    ],
  },
  contact: {
    title: 'Contact',
    page: { label: 'Contact the group office', href: '/contact' },
    call: 'Call',
    whatsapp: 'WhatsApp',
    email: 'Email',
    directions: 'Get directions',
    /** Screen-reader note on links that open a new tab. */
    newTab: '(opens in a new tab)',
  },
} as const;

export const footerCopy = {
  /** Follows the three company names: "A, B and C are …". */
  companiesNote:
    'are legally independent companies of Itemba Group. One group office routes every enquiry to the right company.',
  reachUs: {
    lead: 'More ways to reach us:',
    visit: 'visit the group office at',
    call: 'call',
    email: 'or email',
  },
  /** "Copyright © <year> Itemba Group. All rights reserved." */
  copyright: 'Copyright ©',
  rightsReserved: 'All rights reserved.',
} as const;
