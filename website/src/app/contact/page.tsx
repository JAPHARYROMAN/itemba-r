export const metadata = {
  title: 'Contact | Itemba Group',
};

const subsidiaries = [
  { name: 'Mwanjalisi Oil Co Ltd', sector: 'Energy & Fuel Distribution' },
  { name: 'Westsides Company Ltd', sector: 'Trade & Distribution' },
  { name: 'Itemba Enterprises Co Ltd', sector: 'Multi-Sector Operations' },
];

export default function ContactPage() {
  return (
    <>
      {/* ── Page header ── */}
      <section className="bg-navy-950 text-white py-16 px-4 sm:px-6">
        <div className="max-w-6xl mx-auto">
          <h1 className="text-4xl font-bold mb-4">Contact Us</h1>
          <p className="text-slate-300 text-lg max-w-2xl leading-relaxed">
            Reach out to Itemba Group for business enquiries, partnerships, or general
            information about our companies.
          </p>
        </div>
      </section>

      {/* ── Contact details ── */}
      <section className="py-16 px-4 sm:px-6 bg-white">
        <div className="max-w-4xl mx-auto">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-12">
            {/* Left — address & info */}
            <div>
              <h2 className="text-xl font-bold text-navy-900 mb-6">Group Headquarters</h2>

              <div className="space-y-6">
                <div className="flex gap-4">
                  <div className="w-10 h-10 rounded-lg bg-navy-100 flex items-center justify-center flex-shrink-0 text-navy-700">
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={1.5}
                        d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z"
                      />
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={1.5}
                        d="M15 11a3 3 0 11-6 0 3 3 0 016 0z"
                      />
                    </svg>
                  </div>
                  <div>
                    <div className="font-semibold text-navy-900 text-sm mb-1">Address</div>
                    <address className="text-slate-600 text-sm not-italic leading-relaxed">
                      Mpemba-Tunduma<br />
                      Songwe Region<br />
                      Tanzania
                    </address>
                  </div>
                </div>

                <div className="flex gap-4">
                  <div className="w-10 h-10 rounded-lg bg-navy-100 flex items-center justify-center flex-shrink-0 text-navy-700">
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={1.5}
                        d="M21 12a9 9 0 01-9 9m9-9a9 9 0 00-9-9m9 9H3m9 9a9 9 0 01-9-9m9 9c1.657 0 3-4.03 3-9s-1.343-9-3-9m0 18c-1.657 0-3-4.03-3-9s1.343-9 3-9"
                      />
                    </svg>
                  </div>
                  <div>
                    <div className="font-semibold text-navy-900 text-sm mb-1">Website</div>
                    <a
                      href="https://itembagrouptz.com"
                      className="text-gold-600 text-sm hover:text-gold-700 hover:underline transition-colors"
                    >
                      itembagrouptz.com
                    </a>
                  </div>
                </div>
              </div>

              <div className="mt-8 p-4 bg-slate-50 rounded-xl border border-slate-200 text-sm text-slate-600 leading-relaxed">
                For specific business enquiries, please contact the relevant subsidiary company
                directly. Each company operates independently within the Itemba Group structure.
              </div>
            </div>

            {/* Right — subsidiaries */}
            <div>
              <h2 className="text-xl font-bold text-navy-900 mb-6">Our Companies</h2>
              <div className="space-y-4">
                {subsidiaries.map((co) => (
                  <div
                    key={co.name}
                    className="p-4 border border-slate-200 rounded-xl hover:border-gold-300 transition-colors"
                  >
                    <div className="font-semibold text-navy-900 text-sm">{co.name}</div>
                    <div className="text-xs text-slate-500 mt-1">{co.sector}</div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ── Map placeholder ── */}
      <section className="bg-slate-50 py-16 px-4 sm:px-6">
        <div className="max-w-4xl mx-auto text-center">
          <h2 className="text-xl font-bold text-navy-900 mb-2">Find Us</h2>
          <p className="text-slate-500 text-sm mb-6">
            Mpemba-Tunduma, Songwe Region — near the Tanzania-Zambia border, a key commercial
            corridor in East and Southern Africa.
          </p>
          <div className="bg-navy-100 rounded-2xl h-48 flex items-center justify-center border border-navy-200">
            <div className="text-center text-navy-600">
              <div className="text-3xl mb-2">📍</div>
              <div className="text-sm font-medium">Mpemba-Tunduma, Songwe Region, Tanzania</div>
            </div>
          </div>
        </div>
      </section>
    </>
  );
}
