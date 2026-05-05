export const metadata = {
  title: 'Our Companies | Itemba Group',
};

const companies = [
  {
    initial: 'M',
    name: 'Mwanjalisi Oil Co Ltd',
    sector: 'Energy & Fuel Distribution',
    accentBg: 'bg-amber-500',
    summary:
      "The group's petroleum retail arm, focused on bringing reliable fuel supply to businesses and communities in the Songwe region and beyond. Mwanjalisi Oil operates fuel stations supplying the full range of petroleum products needed by households, transport operators, and industry.",
    products: ['Diesel', 'Petrol', 'Kerosene', 'Lubricants'],
    divisions: [],
  },
  {
    initial: 'W',
    name: 'Westsides Company Ltd',
    sector: 'Trade & Distribution',
    accentBg: 'bg-blue-600',
    summary:
      'A wholesale and retail distribution company dealing in a wide range of beverages and construction-related goods. Westsides serves both consumer markets and business customers, supplying beverages from leading brands alongside hardware and building materials for the construction sector.',
    products: [
      'Alcoholic Beverages',
      'Non-Alcoholic Beverages',
      'Building Materials',
      'Hand Tools & Power Tools',
      'Electrical Supplies',
    ],
    divisions: [],
  },
  {
    initial: 'IE',
    name: 'Itemba Enterprises Co Ltd',
    sector: 'Multi-Sector Operations',
    accentBg: 'bg-emerald-600',
    summary:
      "The group's multi-sector flagship, operating across manufacturing, hardware, real estate, and hospitality through a network of specialised business divisions. Itemba Enterprises is the most diversified entity within the group, with operations that span both product and service industries.",
    products: [
      'Industrial Goods',
      'Consumer Goods',
      'Building Materials',
      'Property Services',
      'Hotel & Lodging',
      'Parking & Logistics',
    ],
    divisions: [
      {
        name: 'Itemba Hardware',
        desc: 'Supplies building materials, hand tools, power tools, and electrical components to contractors, builders, and retail customers.',
      },
      {
        name: 'Itemba Estate',
        desc: 'Handles property development, real estate management, and property-related services in the Songwe region.',
      },
      {
        name: 'Uzunguni Inn',
        desc: 'A hospitality facility offering hotel accommodation, restaurant dining, and lodging services for travellers and business guests.',
      },
      {
        name: 'Uzunguni Parking Yard',
        desc: 'Provides secure parking and logistics yard services, supporting the movement of goods and vehicles in the region.',
      },
    ],
  },
];

export default function CompaniesPage() {
  return (
    <>
      {/* ── Page header ── */}
      <section className="bg-navy-950 text-white py-16 px-4 sm:px-6">
        <div className="max-w-6xl mx-auto">
          <h1 className="text-4xl font-bold mb-4">Our Companies</h1>
          <p className="text-slate-300 text-lg max-w-2xl leading-relaxed">
            Three independently operated subsidiaries spanning six sectors across Tanzania,
            each with its own legal identity and operational focus.
          </p>
        </div>
      </section>

      {/* ── Company profiles ── */}
      <section className="py-16 px-4 sm:px-6 bg-white">
        <div className="max-w-6xl mx-auto space-y-10">
          {companies.map((co) => (
            <div
              key={co.name}
              className="rounded-2xl border border-slate-200 overflow-hidden hover:shadow-md transition-shadow"
            >
              {/* Header band */}
              <div className={`${co.accentBg} px-8 py-6 flex items-center gap-4`}>
                <div className="w-12 h-12 rounded-full bg-white bg-opacity-20 flex items-center justify-center font-bold text-white text-base flex-shrink-0">
                  {co.initial}
                </div>
                <div>
                  <h2 className="text-xl font-bold text-white">{co.name}</h2>
                  <span className="text-xs text-white opacity-80 font-medium">{co.sector}</span>
                </div>
              </div>

              {/* Body */}
              <div className="p-8">
                <p className="text-slate-600 leading-relaxed mb-7">{co.summary}</p>

                {/* Products */}
                <div className="mb-7">
                  <h3 className="text-xs font-semibold uppercase tracking-widest text-slate-400 mb-3">
                    Products &amp; Services
                  </h3>
                  <div className="flex flex-wrap gap-2">
                    {co.products.map((p) => (
                      <span
                        key={p}
                        className="text-xs bg-slate-100 text-slate-700 px-3 py-1 rounded-full"
                      >
                        {p}
                      </span>
                    ))}
                  </div>
                </div>

                {/* Divisions */}
                {co.divisions.length > 0 && (
                  <div>
                    <h3 className="text-xs font-semibold uppercase tracking-widest text-slate-400 mb-3">
                      Business Divisions
                    </h3>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                      {co.divisions.map((div) => (
                        <div
                          key={div.name}
                          className="bg-slate-50 rounded-xl p-4 border border-slate-200"
                        >
                          <div className="font-semibold text-navy-900 text-sm mb-1">
                            {div.name}
                          </div>
                          <div className="text-xs text-slate-500 leading-relaxed">{div.desc}</div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      </section>
    </>
  );
}
