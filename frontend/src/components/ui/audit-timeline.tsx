interface TimelineEntry {
  id: string;
  action: string;
  description?: string;
  actor?: string;
  timestamp: string;
  severity?: string;
}

const SEV_DOT: Record<string, string> = {
  CRITICAL: 'bg-red-500',
  HIGH:     'bg-orange-500',
  MEDIUM:   'bg-amber-500',
  LOW:      'bg-blue-400',
};

function fmtDate(s: string) {
  try { return new Date(s).toLocaleString(); } catch { return s; }
}

export function AuditTimeline({ entries }: { entries: TimelineEntry[] }) {
  if (!entries.length) {
    return <p className="text-[13px] text-zinc-400 py-4">No audit history.</p>;
  }
  return (
    <ol className="relative border-l border-zinc-200 pl-5 space-y-5">
      {entries.map((e) => {
        const dot = SEV_DOT[e.severity ?? 'LOW'] ?? 'bg-zinc-300';
        return (
          <li key={e.id} className="relative">
            <span
              className={`absolute -left-[21px] top-1 w-3 h-3 rounded-full border-2 border-white ${dot}`}
            />
            <div className="text-[12px] text-zinc-400">{fmtDate(e.timestamp)}</div>
            <div className="text-[13px] font-medium text-zinc-800 mt-0.5">{e.action}</div>
            {e.description && <p className="text-[12px] text-zinc-500 mt-0.5">{e.description}</p>}
            {e.actor && <p className="text-[11px] text-zinc-400 mt-0.5">By {e.actor}</p>}
          </li>
        );
      })}
    </ol>
  );
}
