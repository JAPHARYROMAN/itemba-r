import Link from 'next/link';
import Image from 'next/image';
import {
  companyProfiles,
  companyUrl,
  contact,
  locationProfiles,
  locationUrl,
  mailtoWithSubject,
  serviceAreas,
  serviceUrl,
  site,
} from '@/lib/site';
import { getCompanyAccent } from '@/lib/company-accent';

const linkGroups: Record<string, { label: string; href: string }[]> = {
  Group: [
    { label: 'Home', href: '/' },
    { label: 'About', href: '/about' },
    { label: 'Capabilities', href: '/capabilities' },
    { label: 'Partnerships', href: '/partnerships' },
    { label: 'Insights', href: '/insights' },
    { label: 'Company Profile', href: '/company-profile' },
    { label: 'FAQ', href: '/faq' },
    { label: 'Contact', href: '/contact' },
  ],
  Services: serviceAreas.map((service) => ({ label: service.shortTitle, href: serviceUrl(service.slug) })),
  Locations: locationProfiles.map((location) => ({ label: location.shortTitle, href: locationUrl(location.slug) })),
};

const mapsHref = `https://www.google.com/maps?q=${encodeURIComponent(contact.mapQuery)}`;

function PhoneIcon() {
  return (
    <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M3 5a2 2 0 012-2h2.2a1 1 0 01.95.68l1.1 3.3a1 1 0 01-.45 1.2l-1.5.82a12.5 12.5 0 005.7 5.7l.82-1.5a1 1 0 011.2-.45l3.3 1.1a1 1 0 01.68.95V19a2 2 0 01-2 2h-1C8.82 21 3 15.18 3 8V5z" />
    </svg>
  );
}

function WhatsAppIcon() {
  return (
    <svg className="h-4 w-4" fill="currentColor" viewBox="0 0 24 24" aria-hidden="true">
      <path d="M12.04 2a9.83 9.83 0 00-8.46 14.82L2.4 22l5.29-1.12A9.83 9.83 0 1012.04 2zm0 1.78a8.05 8.05 0 014.07 14.99 8.06 8.06 0 01-7.85.36l-.33-.17-3.05.65.67-2.95-.2-.34A8.05 8.05 0 0112.04 3.78zm-3.5 4.15c-.18 0-.47.07-.72.34-.25.27-.95.93-.95 2.27 0 1.34.97 2.63 1.1 2.81.14.18 1.88 3.02 4.63 4.12 2.28.91 2.75.73 3.24.69.5-.05 1.61-.66 1.84-1.3.23-.64.23-1.19.16-1.3-.07-.12-.25-.18-.52-.32-.27-.13-1.6-.79-1.85-.88-.25-.09-.43-.14-.61.14-.18.27-.7.88-.86 1.06-.16.18-.32.2-.59.07-.27-.14-1.14-.42-2.17-1.34-.8-.71-1.34-1.59-1.5-1.86-.16-.27-.02-.42.12-.55.12-.12.27-.32.41-.48.14-.16.18-.27.27-.45.09-.18.05-.34-.02-.48-.07-.13-.61-1.48-.84-2.02-.22-.53-.44-.45-.61-.46h-.52z" />
    </svg>
  );
}

function MailIcon() {
  return (
    <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M3 8l7.9 5.26a2 2 0 002.2 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
    </svg>
  );
}

