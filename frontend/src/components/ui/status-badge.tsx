const BADGE_MAP: Record<string, string> = {
  // ── Generic ────────────────────────────────────────────────────────────────
  ACTIVE:                'bg-emerald-50 text-emerald-700 border-emerald-200',
  INACTIVE:              'bg-zinc-100   text-zinc-500    border-zinc-200',
  PENDING:               'bg-amber-50   text-amber-700   border-amber-200',
  DRAFT:                 'bg-zinc-100   text-zinc-600    border-zinc-200',
  APPROVED:              'bg-emerald-50 text-emerald-700 border-emerald-200',
  REJECTED:              'bg-red-50     text-red-700     border-red-200',
  CANCELLED:             'bg-zinc-100   text-zinc-500    border-zinc-200',
  TERMINATED:            'bg-red-50     text-red-700     border-red-200',
  SUSPENDED:             'bg-amber-50   text-amber-700   border-amber-200',
  CLOSED:                'bg-zinc-100   text-zinc-500    border-zinc-200',
  LOCKED:                'bg-red-50     text-red-700     border-red-200',
  PENDING_APPROVAL:      'bg-amber-50   text-amber-700   border-amber-200',
  COMPLETED:             'bg-blue-50    text-blue-700    border-blue-200',
  // ── Loan / Debt ────────────────────────────────────────────────────────────
  SETTLED:               'bg-emerald-50 text-emerald-700 border-emerald-200',
  DEFAULTED:             'bg-red-50     text-red-700     border-red-200',
  RESTRUCTURED:          'bg-blue-50    text-blue-700    border-blue-200',
  OVERDUE:               'bg-red-50     text-red-700     border-red-200',
  // ── Assets ─────────────────────────────────────────────────────────────────
  UNDER_MAINTENANCE:     'bg-amber-50   text-amber-700   border-amber-200',
  DISPOSED:              'bg-zinc-100   text-zinc-500    border-zinc-200',
  LOST:                  'bg-red-50     text-red-700     border-red-200',
  SOLD:                  'bg-zinc-100   text-zinc-500    border-zinc-200',
  WRITTEN_OFF:           'bg-zinc-100   text-zinc-500    border-zinc-200',
  // ── Contracts ──────────────────────────────────────────────────────────────
  EXPIRED:               'bg-zinc-100   text-zinc-500    border-zinc-200',
  // ── Severity ───────────────────────────────────────────────────────────────
  CRITICAL:              'bg-red-50     text-red-700     border-red-200',
  HIGH:                  'bg-orange-50  text-orange-700  border-orange-200',
  MEDIUM:                'bg-amber-50   text-amber-700   border-amber-200',
  LOW:                   'bg-blue-50    text-blue-700    border-blue-200',
  // ── Condition ──────────────────────────────────────────────────────────────
  GOOD:                  'bg-emerald-50 text-emerald-700 border-emerald-200',
  FAIR:                  'bg-amber-50   text-amber-700   border-amber-200',
  POOR:                  'bg-red-50     text-red-700     border-red-200',
  EXCELLENT:             'bg-emerald-50 text-emerald-700 border-emerald-200',
  // ── Risk ───────────────────────────────────────────────────────────────────
  VERY_HIGH:             'bg-red-50     text-red-700     border-red-200',
  // ── Document ───────────────────────────────────────────────────────────────
  VALID:                 'bg-emerald-50 text-emerald-700 border-emerald-200',
  REVOKED:               'bg-red-50     text-red-700     border-red-200',
  ARCHIVED:              'bg-zinc-100   text-zinc-500    border-zinc-200',
  // ── Logistics / Trip ───────────────────────────────────────────────────────
  PLANNED:               'bg-blue-50    text-blue-700    border-blue-200',
  DISPATCHED:            'bg-purple-50  text-purple-700  border-purple-200',
  IN_TRANSIT:            'bg-cyan-50    text-cyan-700    border-cyan-200',
  ON_HOLD:               'bg-amber-50   text-amber-700   border-amber-200',
  AVAILABLE:             'bg-emerald-50 text-emerald-700 border-emerald-200',
  IN_USE:                'bg-cyan-50    text-cyan-700    border-cyan-200',
  DECOMMISSIONED:        'bg-zinc-100   text-zinc-500    border-zinc-200',
  // ── Vehicle / Fleet ────────────────────────────────────────────────────────
  OPERATIONAL:           'bg-emerald-50 text-emerald-700 border-emerald-200',
  OUT_OF_SERVICE:        'bg-red-50     text-red-700     border-red-200',
  // ── Agriculture / Crop ─────────────────────────────────────────────────────
  PLANTING:              'bg-lime-50    text-lime-700    border-lime-200',
  GROWING:               'bg-green-50   text-green-700   border-green-200',
  HARVESTING:            'bg-orange-50  text-orange-700  border-orange-200',
  HARVESTED:             'bg-emerald-50 text-emerald-700 border-emerald-200',
  // ── Construction ───────────────────────────────────────────────────────────
  BUDGETED:              'bg-blue-50    text-blue-700    border-blue-200',
  IN_PROGRESS:           'bg-cyan-50    text-cyan-700    border-cyan-200',
  ISSUED:                'bg-purple-50  text-purple-700  border-purple-200',
  POSTED:                'bg-emerald-50 text-emerald-700 border-emerald-200',
  SUBMITTED:             'bg-amber-50   text-amber-700   border-amber-200',
  CERTIFIED:             'bg-emerald-50 text-emerald-700 border-emerald-200',
  DISPUTED:              'bg-red-50     text-red-700     border-red-200',
  PAID:                  'bg-emerald-50 text-emerald-700 border-emerald-200',
  PARTIAL:               'bg-amber-50   text-amber-700   border-amber-200',
  PARTIALLY_PAID:        'bg-amber-50   text-amber-700   border-amber-200',
  // ── Rentals ─────────────────────────────────────────────────────────────────
  VACANT:                'bg-blue-50    text-blue-700    border-blue-200',
  OCCUPIED:              'bg-emerald-50 text-emerald-700 border-emerald-200',
  RESERVED:              'bg-purple-50  text-purple-700  border-purple-200',
  PENDING_RENEWAL:       'bg-amber-50   text-amber-700   border-amber-200',
  // ── Parking ─────────────────────────────────────────────────────────────────
  VOIDED:                'bg-zinc-100   text-zinc-500    border-zinc-200',
  // ── Hospitality / Rooms ─────────────────────────────────────────────────────
  CHECKED_IN:            'bg-cyan-50    text-cyan-700    border-cyan-200',
  CHECKED_OUT:           'bg-zinc-100   text-zinc-500    border-zinc-200',
  NO_SHOW:               'bg-red-50     text-red-700     border-red-200',
  AVAILABLE_FOR_SALE:    'bg-emerald-50 text-emerald-700 border-emerald-200',
  OUT_OF_ORDER:          'bg-red-50     text-red-700     border-red-200',
  DIRTY:                 'bg-amber-50   text-amber-700   border-amber-200',
  CLEAN:                 'bg-emerald-50 text-emerald-700 border-emerald-200',
  INSPECTED:             'bg-blue-50    text-blue-700    border-blue-200',
  DO_NOT_DISTURB:        'bg-red-50     text-red-700     border-red-200',
  ON_QUEUE:              'bg-purple-50  text-purple-700  border-purple-200',
  // ── Restaurant / Orders ──────────────────────────────────────────────────────
  OPEN:                  'bg-blue-50    text-blue-700    border-blue-200',
  PREPARING:             'bg-amber-50   text-amber-700   border-amber-200',
  READY:                 'bg-emerald-50 text-emerald-700 border-emerald-200',
  SERVED:                'bg-zinc-100   text-zinc-600    border-zinc-200',
  REFUNDED:              'bg-red-50     text-red-700     border-red-200',
  // ── Business Licenses ────────────────────────────────────────────────────────
  PENDING_RENEWAL_BL:    'bg-amber-50   text-amber-700   border-amber-200',
  // ── Finance / Payroll ─────────────────────────────────────────────────────────
  FINALIZED:             'bg-emerald-50 text-emerald-700 border-emerald-200',
  PROCESSING:            'bg-blue-50    text-blue-700    border-blue-200',
  FAILED:                'bg-red-50     text-red-700     border-red-200',
  REVERSED:              'bg-red-50     text-red-700     border-red-200',
  // ── Petroleum / Fuel ──────────────────────────────────────────────────────────
  OPEN_SHIFT:            'bg-cyan-50    text-cyan-700    border-cyan-200',
  CLOSED_SHIFT:          'bg-zinc-100   text-zinc-500    border-zinc-200',
  RECONCILED:            'bg-emerald-50 text-emerald-700 border-emerald-200',
};

function humanize(s: string) {
  return s.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

interface StatusBadgeProps {
  status?: string;
  value?: string;
  className?: string;
}

export function StatusBadge({ status, value, className = '' }: StatusBadgeProps) {
  const label = status ?? value ?? 'UNKNOWN';
  const style = BADGE_MAP[label] ?? 'bg-zinc-100 text-zinc-600 border-zinc-200';
  return (
    <span
      className={`inline-flex items-center border rounded-full px-2 py-0.5 text-[11px] font-medium leading-none whitespace-nowrap ${style} ${className}`}
    >
      {humanize(label)}
    </span>
  );
}
