interface Leader {
  name: string;
  groupRole: string;
  companyRole: string;
}

/** First + last initial, e.g. "Roman M Mwampuwa" → "RM". */
function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

/** Dark monogram-avatar card for a member of the leadership team. */
export default function LeadershipCard({ leader }: { leader: Leader }) {
  return (
    <div className="h-full rounded-2xl border border-white/10 bg-white/[0.03] p-6 print:shadow-none">
      <div className="flex items-center gap-4">
        <span
          aria-hidden="true"
          className="flex h-12 w-12 flex-shrink-0 items-center justify-center rounded-full bg-gold-500/10 text-sm font-black text-gold-300 ring-1 ring-gold-500/30"
        >
          {initials(leader.name)}
        </span>
        <h3 className="font-tight text-lg font-black leading-tight text-white">{leader.name}</h3>
      </div>
      <dl className="mt-5 space-y-3 text-sm">
        <div>
          <dt className="text-xs font-semibold uppercase tracking-widest text-gold-400">Group role</dt>
          <dd className="mt-1 leading-relaxed text-slate-300">{leader.groupRole}</dd>
        </div>
        <div>
          <dt className="text-xs font-semibold uppercase tracking-widest text-gold-400">Company responsibility</dt>
          <dd className="mt-1 leading-relaxed text-slate-300">{leader.companyRole}</dd>
        </div>
      </dl>
    </div>
  );
}
