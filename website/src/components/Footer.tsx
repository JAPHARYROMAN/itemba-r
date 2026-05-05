import Link from 'next/link';

export default function Footer() {
  return (
    <footer className="bg-navy-950 text-slate-400 border-t border-navy-800">
      <div className="max-w-6xl mx-auto px-4 sm:px-6 py-12">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-8 mb-8">
          {/* Brand */}
          <div>
            <div className="flex items-center gap-3 mb-4">
              <div className="w-9 h-9 rounded bg-gold-500 flex items-center justify-center font-bold text-white text-sm select-none">
                IG
              </div>
              <span className="font-bold text-white text-lg">ITEMBA GROUP</span>
            </div>
            <p className="text-sm leading-relaxed">
              Tanzania's diversified business group operating across energy, trade,
              manufacturing, construction, hospitality, and real estate.
            </p>
          </div>

          {/* Quick links */}
          <div>
            <h3 className="text-white font-semibold mb-4 text-xs uppercase tracking-widest">
              Quick Links
            </h3>
            <ul className="space-y-2 text-sm">
              <li>
                <Link href="/" className="hover:text-white transition-colors">Home</Link>
              </li>
              <li>
                <Link href="/about" className="hover:text-white transition-colors">About Us</Link>
              </li>
              <li>
                <Link href="/companies" className="hover:text-white transition-colors">Our Companies</Link>
              </li>
              <li>
                <Link href="/contact" className="hover:text-white transition-colors">Contact</Link>
              </li>
            </ul>
          </div>

          {/* HQ */}
          <div>
            <h3 className="text-white font-semibold mb-4 text-xs uppercase tracking-widest">
              Headquarters
            </h3>
            <address className="text-sm not-italic leading-relaxed space-y-1">
              <p>Mpemba-Tunduma</p>
              <p>Songwe Region, Tanzania</p>
            </address>
          </div>
        </div>

        <div className="border-t border-navy-800 pt-8 text-xs text-center text-slate-500">
          © {new Date().getFullYear()} Itemba Group. All rights reserved. &middot; itembagrouptz.com
        </div>
      </div>
    </footer>
  );
}
