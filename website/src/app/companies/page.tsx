import Image from 'next/image';
import AnimatedSection from '@/components/AnimatedSection';

export const metadata = { title: 'Our Companies | Itemba Group' };

const companies = [
  {
    id: 'mwanjalisi',
    name: 'Mwanjalisi Oil Co Ltd',
    sector: 'Energy & Fuel Distribution',
    accentColor: '#f59e0b',
    accentClass: 'text-amber-400',
    accentBg: 'bg-amber-500',
    accentBorder: 'border-amber-500/30',
    accentGlow: 'shadow-amber-500/20',
    // PLACEHOLDER — replace with real Mwanjalisi fuel station hero photo
    hero: 'https://loremflickr.com/1200/600/fuel,station?lock=3101',
    summary: "Tanzania's petroleum retail arm within Itemba Group — delivering reliable fuel supply to businesses, transport operators, and communities across the Songwe region and beyond.",
    detail: "Positioned in a high-traffic corridor near the Tanzania-Zambia border, Mwanjalisi Oil serves a diverse customer base from individual motorists to commercial fleet operators. The company's fuel stations are designed for reliability, safety, and operational efficiency.",
    products: ['Diesel', 'Petrol', 'Kerosene', 'Lubricants'],
    // PLACEHOLDER gallery — swap with real station photos
    gallery: [
      { src: 'https://loremflickr.com/600/420/gas,pump?lock=3102', cap: 'Fuel pumps' },
      { src: 'https://loremflickr.com/600/420/fuel,station?lock=3103', cap: 'Forecourt' },
      { src: 'https://loremflickr.com/600/420/motor,oil?lock=3104', cap: 'Lubricants' },
    ],
    divisions: [],
  },
  {
    id: 'westsides',
    name: 'Westsides Company Ltd',
    sector: 'Trade & Distribution',
    accentColor: '#3b82f6',
    accentClass: 'text-blue-400',
    accentBg: 'bg-blue-500',
    accentBorder: 'border-blue-500/30',
    accentGlow: 'shadow-blue-500/20',
    // PLACEHOLDER — replace with real Westsides store or warehouse photo
    hero: 'https://loremflickr.com/1200/600/warehouse,store?lock=3201',
    summary: 'Wholesale and retail distribution covering beverages and construction goods — serving both consumer markets and business customers across the Songwe region.',
    detail: "Westsides bridges two high-demand markets: beverage distribution and construction supply. Its network reaches retailers, contractors, and hospitality businesses, making it a central distribution hub in the region's trade ecosystem.",
    products: ['Alcoholic Beverages', 'Non-Alcoholic Beverages', 'Building Materials', 'Hand & Power Tools', 'Electrical Supplies'],
    // PLACEHOLDER gallery
    gallery: [
      { src: 'https://loremflickr.com/600/420/beverage,warehouse?lock=3202', cap: 'Beverages' },
      { src: 'https://loremflickr.com/600/420/hardware,tools?lock=3203', cap: 'Hardware' },
      { src: 'https://loremflickr.com/600/420/warehouse,distribution?lock=3204', cap: 'Warehouse' },
    ],
    divisions: [],
  },
  {
    id: 'enterprises',
    name: 'Itemba Enterprises Co Ltd',
    sector: 'Multi-Sector Operations',
    accentColor: '#10b981',
    accentClass: 'text-emerald-400',
    accentBg: 'bg-emerald-500',
    accentBorder: 'border-emerald-500/30',
    accentGlow: 'shadow-emerald-500/20',
    // PLACEHOLDER — replace with real Itemba Enterprises photo
    hero: 'https://loremflickr.com/1200/600/logistics,truck?lock=3301',
    summary: "The group's multi-sector flagship — anchored by logistics for local distribution and cross-border transit, alongside manufacturing, hardware, real estate, and hospitality — operating through five specialised business divisions.",
    detail: "Itemba Enterprises acts as the group's growth engine across multiple consumer and service markets. Logistics is its largest line of business, leveraging the strategic Tunduma corridor for local distribution and cross-border transit between Tanzania, Zambia, and the wider region. The remaining four divisions create a self-reinforcing ecosystem of products and services — from building materials to hospitality — all under one parent entity.",
    products: ['Local Logistics', 'Cross-Border Transit', 'Industrial Goods', 'Consumer Goods', 'Building Materials', 'Property Services', 'Hotel & Lodging', 'Parking Yard'],
    // PLACEHOLDER gallery
    gallery: [
      { src: 'https://loremflickr.com/600/420/truck,logistics?lock=3302', cap: 'Itemba Logistics' },
      { src: 'https://loremflickr.com/600/420/hardware,store?lock=3303', cap: 'Itemba Hardware' },
      { src: 'https://loremflickr.com/600/420/hotel,restaurant?lock=3304', cap: 'Uzunguni Inn' },
    ],
    divisions: [
      { name: 'Itemba Logistics',    desc: 'Local distribution and cross-border transit logistics through the Tunduma corridor — the flagship business of Itemba Enterprises.', photo: 'https://loremflickr.com/500/360/truck,logistics?lock=3401', flagship: true },
      { name: 'Itemba Hardware',     desc: 'Building materials, hand tools, power tools, and electrical supplies to contractors and retail customers.',                          photo: 'https://loremflickr.com/500/360/hardware,tools?lock=3402' },
      { name: 'Itemba Estate',       desc: 'Property development, real estate management, and property-related services in the Songwe region.',                                  photo: 'https://loremflickr.com/500/360/real,estate?lock=3403' },
      { name: 'Uzunguni Inn',        desc: 'Hotel accommodation, restaurant dining, and lodging services for travellers and business guests.',                                    photo: 'https://loremflickr.com/500/360/hotel,room?lock=3404' },
      { name: 'Uzunguni Parking Yard', desc: 'Secure parking yard services supporting the movement of goods and vehicles in the region.',                                         photo: 'https://loremflickr.com/500/360/parking,truck?lock=3405' },
    ],
  },
];

