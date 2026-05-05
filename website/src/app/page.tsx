import Link from 'next/link';

const sectors = [
  {
    icon: (
      <svg className="w-7 h-7" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M13 10V3L4 14h7v7l9-11h-7z" />
      </svg>
    ),
    name: 'Energy & Fuel',
    desc: 'Petroleum retail and fuel distribution — diesel, petrol, kerosene, and lubricants.',
  },
  {
    icon: (
      <svg className="w-7 h-7" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4" />
      </svg>
    ),
    name: 'Trade & Distribution',
    desc: 'Wholesale and retail of beverages, building materials, and consumer goods.',
  },
  {
    icon: (
      <svg className="w-7 h-7" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M19.428 15.428a2 2 0 00-1.022-.547l-2.387-.477a6 6 0 00-3.86.517l-.318.158a6 6 0 01-3.86.517L6.05 15.21a2 2 0 00-1.806.547M8 4h8l-1 1v5.172a2 2 0 00.586 1.414l5 5c1.26 1.26.367 3.414-1.415 3.414H4.828c-1.782 0-2.674-2.154-1.414-3.414l5-5A2 2 0 009 10.172V5L8 4z" />
      </svg>
    ),
    name: 'Manufacturing',
    desc: 'Industrial and consumer goods production serving regional markets.',
  },
  {
    icon: (
      <svg className="w-7 h-7" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6" />
      </svg>
    ),
    name: 'Construction',
    desc: 'Hardware, building materials, tools, and construction supplies.',
  },
  {
    icon: (
      <svg className="w-7 h-7" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4" />
      </svg>
    ),
    name: 'Hospitality',
    desc: 'Hotel, restaurant, and lodging services through Uzunguni Inn.',
  },
  {
    icon: (
      <svg className="w-7 h-7" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M8 14v3m4-3v3m4-3v3M3 21h18M3 10h18M3 7l9-4 9 4M4 10h16v11H4V10z" />
      </svg>
    ),
    name: 'Real Estate',
    desc: 'Property development and real estate services through Itemba Estate.',
  },
];

const companies = [
  {
    initial: 'M',
    name: 'Mwanjalisi Oil Co Ltd',
    tag: 'Energy & Fuel Distribution',
    accentBg: 'bg-amber-500',
    desc: 'The group\'s petroleum retail arm, delivering reliable fuel supply — diesel, petrol, kerosene, and lubricants — to businesses and communities across the Songwe region and beyond.',
  },
  {
    initial: 'W',
    name: 'Westsides Company Ltd',
    tag: 'Trade & Distribution',
    accentBg: 'bg-blue-600',
    desc: 'Wholesale and retail distribution of beverages (alcoholic and non-alcoholic) and construction-related goods, serving a broad consumer and business market.',
  },
  {
    initial: 'IE',
    name: 'Itemba Enterprises Co Ltd',
    tag: 'Multi-Sector Operations',
    accentBg: 'bg-emerald-600',
    desc: 'The group\'s flagship multi-sector company, operating across manufacturing, hardware, real estate, and hospitality through specialised business divisions.',
  },
];

