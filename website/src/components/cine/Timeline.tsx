interface TimelineItem {
  date: string;
  title: string;
  body: string;
}

/**
 * Vertical cinematic timeline with a gold rail and gold nodes. Static (no client
 * JS); the surrounding ProfileSection already provides the scroll reveal.
 */
export default function Timeline({ items }: { items: readonly TimelineItem[] }) {
  return (
    <div className="relative">
      <div
        aria-hidden="true"
        className="absolute bottom-2 left-[7px] top-2 w-px bg-gradient-to-b from-gold-400 via-gold-500/40 to-transparent sm:left-[9px]"
      />
      <ol className="space-y-7">
        {items.map((item) => (
          <li key={item.title} className="relative pl-8 sm:pl-10">
            <span
              aria-hidden="true"
              className="absolute left-0 top-1.5 flex h-4 w-4 items-center justify-center rounded-full border border-gold-400/50 bg-ink-950 sm:h-5 sm:w-5"
            >
              <span className="h-1.5 w-1.5 rounded-full bg-gold-400" />
            </span>
            <p className="text-xs font-black uppercase tracking-widest text-gold-400">{item.date}</p>
            <h3 className="mt-1 font-tight text-lg font-black leading-tight text-white">{item.title}</h3>
            <p className="mt-2 max-w-2xl text-sm leading-relaxed text-slate-300">{item.body}</p>
          </li>
        ))}
      </ol>
    </div>
  );
}
