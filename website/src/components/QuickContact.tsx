'use client';

import { usePathname } from 'next/navigation';
import { contact, mailtoWithSubject } from '@/lib/site';

export default function QuickContact() {
  const pathname = usePathname();
  const hasInlineEnquiry =
    pathname === '/contact' ||
    pathname === '/company-profile' ||
    pathname === '/capabilities' ||
    pathname === '/partnerships' ||
    pathname === '/faq' ||
    pathname.startsWith('/companies/') ||
    pathname.startsWith('/services/') ||
    pathname.startsWith('/locations/') ||
    pathname.startsWith('/insights/');

  if (hasInlineEnquiry) {
    return null;
  }

  return (
    <div className="fixed bottom-4 right-4 z-40 flex flex-col gap-2 sm:bottom-6 sm:right-6">
      <a
        href={`tel:${contact.primaryPhone}`}
        className="inline-flex h-12 w-12 items-center justify-center rounded-full bg-ink-900 text-white shadow-xl shadow-ink-900/25 ring-1 ring-white/10 transition hover:bg-ink-700 focus-visible:ring-gold-400"
        aria-label="Call Itemba Group"
      >
        <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={1.8}
            d="M3 5a2 2 0 012-2h2.2a1 1 0 01.95.68l1.1 3.3a1 1 0 01-.45 1.2l-1.5.82a12.5 12.5 0 005.7 5.7l.82-1.5a1 1 0 011.2-.45l3.3 1.1a1 1 0 01.68.95V19a2 2 0 01-2 2h-1C8.82 21 3 15.18 3 8V5z"
          />
        </svg>
      </a>
      <a
        href={contact.whatsapp}
        className="inline-flex h-12 w-12 items-center justify-center rounded-full bg-emerald-600 text-white shadow-xl shadow-emerald-900/25 ring-1 ring-white/10 transition hover:bg-emerald-500 focus-visible:ring-gold-400"
        aria-label="Send Itemba Group a WhatsApp message"
      >
        <svg className="h-5 w-5" fill="currentColor" viewBox="0 0 24 24" aria-hidden="true">
          <path d="M12.04 2a9.83 9.83 0 00-8.46 14.82L2.4 22l5.29-1.12A9.83 9.83 0 1012.04 2zm0 1.78a8.05 8.05 0 014.07 14.99 8.06 8.06 0 01-7.85.36l-.33-.17-3.05.65.67-2.95-.2-.34A8.05 8.05 0 0112.04 3.78zm-3.5 4.15c-.18 0-.47.07-.72.34-.25.27-.95.93-.95 2.27 0 1.34.97 2.63 1.1 2.81.14.18 1.88 3.02 4.63 4.12 2.28.91 2.75.73 3.24.69.5-.05 1.61-.66 1.84-1.3.23-.64.23-1.19.16-1.3-.07-.12-.25-.18-.52-.32-.27-.13-1.6-.79-1.85-.88-.25-.09-.43-.14-.61.14-.18.27-.7.88-.86 1.06-.16.18-.32.2-.59.07-.27-.14-1.14-.42-2.17-1.34-.8-.71-1.34-1.59-1.5-1.86-.16-.27-.02-.42.12-.55.12-.12.27-.32.41-.48.14-.16.18-.27.27-.45.09-.18.05-.34-.02-.48-.07-.13-.61-1.48-.84-2.02-.22-.53-.44-.45-.61-.46h-.52z" />
        </svg>
      </a>
      <a
        href={mailtoWithSubject('Business enquiry')}
        className="hidden h-12 w-12 items-center justify-center rounded-full bg-gold-500 text-white shadow-xl shadow-gold-900/25 ring-1 ring-white/10 transition hover:bg-gold-400 focus-visible:ring-gold-400 sm:inline-flex"
        aria-label="Email Itemba Group"
      >
        <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={1.8}
            d="M3 8l7.9 5.26a2 2 0 002.2 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z"
          />
        </svg>
      </a>
    </div>
  );
}
