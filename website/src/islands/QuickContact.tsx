'use client';

import { usePathname } from 'next/navigation';
import { contact, contactActionLabels, mailtoWithSubject, telHref } from '@/content/contact';
import { businessEnquirySubject } from '@/content/enquiry';
import { quickContactCopy as copy } from '@/content/nav';
import { buttonClasses } from '@/ui/actions';
import { cn } from '@/ui/cn';
import { Icon } from '@/ui/Icon';

/**
 * Routes with an inline enquiry form, where the bar would only repeat it.
 * The same matrix as origin/main's floating QuickContact (the baseline
 * records it per route; tests/e2e/quick-contact.spec.ts holds it).
 */
export function hasInlineEnquiry(pathname: string) {
  return (
    pathname === '/contact' ||
    pathname === '/company-profile' ||
    pathname === '/capabilities' ||
    pathname === '/partnerships' ||
    pathname === '/faq' ||
    pathname.startsWith('/companies/') ||
    pathname.startsWith('/services/') ||
    pathname.startsWith('/locations/') ||
    pathname.startsWith('/insights/')
  );
}

const quietAction =
  'inline-flex min-h-11 items-center gap-2 rounded-pill px-3 text-caption font-medium text-fg transition-colors duration-fast ease-apple hover:bg-surface-alt';

/**
 * The mobile quick-contact bar: a slim bar fixed to the bottom of the
 * screen with Call, WhatsApp and an Email pill (it opens the mail app, so
 * it is not labelled "Enquire", which everywhere else leads to the form).
 * It shows below `md` only (the global nav's Enquire pill and the footer
 * serve larger screens).
 *
 * The hrefs are exactly origin/main's: `tel:` (primary line), the prepared
 * `wa.me/` message and the "Business enquiry" `mailto:`, which
 * ConversionTracker classifies as phone, WhatsApp and email clicks.
 * `data-quick-contact` marks it for the e2e harness. A spacer in the page
 * flow, painted like the footer, keeps the bar from covering the last line
 * of the page.
 */
export default function QuickContact() {
  const pathname = usePathname() ?? '/';
  if (hasInlineEnquiry(pathname)) return null;

  return (
    <>
      <div aria-hidden="true" data-print="hide" className="h-[calc(var(--quickbar-height)+env(safe-area-inset-bottom))] bg-surface-alt md:hidden" />
      <aside
        aria-label={copy.label}
        data-quick-contact=""
        data-print="hide"
        className="fixed inset-x-0 bottom-0 z-quick-bar border-t border-line bg-surface pb-[env(safe-area-inset-bottom)] md:hidden"
      >
        <div className="mx-auto flex h-quickbar max-w-content items-center gap-1 px-gutter">
          <a href={telHref(contact.primaryPhone)} aria-label={contactActionLabels.call} className={cn(quietAction, '-ml-3')}>
            <Icon name="phone" size="sm" />
            <span>{copy.call}</span>
          </a>
          <a href={contact.whatsapp} aria-label={contactActionLabels.whatsapp} className={quietAction}>
            <Icon name="whatsapp" size="sm" />
            <span>{copy.whatsapp}</span>
          </a>
          <a
            href={mailtoWithSubject(businessEnquirySubject)}
            aria-label={contactActionLabels.email}
            className={cn(buttonClasses({ size: 'sm' }), 'ml-auto')}
          >
            <Icon name="mail" size="xs" />
            <span>{copy.email}</span>
          </a>
        </div>
      </aside>
    </>
  );
}
