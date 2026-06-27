'use client';

import { useEffect, useState } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';

interface OutlineItem {
  id: string;
  title: string;
}

/**
 * Company-profile table of contents. Desktop renders a sticky scrollspy list
 * (active section tracked via IntersectionObserver); mobile renders a fixed
 * "Contents" pill that opens a bottom sheet of the same anchors. Both are
 * print-hidden (and the mobile pieces are `fixed`, so the print `.fixed`
 * rule hides them too). Data comes from the page's `outline` array.
 */
export default function ProfileNav({ outline }: { outline: readonly OutlineItem[] }) {
  const [activeId, setActiveId] = useState(outline[0]?.id ?? '');
  const [open, setOpen] = useState(false);
  const reduceMotion = useReducedMotion();

  useEffect(() => {
    const sections = outline
      .map((item) => document.getElementById(item.id))
      .filter((el): el is HTMLElement => Boolean(el));
    if (!sections.length) return;

    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries
          .filter((entry) => entry.isIntersecting)
          .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top);
        if (visible[0]) setActiveId(visible[0].target.id);
      },
      { rootMargin: '-25% 0px -65% 0px', threshold: 0 },
    );
    sections.forEach((el) => observer.observe(el));
    return () => observer.disconnect();
  }, [outline]);

  const activeIndex = Math.max(
    0,
    outline.findIndex((item) => item.id === activeId),
  );

  const renderList = (onNavigate?: () => void) => (
    <nav aria-label="Company profile sections" className="space-y-1">
      {outline.map((item, index) => {
        const active = item.id === activeId;
        return (
          <a
            key={item.id}
            href={`#${item.id}`}
            aria-current={active ? 'true' : undefined}
            onClick={onNavigate}
            className={`flex gap-3 rounded-md px-3 py-2 text-sm transition ${
              active
                ? 'bg-white/[0.06] text-white'
                : 'text-slate-400 hover:bg-white/[0.04] hover:text-white'
            }`}
          >
            <span className={`w-5 flex-shrink-0 text-xs font-black ${active ? 'text-gold-300' : 'text-gold-500'}`}>
              {index + 1}
            </span>
            <span>{item.title}</span>
          </a>
        );
      })}
    </nav>
  );

  return (
    <>
      {/* Desktop: sticky scrollspy card */}
      <div className="hidden rounded-2xl border border-white/10 bg-white/[0.03] p-5 lg:block">
        <p className="mb-4 text-xs font-semibold uppercase tracking-widest text-gold-400">Profile Outline</p>
        {renderList()}
      </div>

      {/* Mobile: fixed "Contents" pill + bottom sheet */}
      <div className="lg:hidden">
        <button
          type="button"
          onClick={() => setOpen((value) => !value)}
          aria-expanded={open}
          aria-label="Open profile contents"
          className="fixed bottom-5 left-4 z-40 inline-flex items-center gap-2 rounded-full border border-white/15 bg-ink-900/90 px-4 py-2.5 text-sm font-semibold text-white shadow-xl shadow-ink-950/40 backdrop-blur"
        >
          <span className="text-gold-300">{activeIndex + 1}</span>
          Contents
        </button>
        <AnimatePresence>
          {open && (
            <>
              <motion.div
                key="profilenav-scrim"
                className="fixed inset-0 z-40 bg-ink-950/60 backdrop-blur-sm"
                initial={reduceMotion ? false : { opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={reduceMotion ? undefined : { opacity: 0 }}
                onClick={() => setOpen(false)}
              />
              <motion.div
                key="profilenav-sheet"
                className="fixed inset-x-3 bottom-3 z-50 max-h-[70vh] overflow-y-auto rounded-2xl border border-white/10 bg-ink-900 p-5"
                initial={reduceMotion ? false : { opacity: 0, y: 24 }}
                animate={{ opacity: 1, y: 0 }}
                exit={reduceMotion ? undefined : { opacity: 0, y: 24 }}
                transition={{ duration: 0.25, ease: [0.22, 1, 0.36, 1] }}
              >
                <p className="mb-4 text-xs font-semibold uppercase tracking-widest text-gold-400">Jump to section</p>
                {renderList(() => setOpen(false))}
              </motion.div>
            </>
          )}
        </AnimatePresence>
      </div>
    </>
  );
}