export default function HomePage() {
  return (
    <>
      {/* ── Hero ── */}
      <section className="bg-navy-950 text-white py-24 px-4 sm:px-6">
        <div className="max-w-6xl mx-auto">
          <p className="text-gold-400 text-xs font-semibold uppercase tracking-widest mb-5">
            Mpemba-Tunduma · Songwe Region · Tanzania
          </p>
          <h1 className="text-4xl sm:text-5xl lg:text-6xl font-bold leading-tight mb-6 max-w-3xl">
            Tanzania&apos;s Diversified<br />Business Group
          </h1>
          <p className="text-slate-300 text-lg max-w-2xl mb-10 leading-relaxed">
            Itemba Group is a holding group unifying independent companies across energy, trade,
            manufacturing, construction, hospitality, and real estate — building a resilient,
            multi-industry business ecosystem in Tanzania.
          </p>
          <div className="flex flex-wrap gap-4">
            <Link
              href="/companies"
              className="bg-gold-500 hover:bg-gold-600 text-white font-semibold px-6 py-3 rounded-md transition-colors text-sm"
            >
              Our Companies
            </Link>
            <Link
              href="/about"
              className="border border-slate-600 hover:border-slate-400 text-slate-300 hover:text-white font-semibold px-6 py-3 rounded-md transition-colors text-sm"
            >
              About the Group
            </Link>
          </div>
        </div>
      </section>

      {/* ── Stats bar ── */}
      <section className="bg-navy-900 text-white py-6 px-4 sm:px-6">
        <div className="max-w-6xl mx-auto grid grid-cols-2 md:grid-cols-4 gap-6 text-center">
          {[
            { value: '3', label: 'Subsidiary Companies' },
            { value: '6+', label: 'Business Sectors' },
            { value: '4', label: 'Specialised Divisions' },
            { value: 'Tanzania', label: 'Headquartered' },
          ].map((stat) => (
            <div key={stat.label}>
              <div className="text-2xl font-bold text-gold-400">{stat.value}</div>
              <div className="text-xs text-slate-400 mt-1">{stat.label}</div>
            </div>
          ))}
        </div>
      </section>

      {/* ── Sectors ── */}
      <section className="py-20 px-4 sm:px-6 bg-slate-50">
        <div className="max-w-6xl mx-auto">
          <div className="text-center mb-12">
            <h2 className="text-3xl font-bold text-navy-900 mb-3">What We Do</h2>
            <p className="text-slate-500 max-w-xl mx-auto text-sm leading-relaxed">
              Our businesses span six key sectors, providing diversified revenue streams and
              broad market reach across Tanzania.
            </p>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
            {sectors.map((sector) => (
              <div
                key={sector.name}
                className="bg-white rounded-xl p-6 border border-slate-200 hover:border-gold-400 hover:shadow-md transition-all"
              >
                <div className="text-navy-700 mb-3">{sector.icon}</div>
                <h3 className="font-semibold text-navy-900 mb-2">{sector.name}</h3>
                <p className="text-sm text-slate-500 leading-relaxed">{sector.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── Companies ── */}
      <section className="py-20 px-4 sm:px-6 bg-white">
        <div className="max-w-6xl mx-auto">
          <div className="text-center mb-12">
            <h2 className="text-3xl font-bold text-navy-900 mb-3">Our Companies</h2>
            <p className="text-slate-500 max-w-xl mx-auto text-sm leading-relaxed">
              Three independently operated subsidiaries, each focused on their sector while
              sharing the strength of the Itemba Group structure.
            </p>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            {companies.map((co) => (
              <div
                key={co.name}
                className="rounded-xl border border-slate-200 overflow-hidden hover:shadow-md transition-shadow"
              >
                <div className={`${co.accentBg} px-6 py-5 flex items-center gap-3`}>
                  <div className="w-10 h-10 rounded-full bg-white bg-opacity-20 flex items-center justify-center font-bold text-white text-sm">
                    {co.initial}
                  </div>
                  <span className="text-xs font-semibold text-white opacity-90">{co.tag}</span>
                </div>
                <div className="p-6">
                  <h3 className="font-bold text-navy-900 text-base mb-3">{co.name}</h3>
                  <p className="text-sm text-slate-600 leading-relaxed">{co.desc}</p>
                </div>
              </div>
            ))}
          </div>
          <div className="text-center mt-8">
            <Link
              href="/companies"
              className="text-sm text-gold-600 font-semibold hover:text-gold-700 transition-colors"
            >
              View full company profiles →
            </Link>
          </div>
        </div>
      </section>

      {/* ── CTA ── */}
      <section className="bg-navy-950 text-white py-16 px-4 sm:px-6">
        <div className="max-w-3xl mx-auto text-center">
          <h2 className="text-3xl font-bold mb-4">Get In Touch</h2>
          <p className="text-slate-300 mb-8 leading-relaxed">
            Interested in doing business with Itemba Group or one of our subsidiaries?
            We&apos;d love to hear from you.
          </p>
          <Link
            href="/contact"
            className="bg-gold-500 hover:bg-gold-600 text-white font-semibold px-8 py-3 rounded-md transition-colors inline-block"
          >
            Contact Us
          </Link>
        </div>
      </section>
    </>
  );
}
