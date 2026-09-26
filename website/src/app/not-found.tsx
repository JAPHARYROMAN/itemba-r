import Link from 'next/link';
import { notFoundPage as copy } from '@/content/errors';

// Legacy title (renders with the template suffix twice); WP2.8 switches to copy.metaTitle.
export const metadata = { title: copy.legacyMetaTitle };

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
          {copy.eyebrow}
        </p>
        <h1
          className="font-tight font-black text-white leading-none tracking-tightest mb-6"
          style={{ fontSize: 'clamp(4rem, 14vw, 10rem)' }}
        >
          <span className="gradient-text">{copy.code}</span>
        </h1>
        <h2 className="font-tight font-bold text-white text-3xl sm:text-4xl mb-5">
          {copy.title}
        </h2>
        <p className="text-slate-400 text-base sm:text-lg leading-relaxed mb-10 max-w-md mx-auto">
          {copy.body}
        </p>
        <div className="flex flex-wrap gap-3 sm:gap-4 justify-center">
          {copy.links.map((link, index) => (
            <Link
              key={link.href}
              href={link.href}
              className={
                index === 0
                  ? 'btn-primary bg-gold-500 hover:bg-gold-400 text-white font-semibold px-7 py-3.5 rounded-full text-sm hover:shadow-lg hover:shadow-gold-500/30'
                  : 'btn-primary border border-slate-600 hover:border-slate-300 text-slate-300 hover:text-white font-semibold px-7 py-3.5 rounded-full text-sm'
              }
            >
              {link.label}
            </Link>
          ))}
        </div>
      </div>
    </section>
  );
}
