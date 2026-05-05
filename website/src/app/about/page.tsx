export const metadata = {
  title: 'About Us | Itemba Group',
};

export default function AboutPage() {
  return (
    <>
      {/* ── Page header ── */}
      <section className="bg-navy-950 text-white py-16 px-4 sm:px-6">
        <div className="max-w-6xl mx-auto">
          <h1 className="text-4xl font-bold mb-4">About Itemba Group</h1>
          <p className="text-slate-300 text-lg max-w-2xl leading-relaxed">
            A Tanzanian holding group built on diversification, resilience, and long-term growth
            across multiple industries.
          </p>
        </div>
      </section>

      {/* ── Who We Are ── */}
      <section className="py-16 px-4 sm:px-6 bg-white">
        <div className="max-w-4xl mx-auto">
          <h2 className="text-2xl font-bold text-navy-900 mb-6">Who We Are</h2>
          <p className="text-slate-600 leading-relaxed mb-4">
            Itemba Group is a Tanzanian-based diversified holding group made up of several
            subsidiary companies that operate independently but are unified under one parent
            corporate structure. Headquartered in Mpemba-Tunduma in the Songwe Region of
            Tanzania, the Group spans six major business sectors: energy, trade, manufacturing,
            construction, hospitality, and real estate.
          </p>
          <p className="text-slate-600 leading-relaxed mb-4">
            Our model is that of a{' '}
            <strong className="text-navy-900">conglomerate</strong> — each company within the
            group operates with its own legal identity and operational independence, while
            benefiting from the strategic oversight, shared resources, and central governance
            provided by the parent group.
          </p>
          <p className="text-slate-600 leading-relaxed">
            This structure allows Itemba Group to maintain agility at the subsidiary level while
            building resilience at the group level through diversification across industries and
            revenue streams.
          </p>
        </div>
      </section>

      {/* ── Structure ── */}
      <section className="py-16 px-4 sm:px-6 bg-slate-50">
        <div className="max-w-4xl mx-auto">
          <h2 className="text-2xl font-bold text-navy-900 mb-2">Our Structure</h2>
          <p className="text-slate-500 text-sm mb-8">
            Three tiers — from group oversight down to specialised business divisions.
          </p>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            {[
              {
                level: 'Group',
                title: 'Itemba Group',
                desc: 'The parent holding company providing strategic oversight, governance, and central coordination across all subsidiaries.',
              },
              {
                level: 'Companies',
                title: 'Subsidiary Companies',
                desc: 'Three legally independent companies — Mwanjalisi Oil, Westsides Company, and Itemba Enterprises — each operating in their respective sectors.',
              },
              {
                level: 'Divisions',
                title: 'Business Units',
                desc: 'Specialised divisions within Itemba Enterprises: Itemba Hardware, Itemba Estate, Uzunguni Inn, and Uzunguni Parking Yard.',
              },
            ].map((item) => (
              <div key={item.level} className="bg-white rounded-xl border border-slate-200 p-6">
                <span className="inline-block text-xs font-bold text-gold-600 bg-gold-50 px-2 py-1 rounded mb-3 uppercase tracking-wider">
                  {item.level}
                </span>
                <h3 className="font-semibold text-navy-900 mb-2">{item.title}</h3>
                <p className="text-sm text-slate-500 leading-relaxed">{item.desc}</p>
              </div>
            ))}
          </div>

          {/* Org chart illustration */}
          <div className="mt-10 bg-white border border-slate-200 rounded-xl p-6 text-sm font-mono text-slate-600 leading-relaxed">
            <p className="text-navy-900 font-bold mb-2">ITEMBA GROUP (Parent)</p>
            <p className="ml-4">├── Mwanjalisi Oil Co Ltd &nbsp;&nbsp;&nbsp;&nbsp;→ Fuel &amp; energy</p>
            <p className="ml-4">├── Westsides Company Ltd &nbsp;&nbsp;&nbsp;&nbsp;→ Beverages &amp; trading</p>
            <p className="ml-4">└── Itemba Enterprises Co Ltd &nbsp;→ Multi-sector</p>
            <p className="ml-12">├── Itemba Hardware</p>
            <p className="ml-12">├── Itemba Estate</p>
            <p className="ml-12">├── Uzunguni Inn</p>
            <p className="ml-12">└── Uzunguni Parking Yard</p>
          </div>
        </div>
      </section>

      {/* ── Why Diversification ── */}
      <section className="py-16 px-4 sm:px-6 bg-white">
        <div className="max-w-4xl mx-auto">
          <h2 className="text-2xl font-bold text-navy-900 mb-8">Why Diversification?</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {[
              {
                title: 'Risk Reduction',
                desc: 'Spreading operations across multiple industries protects the group from downturns in any single sector.',
              },
              {
                title: 'Revenue Diversification',
                desc: 'Multiple revenue streams from energy, trade, manufacturing, and services create financial stability.',
              },
              {
                title: 'Market Reach',
                desc: 'Serving different markets and customer segments simultaneously expands our footprint across Tanzania.',
              },
              {
                title: 'Scalability',
                desc: "Independent companies can scale within their sectors without constraining the broader group's growth.",
              },
            ].map((item) => (
              <div key={item.title} className="flex gap-4">
                <div className="w-2 h-2 rounded-full bg-gold-500 mt-2 flex-shrink-0" />
                <div>
                  <h3 className="font-semibold text-navy-900 mb-1">{item.title}</h3>
                  <p className="text-sm text-slate-500 leading-relaxed">{item.desc}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── HQ ── */}
      <section className="py-16 px-4 sm:px-6 bg-navy-950 text-white">
        <div className="max-w-4xl mx-auto flex flex-col md:flex-row gap-8 items-center">
          <div className="flex-1">
            <h2 className="text-2xl font-bold mb-4">Headquarters</h2>
            <p className="text-slate-300 leading-relaxed">
              Itemba Group is headquartered in{' '}
              <strong className="text-white">Mpemba-Tunduma</strong>, located in the{' '}
              <strong className="text-white">Songwe Region</strong> of Tanzania — a strategic
              commercial hub near the Tanzania-Zambia border, connecting our operations to
              regional trade routes across East and Southern Africa.
            </p>
          </div>
          <div className="bg-navy-900 border border-navy-700 rounded-xl p-8 text-center flex-shrink-0">
            <div className="text-4xl mb-3">📍</div>
            <div className="font-bold text-white text-lg">Mpemba-Tunduma</div>
            <div className="text-sm text-slate-400 mt-1">Songwe Region, Tanzania</div>
          </div>
        </div>
      </section>
    </>
  );
}