export default function Footer() {
  const year = new Date().getFullYear();

  return (
    <footer className="relative overflow-hidden bg-ink-950 text-slate-400">
      {/* Gold hairline + film grain */}
      <div className="h-px w-full bg-gradient-to-r from-transparent via-gold-500/50 to-transparent" />
      <div className="grain-overlay" />

      <div className="relative z-10 mx-auto max-w-7xl px-5 sm:px-8">
        {/* ── Contact CTA band ─────────────────────────────────────────── */}
        <div className="flex flex-col gap-6 border-b border-white/10 py-12 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <h2 className="font-tight text-2xl font-black tracking-tight text-white sm:text-3xl">
              Ready to talk to Itemba Group?
            </h2>
            <p className="mt-2 max-w-xl text-sm leading-relaxed text-slate-400">
              Fuel, trade, logistics, hospitality and more across the Tanzania–Zambia corridor —
              reach the group office directly.
            </p>
          </div>
          <div className="flex flex-wrap gap-3">
            <a
              href={`tel:${contact.primaryPhone}`}
              aria-label="Call Itemba Group"
              className="inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/[0.06] px-5 py-3 text-sm font-semibold text-white backdrop-blur transition hover:border-white/40 hover:bg-white/10 focus-visible:ring-gold-400"
            >
              <PhoneIcon /> Call
            </a>
            <a
              href={contact.whatsapp}
              aria-label="Message Itemba Group on WhatsApp"
              className="inline-flex items-center gap-2 rounded-full bg-emerald-600 px-5 py-3 text-sm font-semibold text-white transition hover:bg-emerald-500 focus-visible:ring-gold-400"
            >
              <WhatsAppIcon /> WhatsApp
            </a>
            <a
              href={mailtoWithSubject('Business enquiry')}
              aria-label="Email Itemba Group"
              className="inline-flex items-center gap-2 rounded-full bg-gold-500 px-5 py-3 text-sm font-semibold text-white transition hover:bg-gold-400 hover:shadow-lg hover:shadow-gold-500/25 focus-visible:ring-gold-400"
            >
              <MailIcon /> Email us
            </a>
          </div>
        </div>

        {/* ── Brand + links ────────────────────────────────────────────── */}
        <div className="grid grid-cols-2 gap-x-6 gap-y-10 py-14 lg:grid-cols-6">
          {/* Brand */}
          <div className="col-span-2">
            <Image
              src="/logo.png"
              alt="Itemba Group"
              width={260}
              height={100}
              className="h-14 w-auto object-contain"
            />
            <p className="mt-5 max-w-xs text-sm leading-relaxed text-slate-400">
              Tanzania&apos;s diversified business group — three independent companies, six sectors,
              one unified vision on the southern corridor.
            </p>

            <address
              itemScope
              itemType="https://schema.org/PostalAddress"
              className="mt-6 max-w-xs space-y-3 text-xs not-italic text-slate-400"
            >
              <div>
                <div className="mb-0.5 font-semibold uppercase tracking-widest text-gold-400">Head office</div>
                <p itemProp="streetAddress">Itemba Filling Station, Along Tunduma-Ileje Highway, Mpemba</p>
                <p>
                  <span itemProp="addressLocality">Tunduma</span>,{' '}
                  <span itemProp="addressRegion">Songwe</span>,{' '}
                  <span itemProp="addressCountry">Tanzania</span>
                </p>
              </div>
              <p itemProp="postOfficeBoxNumber">P.O. Box 132, Tunduma-Songwe</p>
            </address>

            <a
              href={mapsHref}
              target="_blank"
              rel="noopener noreferrer"
              className="mt-4 inline-flex items-center gap-2 text-xs font-semibold text-gold-300 transition hover:text-gold-200"
            >
              <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M12 21s7-5.2 7-11a7 7 0 10-14 0c0 5.8 7 11 7 11z" />
                <circle cx="12" cy="10" r="2.5" strokeWidth={1.8} />
              </svg>
              Get directions
            </a>
          </div>

          {/* Group */}
          <nav aria-label="Group footer links">
            <h3 className="mb-4 text-xs font-semibold uppercase tracking-widest text-white">Group</h3>
            <ul className="space-y-2.5">
              {linkGroups.Group.map((item) => (
                <li key={item.href}>
                  <Link href={item.href} className="text-sm text-slate-400 transition-colors hover:text-white">
                    {item.label}
                  </Link>
                </li>
              ))}
            </ul>
          </nav>

          {/* Companies (colour-coded) */}
          <nav aria-label="Companies footer links">
            <h3 className="mb-4 text-xs font-semibold uppercase tracking-widest text-white">Companies</h3>
            <ul className="space-y-2.5">
              {companyProfiles.map((company) => {
                const accent = getCompanyAccent(company.slug);
                return (
                  <li key={company.slug}>
                    <Link
                      href={companyUrl(company.slug)}
                      className="inline-flex items-center gap-2.5 text-sm text-slate-400 transition-colors hover:text-white"
                    >
                      <span className={`h-1.5 w-1.5 flex-shrink-0 rounded-full ${accent.dot}`} aria-hidden="true" />
                      {company.name}
                    </Link>
                  </li>
                );
              })}
            </ul>
          </nav>

          {/* Services */}
          <nav aria-label="Services footer links">
            <h3 className="mb-4 text-xs font-semibold uppercase tracking-widest text-white">Services</h3>
            <ul className="space-y-2.5">
              {linkGroups.Services.map((item) => (
                <li key={item.href}>
                  <Link href={item.href} className="text-sm text-slate-400 transition-colors hover:text-white">
                    {item.label}
                  </Link>
                </li>
              ))}
            </ul>
          </nav>

          {/* Locations */}
          <nav aria-label="Locations footer links">
            <h3 className="mb-4 text-xs font-semibold uppercase tracking-widest text-white">Locations</h3>
            <ul className="space-y-2.5">
              {linkGroups.Locations.map((item) => (
                <li key={item.href}>
                  <Link href={item.href} className="text-sm text-slate-400 transition-colors hover:text-white">
                    {item.label}
                  </Link>
                </li>
              ))}
            </ul>
          </nav>
        </div>

        {/* ── Bottom bar ───────────────────────────────────────────────── */}
        <div className="flex flex-col items-center justify-between gap-4 border-t border-white/10 py-7 text-xs text-slate-500 sm:flex-row">
          <p>© {year} Itemba Group. All rights reserved.</p>
          <div className="flex flex-wrap items-center justify-center gap-x-5 gap-y-2">
            <Link href="/company-profile" className="transition-colors hover:text-white">Company Profile</Link>
            <Link href="/faq" className="transition-colors hover:text-white">FAQ</Link>
            <Link href="/contact" className="transition-colors hover:text-white">Contact</Link>
            <span className="text-slate-600">{site.domain}</span>
          </div>
        </div>
      </div>
    </footer>
  );
}
