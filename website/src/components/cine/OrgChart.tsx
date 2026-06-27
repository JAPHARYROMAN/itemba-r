interface OrgCompany {
  id: string;
  name: string;
  tin: string;
  incorporationDate: string;
  incorporationNumber: string;
}

const ACCENT: Record<string, { text: string; border: string; bg: string; dot: string }> = {
  mwanjalisi: { text: 'text-amber-300', border: 'border-amber-400/30', bg: 'bg-amber-500/[0.08]', dot: 'bg-amber-400' },
  westsides: { text: 'text-blue-300', border: 'border-blue-400/30', bg: 'bg-blue-500/[0.08]', dot: 'bg-blue-400' },
  enterprises: { text: 'text-emerald-300', border: 'border-emerald-400/30', bg: 'bg-emerald-500/[0.08]', dot: 'bg-emerald-400' },
};

/**
 * Ownership / structure tree: the parent holding above its three operating
 * companies, each carrying its registered TIN and incorporation details. Static
 * (no client JS); the authoritative directors/TIN grid still renders below it.
 */
export default function OrgChart({ companies }: { companies: readonly OrgCompany[] }) {
  return (
    <div className="rounded-2xl border border-white/10 bg-white/[0.02] p-6 sm:p-8">
      {/* Parent holding */}
      <div className="mx-auto max-w-sm rounded-2xl border border-gold-500/30 bg-gold-500/[0.08] p-5 text-center">
        <p className="text-[0.7rem] font-bold uppercase tracking-[0.2em] text-gold-400">Parent holding</p>
        <p className="mt-1 font-tight text-xl font-black text-white">Itemba Group</p>
        <p className="mt-1.5 text-xs leading-relaxed text-slate-400">
          Strategic oversight · governance · coordination
        </p>
      </div>

      {/* Connector */}
      <div className="mx-auto my-5 h-6 w-px bg-white/15" aria-hidden="true" />

      {/* Operating companies */}
      <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
        {companies.map((company) => {
          const accent = ACCENT[company.id] ?? ACCENT.enterprises;
          return (
            <div key={company.id} className={`rounded-2xl border ${accent.border} ${accent.bg} p-5`}>
              <div className="flex items-center gap-2">
                <span className={`h-2 w-2 rounded-full ${accent.dot}`} aria-hidden="true" />
                <p className={`text-[0.7rem] font-bold uppercase tracking-widest ${accent.text}`}>Operating company</p>
              </div>
              <p className="mt-2 font-tight text-base font-black leading-tight text-white">{company.name}</p>
              <dl className="mt-3 space-y-1.5 text-xs text-slate-400">
                <div className="flex justify-between gap-2">
                  <dt>TIN</dt>
                  <dd className="text-slate-300">{company.tin}</dd>
                </div>
                <div className="flex justify-between gap-2">
                  <dt>Incorporated</dt>
                  <dd className="text-right text-slate-300">{company.incorporationDate}</dd>
                </div>
                <div className="flex justify-between gap-2">
                  <dt>Reg. No.</dt>
                  <dd className="text-slate-300">{company.incorporationNumber}</dd>
                </div>
              </dl>
            </div>
          );
        })}
      </div>
    </div>
  );
}
