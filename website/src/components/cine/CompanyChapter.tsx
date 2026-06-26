'use client';

import { useRef } from 'react';
import Link from 'next/link';
import { motion, useReducedMotion, useScroll, useTransform } from 'framer-motion';

export interface ChapterAccent {
  /** e.g. 'text-amber-300' */
  text: string;
  /** e.g. 'bg-amber-500' */
  chip: string;
  /** rgba wash colour for the gradient, e.g. 'rgba(245,158,11,0.30)' */
  wash: string;
  /** ring/border accent, e.g. 'border-amber-400/30' */
  border: string;
}

export interface CompanyChapterProps {
  index: number;
  eyebrow: string;
  name: string;
  summary: string;
  brands: string[];
  stat: { value: string; label: string };
  image: { src: string; alt: string };
  href: string;
  ctaLabel: string;
  accent: ChapterAccent;
  align?: 'left' | 'right';
}

const ease = [0.22, 1, 0.36, 1] as const;

export default function CompanyChapter({
  index,
  eyebrow,
  name,
  summary,
  brands,
  stat,
  image,
  href,
  ctaLabel,
  accent,
  align = 'left',
}: CompanyChapterProps) {
  const ref = useRef<HTMLElement>(null);
  const reduce = useReducedMotion();
  const { scrollYProgress } = useScroll({
    target: ref,
    offset: ['start end', 'end start'],
  });
  // Subtle scroll-linked parallax on the photo; disabled for reduced-motion.
  const y = useTransform(scrollYProgress, [0, 1], reduce ? ['0%', '0%'] : ['-8%', '8%']);

  const alignedRight = align === 'right';

  return (
    <section
      ref={ref}
      aria-label={name}
      className="relative flex min-h-[88vh] items-center overflow-hidden bg-ink-950 py-24"
    >
      {/* Full-bleed graded photo with parallax */}
      <motion.div style={{ y }} className="absolute inset-0 -top-[8%] -bottom-[8%]">
        <img
          src={image.src}
          alt={image.alt}
          className="h-full w-full object-cover"
          loading="lazy"
        />
      </motion.div>

      {/* Cinematic grade: accent wash + directional darkness for legibility */}
      <div
        className="absolute inset-0"
        style={{
          background: alignedRight
            ? `linear-gradient(270deg, ${accent.wash} 0%, rgba(5,8,15,0.55) 45%, rgba(5,8,15,0.96) 100%)`
            : `linear-gradient(90deg, ${accent.wash} 0%, rgba(5,8,15,0.55) 45%, rgba(5,8,15,0.96) 100%)`,
        }}
      />
      <div className="absolute inset-0 bg-gradient-to-t from-ink-950 via-transparent to-ink-950/70" />
      <div className="grain-overlay" />

      {/* Oversized chapter number watermark */}
      <span
        aria-hidden="true"
        className={`pointer-events-none absolute top-1/2 -translate-y-1/2 font-tight text-[34vw] font-black leading-none text-white/[0.04] ${
          alignedRight ? 'left-[-2vw]' : 'right-[-2vw]'
        }`}
      >
        {String(index).padStart(2, '0')}
      </span>

      <div className="relative z-10 mx-auto w-full max-w-7xl px-5 sm:px-8">
        <motion.div
          initial={{ opacity: 0, y: 40 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, margin: '-15%' }}
          transition={{ duration: 0.9, ease }}
          className={`max-w-2xl ${alignedRight ? 'ml-auto text-right' : ''}`}
        >
          <div className={`mb-5 flex items-center gap-3 ${alignedRight ? 'justify-end' : ''}`}>
            <span className={`h-px w-10 ${accent.chip}`} />
            <span className={`text-xs font-semibold uppercase tracking-[0.25em] ${accent.text}`}>
              Chapter {String(index).padStart(2, '0')} · {eyebrow}
            </span>
          </div>

          <h2 className="cine-shadow font-tight text-5xl font-black leading-[0.95] tracking-tight text-white sm:text-6xl lg:text-7xl">
            {name}
          </h2>

          <p className="mt-6 text-lg leading-relaxed text-slate-200/90 sm:text-xl">{summary}</p>

          <div className={`mt-7 flex flex-wrap gap-2 ${alignedRight ? 'justify-end' : ''}`}>
            {brands.map((brand) => (
              <span
                key={brand}
                className={`rounded-full border ${accent.border} bg-white/[0.06] px-3 py-1 text-xs font-medium tracking-wide text-white/85 backdrop-blur`}
              >
                {brand}
              </span>
            ))}
          </div>

          <div className={`mt-9 flex items-center gap-7 ${alignedRight ? 'justify-end' : ''}`}>
            <div>
              <div className={`font-tight text-4xl font-black ${accent.text}`}>{stat.value}</div>
              <div className="mt-1 text-xs uppercase tracking-widest text-slate-400">
                {stat.label}
              </div>
            </div>
            <Link
              href={href}
              className="group inline-flex items-center gap-2 rounded-full border border-white/25 bg-white/5 px-7 py-3.5 text-sm font-semibold text-white backdrop-blur transition hover:border-white/60 hover:bg-white/10"
            >
              {ctaLabel}
              <svg
                className="h-4 w-4 transition-transform group-hover:translate-x-1"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
                aria-hidden="true"
              >
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 8l4 4m0 0l-4 4m4-4H3" />
              </svg>
            </Link>
          </div>
        </motion.div>
      </div>
    </section>
  );
}
