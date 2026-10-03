/**
 * Copy for the 404 page and the error boundaries (src/app/not-found.tsx,
 * error.tsx and global-error.tsx). Small and client-safe: the error
 * boundaries are client components that Next loads with every page, so
 * errorPage carries its own copies of the two shell labels it needs (the
 * crest link's name, the contact page link) rather than importing
 * src/content/nav into every page's first-load script.
 */
import type { LinkItem } from './types';

export const notFoundPage = {
  /** The root template adds " | Itemba Group" once. */
  metaTitle: 'Page Not Found',
  eyebrow: 'Error 404',
  heading: 'Page not found',
  body: "The page you're looking for doesn't exist or may have been moved. Let's get you back on track.",
  home: { label: 'Back to home', href: '/' } satisfies LinkItem,
} as const;

export const errorPage = {
  /** global-error's own <title> (it replaces the root layout, so no template applies). */
  metaTitle: 'Something went wrong | Itemba Group',
  eyebrow: 'Error',
  heading: 'Something went wrong',
  body: 'This page could not be loaded just now. Try again, or go back to the home page.',
  retry: 'Try again',
  home: { label: 'Back to home', href: '/' } satisfies LinkItem,
  /** Before the error digest a visitor can quote. */
  reference: 'Reference',
  /** The group office (footerDirectory.contact.page). */
  contact: { label: 'Contact the group office', href: '/contact' } satisfies LinkItem,
  /** global-error's crest link (nav brandLabel). */
  brandLabel: 'Itemba Group home',
  /** Above the direct channels (global-error), which work even while the site does not. */
  channels: 'Or reach the group office directly',
  call: 'Call',
  whatsapp: 'WhatsApp',
  email: 'Email',
} as const;
