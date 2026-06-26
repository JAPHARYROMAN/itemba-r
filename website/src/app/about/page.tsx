import type { Metadata } from 'next';
import AnimatedSection from '@/components/AnimatedSection';
import { absoluteUrl } from '@/lib/site';

export const metadata: Metadata = {
  title: 'About Us',
  description:
    'Learn about Itemba Group, a Tanzanian multi-industry holding group headquartered in Mpemba-Tunduma, Songwe Region.',
  alternates: { canonical: absoluteUrl('/about') },
  openGraph: {
    title: 'About Itemba Group',
    description:
      'A Tanzanian holding group built on diversification, resilience, and long-term growth across multiple sectors.',
    url: absoluteUrl('/about'),
  },
};

const pillars = [
  { title: 'Risk reduction', desc: 'Operating across six sectors shields the group from downturns in any single industry.' },
  { title: 'Revenue diversification', desc: 'Multiple streams from energy, trade, manufacturing and services create lasting stability.' },
  { title: 'Market reach', desc: 'Serving distinct customer segments simultaneously expands our regional footprint.' },
  { title: 'Scalability', desc: "Each company scales independently without constraining the broader group's growth." },
];

const mosaic = [
  { src: '/images/fuel-stations/itemba-filling-station-wide.webp', alt: 'ITEMBA filling station forecourt' },
  { src: '/images/beverages/westsides-warehouse-stock-wide.webp', alt: 'Westsides wholesale beverage warehouse stock' },
  { src: '/images/logistics/itemba-logistics-tanker-under-canopy.webp', alt: 'Itemba Logistics tanker truck' },
  { src: '/images/hospitality/uzunguni-bar-restaurant.webp', alt: 'UZUNGUNI INN bar and restaurant' },
];

const tiers = [
  { level: 'Group', title: 'Itemba Group', icon: '🏛️', desc: 'The parent holding company — strategic oversight, governance, and central coordination.' },
  { level: 'Companies', title: '3 Subsidiaries', icon: '🏢', desc: 'Mwanjalisi Oil, Westsides Company, and Itemba Enterprises — legally and operationally independent.' },
  { level: 'Brands', title: 'Operating brands', icon: '⚙️', desc: 'ITEMBA-MPEMBA, ITEMBA-UZUNGUNI and UZUNGUNI PARKING YARD under Mwanjalisi Oil; ITEMBA-HARDWARE and UZUNGUNI INN under Westsides.' },
];

