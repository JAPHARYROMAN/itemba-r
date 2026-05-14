import Link from 'next/link';
import Image from 'next/image';
import {
  companyProfiles,
  companyUrl,
  locationProfiles,
  locationUrl,
  serviceAreas,
  serviceUrl,
} from '@/lib/site';

const links = {
  Group:     [{ label: 'Home', href: '/' }, { label: 'About Us', href: '/about' }, { label: 'Capabilities', href: '/capabilities' }, { label: 'Insights', href: '/insights' }, { label: 'Company Profile', href: '/company-profile' }, { label: 'Partnerships', href: '/partnerships' }, { label: 'FAQ', href: '/faq' }, { label: 'Contact', href: '/contact' }],
  Services: serviceAreas.map((service) => ({ label: service.shortTitle, href: serviceUrl(service.slug) })),
  Locations: locationProfiles.map((location) => ({ label: location.shortTitle, href: locationUrl(location.slug) })),
  Companies: companyProfiles.map((company) => ({ label: company.name, href: companyUrl(company.slug) })),
};

export default function Footer() {
  return (
    <footer className="bg-ink-950 text-slate-400 border-t border-ink-700">
      <div className="max-w-7xl mx-auto px-5 sm:px-8 py-16">
        <div className="grid grid-cols-1 md:grid-cols-6 gap-10 mb-12">
          {/* Brand */}
          <div className="md:col-span-2">
            <div className="mb-5">
              <div className="inline-flex rounded-sm">
                {/* Logo — save to website/public/logo.png */}
                <Image
                  src="/logo.png"
                  alt="Itemba Group"
                  width={260}
                  height={100}
                  className="h-16 w-auto object-contain"
                  priority
                />
              </div>
            </div>
            <p className="text-sm leading-relaxed max-w-xs text-slate-400 mb-6">
              Tanzania&apos;s diversified business group — three independent companies,
              six sectors, one unified vision.
            </p>

            {/* Contact details */}
            <address className="not-italic text-xs text-slate-500 space-y-3 max-w-xs">
              <div>
                <div className="text-slate-300 font-semibold mb-0.5">Head Office</div>
                <p>Itemba Filling Station, Along Tunduma–Ileje Highway, Mpemba, Tunduma</p>
              </div>
              <div>
                <div className="text-slate-300 font-semibold mb-0.5">Postal</div>
                <p>P.O. Box 132, Tunduma–Songwe, Tanzania</p>
              </div>
              <div className="space-y-0.5">
                <a href="tel:+255758793511" className="block text-slate-400 hover:text-white transition-colors">
                  +255 758 793 511
                </a>
                <a href="tel:+255745215047" className="block text-slate-400 hover:text-white transition-colors">
                  +255 745 215 047
                </a>
                <a href="mailto:info@itembagrouptz.com" className="block text-gold-500 hover:text-gold-400 transition-colors break-all">
                  info@itembagrouptz.com
                </a>
              </div>
            </address>
          </div>

          {/* Link columns */}
          {Object.entries(links).map(([section, items]) => (
            <nav key={section} aria-label={`${section} footer links`}>
              <h3 className="text-white font-semibold text-xs uppercase tracking-widest mb-4">{section}</h3>
              <ul className="space-y-2.5">
                {items.map((item) => (
                  <li key={item.href}>
                    <Link href={item.href} className="text-sm text-slate-400 hover:text-white transition-colors">
                      {item.label}
                    </Link>
                  </li>
                ))}
              </ul>
            </nav>
          ))}
        </div>

        <div className="border-t border-ink-700 pt-8 flex flex-col sm:flex-row items-center justify-between gap-4 text-xs text-slate-600">
          <p>© {new Date().getFullYear()} Itemba Group. All rights reserved.</p>
          <p>itembagrouptz.com</p>
        </div>
      </div>
    </footer>
  );
}
