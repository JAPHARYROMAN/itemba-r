import Image from 'next/image';
import AnimatedSection from '@/components/AnimatedSection';

export const metadata = { title: 'About Us | Itemba Group' };

const pillars = [
  { title: 'Risk Reduction',         desc: 'Operating across six sectors shields the group from downturns in any single industry.' },
  { title: 'Revenue Diversification', desc: 'Multiple streams from energy, trade, manufacturing, and services create lasting stability.' },
  { title: 'Market Reach',            desc: 'Serving distinct customer segments simultaneously expands our regional footprint.' },
  { title: 'Scalability',             desc: 'Each company scales independently without constraining the broader group\'s growth.' },
];

export default function AboutPage() {
  return (
    <>
      {/* ── Hero ──────────────────────────────────────────────────── */}
      <section className="relative bg-ink-900 pt-40 pb-28 px-5 sm:px-8 overflow-hidden">
        <div className="hero-ambient">
          <div className="hero-orb hero-orb-gold" style={{ opacity: 0.7 }} />
          <div className="hero-orb hero-orb-blue" style={{ opacity: 0.5 }} />
          <div className="grid-overlay" />
        </div>
        <div className="relative z-10 max-w-7xl mx-auto">
          <AnimatedSection delay={0}>
            <p className="text-gold-400 text-xs font-semibold uppercase tracking-widest mb-4">
              About the Group
            </p>
          </AnimatedSection>
          <AnimatedSection delay={0.08}>
            <h1
              className="font-tight font-black text-white leading-none tracking-tightest mb-6"
              style={{ fontSize: 'clamp(2.8rem, 6vw, 5.5rem)' }}
            >
              Built for Tanzania.<br />
              <span className="gradient-text">Built to Last.</span>
            </h1>
          </AnimatedSection>
          <AnimatedSection delay={0.16}>
            <p className="text-slate-300 text-lg max-w-2xl leading-relaxed">
              A Tanzanian holding group built on diversification, resilience, and long-term
              growth — operating three independent companies across six major business sectors.
            </p>
          </AnimatedSection>
        </div>
      </section>

      {/* ── Who We Are ────────────────────────────────────────────── */}
      <section className="py-28 px-5 sm:px-8 bg-white">
        <div className="max-w-7xl mx-auto grid grid-cols-1 lg:grid-cols-2 gap-16 items-center">
          <div>
            <AnimatedSection delay={0}>
              <div className="gold-line mb-6" />
              <p className="text-gold-600 text-xs font-semibold uppercase tracking-widest mb-3">Who We Are</p>
            </AnimatedSection>
            <AnimatedSection delay={0.08}>
              <h2 className="font-tight font-black text-ink-900 text-4xl sm:text-5xl leading-none tracking-tighter mb-6">
                A Multi-Industry Business Ecosystem
              </h2>
            </AnimatedSection>
            <AnimatedSection delay={0.16}>
              <p className="text-slate-600 leading-relaxed mb-4 text-lg">
                Itemba Group is a Tanzanian-based diversified holding group made up of several
                subsidiary companies operating independently under one parent corporate structure.
              </p>
              <p className="text-slate-500 leading-relaxed mb-4">
                Our model is that of a <strong className="text-ink-900">conglomerate</strong> — each
                company within the group has its own legal identity and operational independence,
                while benefiting from strategic oversight, shared resources, and central governance
                provided by the parent group.
              </p>
              <p className="text-slate-500 leading-relaxed">
                Headquartered in Mpemba-Tunduma, Songwe Region, we operate six business sectors
                across three independent subsidiary companies and four specialised divisions.
              </p>
            </AnimatedSection>
          </div>
          <AnimatedSection direction="left">
            {/* PLACEHOLDER — replace with real group/leadership photo */}
            <div className="relative h-[440px] rounded-3xl overflow-hidden shadow-2xl img-zoom">
              <Image
                src="https://loremflickr.com/800/700/business,team?lock=2101"
                alt="Itemba Group — placeholder"
                fill
                sizes="(min-width: 1024px) 50vw, 100vw"
                className="object-cover img-inner"
              />
              <div className="absolute inset-0 bg-gradient-to-tl from-ink-900/40 to-transparent" />
            </div>
          </AnimatedSection>
        </div>
      </section>

      {/* ── Structure ─────────────────────────────────────────────── */}
      <section className="py-28 px-5 sm:px-8 bg-ink-950">
        <div className="max-w-7xl mx-auto">
          <AnimatedSection className="mb-16 text-center">
            <div className="gold-line mx-auto mb-6" />
            <p className="text-gold-400 text-xs font-semibold uppercase tracking-widest mb-3">
              Organisation
            </p>
            <h2 className="font-tight font-black text-white text-4xl sm:text-5xl leading-none tracking-tighter">
              Three Tiers. One Vision.
            </h2>
          </AnimatedSection>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-5 mb-12">
            {[
              { level: 'Group', title: 'Itemba Group', icon: '🏛️', desc: 'The parent holding company — strategic oversight, governance, and central coordination.' },
              { level: 'Companies', title: '3 Subsidiaries', icon: '🏢', desc: 'Mwanjalisi Oil, Westsides Company, and Itemba Enterprises — legally and operationally independent.' },
              { level: 'Divisions', title: '5 Business Units', icon: '⚙️', desc: 'Itemba Logistics (flagship), Itemba Hardware, Itemba Estate, Uzunguni Inn, and Uzunguni Parking Yard under Itemba Enterprises.' },
            ].map((item, i) => (
              <AnimatedSection key={item.level} delay={i * 0.1}>
                <div className="bg-ink-800 border border-ink-600 rounded-2xl p-8 h-full">
                  <div className="text-4xl mb-4">{item.icon}</div>
                  <span className="inline-block text-xs font-bold text-gold-400 border border-gold-500/30 bg-gold-500/10 px-3 py-1 rounded-full mb-4 uppercase tracking-wider">
                    {item.level}
                  </span>
                  <h3 className="font-tight font-bold text-white text-xl mb-3">{item.title}</h3>
                  <p className="text-sm text-slate-400 leading-relaxed">{item.desc}</p>
                </div>
              </AnimatedSection>
            ))}
          </div>

          {/* Org chart */}
          <AnimatedSection>
            <div className="bg-ink-800 border border-ink-600 rounded-2xl p-8 text-sm font-mono text-slate-400 leading-loose overflow-x-auto">
              <p className="text-white font-bold text-base mb-2">ITEMBA GROUP  <span className="text-gold-400">(Parent Holding)</span></p>
              <p className="ml-4 text-slate-300">├── Mwanjalisi Oil Co Ltd &nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;→ <span className="text-amber-400">Fuel &amp; energy distribution</span></p>
              <p className="ml-4 text-slate-300">├── Westsides Company Ltd &nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;→ <span className="text-blue-400">Beverages &amp; trade</span></p>
              <p className="ml-4 text-slate-300">└── Itemba Enterprises Co Ltd &nbsp;→ <span className="text-emerald-400">Multi-sector operations</span></p>
              <p className="ml-16 text-gold-400">├── Itemba Logistics &nbsp;&nbsp;&nbsp;&nbsp;&nbsp;→ Local &amp; cross-border transit <span className="text-gold-500">★ flagship</span></p>
              <p className="ml-16 text-slate-500">├── Itemba Hardware &nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;→ Hardware &amp; building materials</p>
              <p className="ml-16 text-slate-500">├── Itemba Estate &nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;→ Real estate &amp; property</p>
              <p className="ml-16 text-slate-500">├── Uzunguni Inn &nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;→ Hotel &amp; hospitality</p>
              <p className="ml-16 text-slate-500">└── Uzunguni Parking Yard &nbsp;→ Parking yard services</p>
            </div>
          </AnimatedSection>
        </div>
      </section>

      {/* ── Why Diversification ───────────────────────────────────── */}
      <section className="py-28 px-5 sm:px-8 bg-white">
        <div className="max-w-7xl mx-auto grid grid-cols-1 lg:grid-cols-2 gap-16 items-center">
          <AnimatedSection direction="right">
            {/* PLACEHOLDER — replace with operations photo */}
            <div className="relative h-[400px] rounded-3xl overflow-hidden shadow-2xl img-zoom">
              <Image
                src="https://loremflickr.com/800/640/industry,logistics?lock=2102"
                alt="Itemba Group operations — placeholder"
                fill
                sizes="(min-width: 1024px) 50vw, 100vw"
                className="object-cover img-inner"
              />
            </div>
          </AnimatedSection>
          <div>
            <AnimatedSection delay={0}>
              <div className="gold-line mb-6" />
              <p className="text-gold-600 text-xs font-semibold uppercase tracking-widest mb-3">Our Approach</p>
              <h2 className="font-tight font-black text-ink-900 text-4xl sm:text-5xl leading-none tracking-tighter mb-8">
                Why Diversification?
              </h2>
            </AnimatedSection>
            <div className="space-y-6">
              {pillars.map((p, i) => (
                <AnimatedSection key={p.title} delay={i * 0.08}>
                  <div className="flex gap-4">
                    <div className="w-1.5 rounded-full bg-gradient-to-b from-gold-400 to-gold-600 flex-shrink-0 mt-1" style={{ minHeight: '2.5rem' }} />
                    <div>
                      <h3 className="font-tight font-bold text-ink-900 mb-1">{p.title}</h3>
                      <p className="text-sm text-slate-500 leading-relaxed">{p.desc}</p>
                    </div>
                  </div>
                </AnimatedSection>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* ── HQ Feature ───────────────────────────────────────────── */}
      <section className="relative py-28 px-5 sm:px-8 bg-ink-900 overflow-hidden">
        <div className="hero-ambient">
          <div className="hero-orb hero-orb-gold" style={{ opacity: 0.5 }} />
          <div className="grid-overlay" />
        </div>
        <div className="relative z-10 max-w-7xl mx-auto grid grid-cols-1 lg:grid-cols-2 gap-16 items-center">
          <div>
            <AnimatedSection delay={0}>
              <div className="gold-line mb-6" />
              <p className="text-gold-400 text-xs font-semibold uppercase tracking-widest mb-3">Where We Are</p>
              <h2 className="font-tight font-black text-white text-4xl sm:text-5xl leading-none tracking-tighter mb-6">
                Headquartered in Songwe Region
              </h2>
            </AnimatedSection>
            <AnimatedSection delay={0.1}>
              <p className="text-slate-300 leading-relaxed mb-4">
                Our head office is located at the{' '}
                <strong className="text-white">Itemba Filling Station</strong> along the
                Tunduma–Ileje Highway in Mpemba, Tunduma — strategically positioned at the
                Tanzania-Zambia border, one of East and Southern Africa&apos;s most active trade
                corridors connecting our operations to regional supply chains.
              </p>
              <p className="text-slate-400 leading-relaxed">
                The Songwe Region is one of Tanzania&apos;s fastest-growing regions, driven by
                trade, agriculture, and infrastructure investment. Our presence here positions
                the group at the heart of this economic growth.
              </p>
            </AnimatedSection>
          </div>
          <AnimatedSection direction="left">
            {/* PLACEHOLDER — replace with real HQ building or Tunduma photo */}
            <div className="relative h-[380px] rounded-3xl overflow-hidden shadow-2xl img-zoom">
              <Image
                src="https://loremflickr.com/800/600/fuel,station?lock=2103"
                alt="Mpemba-Tunduma HQ — placeholder"
                fill
                sizes="(min-width: 1024px) 50vw, 100vw"
                className="object-cover img-inner"
              />
              <div className="absolute inset-0 bg-gradient-to-bl from-ink-900/50 to-transparent" />
              <div className="absolute bottom-6 left-6 bg-ink-900/85 backdrop-blur-sm rounded-xl px-5 py-3">
                <div className="font-tight font-bold text-white">Itemba Filling Station</div>
                <div className="text-xs text-slate-400 mt-0.5">Tunduma–Ileje Highway, Mpemba</div>
              </div>
            </div>
          </AnimatedSection>
        </div>
      </section>
    </>
  );
}