export default function AboutPage() {
  return (
    <div className="bg-ink-950">
      {/* ── Hero ──────────────────────────────────────────────────── */}
      <section className="relative flex min-h-[72vh] items-end overflow-hidden bg-ink-950">
        <img
          src="/images/fuel-stations/itemba-filling-station-wide.webp"
          alt=""
          aria-hidden="true"
          className="animate-kenburns absolute inset-0 h-full w-full object-cover"
        />
        <div className="absolute inset-0 bg-gradient-to-r from-ink-950 via-ink-950/70 to-ink-950/30" />
        <div className="absolute inset-0 bg-gradient-to-t from-ink-950 via-transparent to-ink-950/70" />
        <div className="grain-overlay" />
        <div className="relative z-10 mx-auto w-full max-w-7xl px-5 pb-16 pt-40 sm:px-8">
          <AnimatedSection>
            <div className="mb-5 flex items-center gap-3">
              <span className="h-px w-10 bg-gold-400" />
              <span className="text-xs font-semibold uppercase tracking-[0.25em] text-gold-300">
                About the group
              </span>
            </div>
            <h1 className="cine-shadow font-tight text-5xl font-black leading-[0.92] tracking-tight text-white sm:text-6xl lg:text-7xl">
              Built for Tanzania. <span className="gradient-text">Built to last.</span>
            </h1>
            <p className="mt-7 max-w-2xl text-lg leading-relaxed text-slate-200/90">
              A Tanzanian holding group built on diversification, resilience and long-term growth —
              operating three independent companies across six major business sectors.
            </p>
          </AnimatedSection>
        </div>
      </section>

      {/* ── Who we are ────────────────────────────────────────────── */}
      <section className="overflow-hidden bg-ink-950 px-5 py-28 sm:px-8">
        <div className="mx-auto grid max-w-7xl grid-cols-1 items-center gap-16 lg:grid-cols-2">
          <div>
            <AnimatedSection>
              <div className="gold-line mb-6" />
              <p className="mb-3 text-xs font-semibold uppercase tracking-[0.25em] text-gold-400">
                Who we are
              </p>
              <h2 className="mb-6 font-tight text-4xl font-black leading-tight tracking-tight text-white sm:text-5xl">
                A multi-industry business ecosystem
              </h2>
            </AnimatedSection>
            <AnimatedSection delay={0.12}>
              <p className="mb-4 text-lg leading-relaxed text-slate-300">
                Itemba Group is a Tanzanian-based diversified holding group made up of several
                subsidiary companies operating independently under one parent corporate structure.
              </p>
              <p className="mb-4 leading-relaxed text-slate-400">
                Our model is that of a <strong className="text-white">conglomerate</strong> — each
                company has its own legal identity and operational independence, while benefiting
                from strategic oversight, shared resources and central governance.
              </p>
              <p className="leading-relaxed text-slate-400">
                Headquartered in Mpemba-Tunduma, Songwe Region, we operate six business sectors
                across three independent subsidiary companies and four specialised divisions.
              </p>
            </AnimatedSection>
          </div>
          <AnimatedSection direction="left">
            <div className="grid h-[440px] grid-cols-2 gap-3">
              {mosaic.map((image) => (
                <div key={image.src} className="relative overflow-hidden rounded-2xl ring-1 ring-white/10">
                  <img src={image.src} alt={image.alt} loading="lazy" className="h-full w-full object-cover" />
                  <div className="absolute inset-0 bg-gradient-to-t from-ink-950/50 to-transparent" />
                </div>
              ))}
            </div>
          </AnimatedSection>
        </div>
      </section>

      {/* ── Structure ─────────────────────────────────────────────── */}
      <section className="bg-ink-950 px-5 py-28 sm:px-8">
        <div className="mx-auto max-w-7xl">
          <AnimatedSection className="mb-16 text-center">
            <div className="gold-line mx-auto mb-6" />
            <p className="mb-3 text-xs font-semibold uppercase tracking-[0.25em] text-gold-400">
              Organisation
            </p>
            <h2 className="font-tight text-4xl font-black leading-tight tracking-tight text-white sm:text-5xl">
              Three tiers. One vision.
            </h2>
          </AnimatedSection>

          <div className="mb-12 grid grid-cols-1 gap-5 md:grid-cols-3">
            {tiers.map((item, i) => (
              <AnimatedSection key={item.level} delay={i * 0.1}>
                <div className="h-full rounded-2xl border border-white/10 bg-white/[0.04] p-8">
                  <div className="mb-4 text-4xl">{item.icon}</div>
                  <span className="mb-4 inline-block rounded-full border border-gold-500/30 bg-gold-500/10 px-3 py-1 text-xs font-bold uppercase tracking-wider text-gold-400">
                    {item.level}
                  </span>
                  <h3 className="mb-3 font-tight text-xl font-bold text-white">{item.title}</h3>
                  <p className="text-sm leading-relaxed text-slate-400">{item.desc}</p>
                </div>
              </AnimatedSection>
            ))}
          </div>

          <AnimatedSection>
            <div className="overflow-x-auto rounded-2xl border border-white/10 bg-white/[0.03] p-8 font-mono text-sm leading-loose text-slate-400">
              <p className="mb-2 text-base font-bold text-white">
                ITEMBA GROUP <span className="text-gold-400">(Parent Holding)</span>
              </p>
              <p className="ml-4 text-slate-300">├── Mwanjalisi Oil Co Ltd → <span className="text-amber-400">Fuel, parking &amp; energy distribution</span></p>
              <p className="ml-8 text-slate-500">├── ITEMBA-MPEMBA / ITEMBA-UZUNGUNI → Fuel station brands</p>
              <p className="ml-8 text-slate-500">├── UZUNGUNI PARKING YARD → Parking facilities</p>
              <p className="ml-4 text-slate-300">├── Westsides Company Ltd → <span className="text-blue-400">Beverages, hardware &amp; hospitality</span></p>
              <p className="ml-8 text-slate-500">├── ITEMBA-HARDWARE → Hardware &amp; construction equipment</p>
              <p className="ml-8 text-slate-500">├── UZUNGUNI INN → Lodging, restaurant &amp; bar</p>
              <p className="ml-4 text-slate-300">└── Itemba Enterprises Co Ltd → <span className="text-emerald-400">Logistics &amp; emerging businesses</span></p>
              <p className="ml-8 text-gold-400">└── Itemba Logistics → Local &amp; cross-border transit <span className="text-gold-500">★ flagship</span></p>
            </div>
          </AnimatedSection>
        </div>
      </section>

      {/* ── Why diversification ───────────────────────────────────── */}
      <section className="overflow-hidden bg-ink-950 px-5 py-28 sm:px-8">
        <div className="mx-auto grid max-w-7xl grid-cols-1 items-center gap-16 lg:grid-cols-2">
          <AnimatedSection direction="right">
            <div className="relative h-[400px] overflow-hidden rounded-3xl ring-1 ring-white/10">
              <img
                src="/images/fuel-stations/itemba-station-wide-yard.webp"
                alt="Itemba Group filling station yard and corridor operations"
                loading="lazy"
                className="absolute inset-0 h-full w-full object-cover"
              />
              <div className="absolute inset-0 bg-gradient-to-tr from-ink-950/60 via-transparent to-transparent" />
            </div>
          </AnimatedSection>
          <div>
            <AnimatedSection>
              <div className="gold-line mb-6" />
              <p className="mb-3 text-xs font-semibold uppercase tracking-[0.25em] text-gold-400">
                Our approach
              </p>
              <h2 className="mb-8 font-tight text-4xl font-black leading-tight tracking-tight text-white sm:text-5xl">
                Why diversification?
              </h2>
            </AnimatedSection>
            <div className="space-y-6">
              {pillars.map((p, i) => (
                <AnimatedSection key={p.title} delay={i * 0.08}>
                  <div className="flex gap-4">
                    <div
                      className="mt-1 w-1.5 flex-shrink-0 rounded-full bg-gradient-to-b from-gold-400 to-gold-600"
                      style={{ minHeight: '2.5rem' }}
                    />
                    <div>
                      <h3 className="mb-1 font-tight font-bold text-white">{p.title}</h3>
                      <p className="text-sm leading-relaxed text-slate-400">{p.desc}</p>
                    </div>
                  </div>
                </AnimatedSection>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* ── HQ feature ────────────────────────────────────────────── */}
      <section className="relative flex min-h-[70vh] items-center overflow-hidden bg-ink-950 py-24">
        <img
          src="/images/fuel-stations/itemba-filling-station-wide.webp"
          alt="Itemba Filling Station along the Tunduma-Ileje Highway in Mpemba"
          loading="lazy"
          className="absolute inset-0 h-full w-full object-cover"
        />
        <div className="absolute inset-0 bg-gradient-to-r from-ink-950 via-ink-950/75 to-ink-950/35" />
        <div className="absolute inset-0 bg-gradient-to-t from-ink-950 via-transparent to-ink-950/60" />
        <div className="grain-overlay" />
        <div className="relative z-10 mx-auto w-full max-w-7xl px-5 sm:px-8">
          <AnimatedSection className="max-w-2xl">
            <div className="mb-5 flex items-center gap-3">
              <span className="h-px w-10 bg-gold-400" />
              <span className="text-xs font-semibold uppercase tracking-[0.25em] text-gold-300">
                Where we are
              </span>
            </div>
            <h2 className="cine-shadow font-tight text-4xl font-black leading-tight tracking-tight text-white sm:text-5xl">
              Headquartered in Songwe Region
            </h2>
            <p className="mt-6 max-w-xl leading-relaxed text-slate-200/90">
              Our head office is at the <strong className="text-white">Itemba Filling Station</strong>{' '}
              along the Tunduma–Ileje Highway in Mpemba, Tunduma — at the Tanzania-Zambia border, one
              of East and Southern Africa&apos;s most active trade corridors.
            </p>
            <p className="mt-4 max-w-xl leading-relaxed text-slate-400">
              The Songwe Region is one of Tanzania&apos;s fastest-growing regions, driven by trade,
              agriculture and infrastructure investment — and the group sits at the heart of it.
            </p>
          </AnimatedSection>
        </div>
      </section>
    </div>
  );
}
