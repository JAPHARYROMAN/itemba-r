/**
 * Navigation: the global header links and the footer's link groups and copy.
 * Small and client-safe (the legacy client Navbar imports it; the rebuilt
 * SiteHeader passes links to its island as props).
 */
import type { LinkItem } from './types';

/** Legacy header order (origin/main Navbar). */
export const legacyHeaderLinks: LinkItem[] = [
  { href: '/', label: 'Home' },
  { href: '/about', label: 'About' },
  { href: '/services', label: 'Services' },
  { href: '/companies', label: 'Companies' },
  { href: '/locations', label: 'Location' },
  { href: '/partnerships', label: 'Partnerships' },
  { href: '/company-profile', label: 'Profile' },
  { href: '/contact', label: 'Contact' },
];

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

export const headerCta: LinkItem = { href: '/partnerships', label: 'Enquire' };

export const brandLabel = 'Itemba Group home';

/** Footer "Group" column (services, locations and companies columns come from their content modules). */
export const footerGroupLinks: LinkItem[] = [
  { label: 'Home', href: '/' },
  { label: 'About', href: '/about' },
  { label: 'Capabilities', href: '/capabilities' },
  { label: 'Partnerships', href: '/partnerships' },
  { label: 'Insights', href: '/insights' },
  { label: 'Company Profile', href: '/company-profile' },
  { label: 'FAQ', href: '/faq' },
  { label: 'Contact', href: '/contact' },
];

export const footerLegalLinks: LinkItem[] = [
  { label: 'Company Profile', href: '/company-profile' },
  { label: 'FAQ', href: '/faq' },
  { label: 'Contact', href: '/contact' },
];

export const footerCopy = {
  cta: {
    title: 'Ready to talk to Itemba Group?',
    body: 'Fuel, trade, logistics, hospitality and more across the Tanzania–Zambia corridor — reach the group office directly.',
    call: 'Call',
    whatsapp: 'WhatsApp',
    email: 'Email us',
  },
  tagline:
    "Tanzania's diversified business group — three independent companies, six sectors, one unified vision on the southern corridor.",
  headOfficeLabel: 'Head office',
  directions: 'Get directions',
  columns: {
    group: 'Group',
    companies: 'Companies',
    services: 'Services',
    locations: 'Locations',
  },
  /** "© <year> Itemba Group. All rights reserved." */
  rightsReserved: 'All rights reserved.',
} as const;
