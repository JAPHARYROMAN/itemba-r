import Link from 'next/link';
import { contact, contactActionLabels, mailtoWithSubject, telHref } from '@/content/contact';
import { businessEnquirySubject } from '@/content/enquiry';
import { quickContactCopy as copy, headerCta } from '@/content/nav';
import QuickContact from '@/islands/QuickContact';
import { buttonClasses } from '@/ui/button';
import { cn } from '@/ui/cn';
import { Icon } from '@/ui/Icon';

/** A direct channel: its icon over a short label, a 44px target, quieter than the pill. */
const channel =
  'inline-flex min-h-11 min-w-14 flex-col items-center justify-center gap-0.5 rounded-card px-2 text-legal font-medium text-fg transition-colors duration-fast ease-apple hover:bg-surface-alt';

/**
 * The mobile quick-contact bar (plan: Call · WhatsApp · Enquire): a slim
 * bar fixed to the bottom of the screen. The direct channels (Call,
 * WhatsApp and Email) are quiet icon actions on the left; the one pill is
 * Enquire, to the general enquiry form (the global nav's headerCta), so
 * the routed enquiry leads rather than the raw mail app. It shows below
 * `md` only (the global nav's Enquire pill and the footer serve larger
 * screens), and fits a 320px screen.
 *
 * The hrefs are exactly origin/main's: `tel:` (primary line), the prepared
 * `wa.me/` message and the "Business enquiry" `mailto:`, which
 * ConversionTracker classifies as phone, WhatsApp and email clicks.
 * `data-quick-contact` marks it for the e2e harness. A spacer in the page
 * flow, painted like the footer, keeps the bar from covering the last line
 * of the page.
 *
 * Server markup: the QuickContact island around it only hides it on routes
 * with an inline enquiry form (its route matrix), so the icons, the copy
 * and the contact helpers never join every page's first-load script.
 */
export function QuickContactBar() {
  return (
    <QuickContact>
      <div aria-hidden="true" data-print="hide" className="h-[calc(var(--quickbar-height)+env(safe-area-inset-bottom))] bg-surface-alt md:hidden" />
      <aside
        aria-label={copy.label}
        data-quick-contact=""
        data-print="hide"
        className="fixed inset-x-0 bottom-0 z-quick-bar border-t border-line bg-surface pb-[env(safe-area-inset-bottom)] md:hidden"
      >
        <div className="mx-auto flex h-quickbar max-w-content items-center gap-1 px-gutter">
          <a href={telHref(contact.primaryPhone)} aria-label={contactActionLabels.call} className={cn(channel, '-ml-2')}>
            <Icon name="phone" size="sm" />
            <span>{copy.call}</span>
          </a>
          <a href={contact.whatsapp} aria-label={contactActionLabels.whatsapp} className={channel}>
            <Icon name="whatsapp" size="sm" />
            <span>{copy.whatsapp}</span>
          </a>
          <a href={mailtoWithSubject(businessEnquirySubject)} aria-label={contactActionLabels.email} className={channel}>
            <Icon name="mail" size="sm" />
            <span>{copy.email}</span>
          </a>
          <Link href={headerCta.href} className={cn(buttonClasses({ size: 'sm' }), 'ml-auto')}>
            {headerCta.label}
          </Link>
        </div>
      </aside>
    </QuickContact>
  );
}