export default function CompaniesPage() {
  return (
    <>
      {/* ── Hero ──────────────────────────────────────────────────── */}
      <section className="relative bg-ink-900 pt-40 pb-24 px-5 sm:px-8 overflow-hidden">
        <div className="hero-ambient">
          <div className="hero-orb hero-orb-gold" style={{ opacity: 0.6 }} />
          <div className="hero-orb hero-orb-blue" style={{ opacity: 0.4 }} />
          <div className="grid-overlay" />
        </div>
        <div className="relative z-10 max-w-7xl mx-auto">
          <AnimatedSection delay={0}>
            <p className="text-gold-400 text-xs font-semibold uppercase tracking-widest mb-4">Our Subsidiaries</p>
          </AnimatedSection>
          <AnimatedSection delay={0.08}>
            <h1
              className="font-tight font-black text-white leading-none tracking-tightest mb-6"
              style={{ fontSize: 'clamp(2.8rem, 6vw, 5.5rem)' }}
            >
              Three Companies.<br />
              <span className="gradient-text">Six Sectors.</span>
            </h1>
          </AnimatedSection>
          <AnimatedSection delay={0.16}>
            <p className="text-slate-300 text-lg max-w-2xl leading-relaxed">
              Each subsidiary is legally and operationally independent — with its own
              identity, focus, and market — all unified under the Itemba Group umbrella.
            </p>
          </AnimatedSection>
        </div>
      </section>

      {/* ── Company profiles ──────────────────────────────────────── */}
      <div className="bg-white">
        {companies.map((co, idx) => (
          <section key={co.id} id={co.id} className="scroll-mt-16 py-24 px-5 sm:px-8 border-t border-slate-100">
            <div className="max-w-7xl mx-auto">

              {/* Company hero banner */}
              <AnimatedSection>
                <div className="relative h-72 sm:h-96 rounded-3xl overflow-hidden shadow-2xl mb-14 img-zoom">
                  <Image
                    src={co.hero}
                    alt={`${co.name} — placeholder`}
                    fill
                    sizes="100vw"
                    className="object-cover img-inner"
                    priority={idx === 0}
                  />
                  <div className="absolute inset-0 bg-gradient-to-r from-ink-950/90 via-ink-950/60 to-transparent" />
                  <div className="absolute inset-0 flex items-end p-10">
                    <div>
                      <span className={`${co.accentBg} text-white text-xs font-bold uppercase tracking-widest px-3 py-1.5 rounded-full inline-block mb-3`}>
                        {co.sector}
                      </span>
                      <h2 className="font-tight font-black text-white text-3xl sm:text-4xl leading-none">{co.name}</h2>
                    </div>
                  </div>
                </div>
              </AnimatedSection>

              <div className="grid grid-cols-1 lg:grid-cols-3 gap-12">
                {/* Main content */}
                <div className="lg:col-span-2">
                  <AnimatedSection delay={0.05}>
                    <p className="text-slate-700 text-lg leading-relaxed mb-4">{co.summary}</p>
                    <p className="text-slate-500 leading-relaxed mb-8">{co.detail}</p>
                  </AnimatedSection>

                  {/* Products */}
                  <AnimatedSection delay={0.1}>
                    <p className="text-xs font-semibold uppercase tracking-widest text-slate-400 mb-3">
                      Products &amp; Services
                    </p>
                    <div className="flex flex-wrap gap-2 mb-10">
                      {co.products.map((p) => (
                        <span key={p} className="text-xs font-medium text-ink-800 bg-slate-100 border border-slate-200 px-3 py-1.5 rounded-full">
                          {p}
                        </span>
                      ))}
                    </div>
                  </AnimatedSection>

                  {/* Gallery */}
                  <AnimatedSection delay={0.15}>
                    <p className="text-xs font-semibold uppercase tracking-widest text-slate-400 mb-4">Gallery</p>
                    <div className="grid grid-cols-3 gap-3">
                      {co.gallery.map((img) => (
                        <div key={img.src} className="relative h-32 rounded-xl overflow-hidden group img-zoom">
                          {/* PLACEHOLDER photos — replace with real images */}
                          <Image
                            src={img.src}
                            alt={img.cap}
                            fill
                            sizes="(min-width: 1024px) 22vw, 33vw"
                            className="object-cover img-inner"
                          />
                          <div className="absolute inset-0 bg-ink-900/30 group-hover:bg-ink-900/10 transition-colors" />
                        </div>
                      ))}
                    </div>
                  </AnimatedSection>
                </div>

                {/* Sidebar */}
                <div className="space-y-6">
                  <AnimatedSection delay={0.1} direction="left">
                    <div className={`border-l-2 ${co.accentBorder} pl-5 space-y-5`}>
                      <div>
                        <div className="text-xs text-slate-400 mb-1">Sector</div>
                        <div className={`font-semibold text-sm ${co.accentClass}`}>{co.sector}</div>
                      </div>
                      <div>
                        <div className="text-xs text-slate-400 mb-1">Structure</div>
                        <div className="font-semibold text-sm text-ink-900">Subsidiary of Itemba Group</div>
                      </div>
                      <div>
                        <div className="text-xs text-slate-400 mb-1">Location</div>
                        <div className="font-semibold text-sm text-ink-900">Songwe Region, Tanzania</div>
                      </div>
                    </div>
                  </AnimatedSection>

                  {/* Divisions (Itemba Enterprises only) */}
                  {co.divisions.length > 0 && (
                    <AnimatedSection delay={0.2} direction="left">
                      <p className="text-xs font-semibold uppercase tracking-widest text-slate-400 mb-4">Business Divisions</p>
                      <div className="space-y-4">
                        {co.divisions.map((div) => {
                          const isFlagship = 'flagship' in div && div.flagship;
                          return (
                            <div
                              key={div.name}
                              className={`rounded-2xl overflow-hidden border group hover:shadow-md transition-shadow ${
                                isFlagship ? 'border-gold-400 shadow-md shadow-gold-500/10' : 'border-slate-200'
                              }`}
                            >
                              <div className="relative h-28 img-zoom">
                                {/* PLACEHOLDER division photo */}
                                <Image
                                  src={div.photo}
                                  alt={`${div.name} — placeholder`}
                                  fill
                                  sizes="(min-width: 1024px) 28vw, 100vw"
                                  className="object-cover img-inner"
                                />
                                <div className="absolute inset-0 bg-ink-900/50 group-hover:bg-ink-900/30 transition-colors flex items-end p-4">
                                  <span className="font-tight font-bold text-white text-sm">{div.name}</span>
                                </div>
                                {isFlagship && (
                                  <span className="absolute top-2 right-2 bg-gold-500 text-white text-[9px] font-bold uppercase tracking-widest px-2 py-0.5 rounded-full">
                                    Flagship
                                  </span>
                                )}
                              </div>
                              <div className="p-4 bg-white">
                                <p className="text-xs text-slate-500 leading-relaxed">{div.desc}</p>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </AnimatedSection>
                  )}
                </div>
              </div>
            </div>
          </section>
        ))}
      </div>
    </>
  );
}
