import Link from 'next/link';

export const metadata = { title: 'Page Not Found | Itemba Group' };

export default function NotFound() {
  return (
    <section className="relative min-h-screen flex items-center justify-center bg-ink-900 overflow-hidden px-5 sm:px-8">
      <div className="hero-ambient">
        <div className="hero-orb hero-orb-gold" />
        <div className="hero-orb hero-orb-blue" />
        <div className="grid-overlay" />
      </div>

      <div className="relative z-10 max-w-2xl mx-auto text-center">
        <p className="text-gold-400 text-xs font-semibold uppercase tracking-widest mb-6">
          Error 404
        </p>
        <h1
          className="font-tight font-black text-white leading-none tracking-tightest mb-6"
          style={{ fontSize: 'clamp(4rem, 14vw, 10rem)' }}
        >
          <span className="gradient-text">404</span>
        </h1>
        <h2 className="font-tight font-bold text-white text-3xl sm:text-4xl mb-5">
          Page Not Found
        </h2>
        <p className="text-slate-400 text-base sm:text-lg leading-relaxed mb-10 max-w-md mx-auto">
          The page you&apos;re looking for doesn&apos;t exist or may have been moved.
          Let&apos;s get you back on track.
        </p>
        <div className="flex flex-wrap gap-3 sm:gap-4 justify-center">
          <Link
            href="/"
            className="btn-primary bg-gold-500 hover:bg-gold-400 text-white font-semibold px-7 py-3.5 rounded-full text-sm hover:shadow-lg hover:shadow-gold-500/30"
          >
            Back to Home
          </Link>
          <Link
            href="/companies"
            className="btn-primary border border-slate-600 hover:border-slate-300 text-slate-300 hover:text-white font-semibold px-7 py-3.5 rounded-full text-sm"
          >
            Our Companies
          </Link>
          <Link
            href="/services"
            className="btn-primary border border-slate-600 hover:border-slate-300 text-slate-300 hover:text-white font-semibold px-7 py-3.5 rounded-full text-sm"
          >
            Services
          </Link>
        </div>
      </div>
    </section>
  );
}
