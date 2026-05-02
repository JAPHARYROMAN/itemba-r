// ITEMBA-R Aurora Design System — Status Helpers

export type StatusVariant = 'default' | 'success' | 'warning' | 'danger' | 'info' | 'restricted' | 'muted' | 'primary';

const STATUS_MAP: Record<string, StatusVariant> = {
  // Active / positive
  ACTIVE: 'success', ENABLED: 'success', OPEN: 'success', RUNNING: 'primary',
  LIVE: 'success', PUBLISHED: 'success', VERIFIED: 'success', APPROVED: 'success',
  POSTED: 'success', PAID: 'success', COMPLETED: 'success', CLOSED: 'success',
  RESOLVED: 'success', ACKNOWLEDGED: 'info', CLEAR: 'success',
  // Warning / pending
  PENDING: 'warning', DRAFT: 'warning', REQUESTED: 'warning', REVIEW: 'warning',
  ACTION_REQUIRED: 'warning',
  PARTIALLY_PAID: 'warning', PARTIAL: 'warning', SUBMITTED: 'info',
  RUNNING_JOB: 'primary', IN_PROGRESS: 'primary', PROCESSING: 'primary',
  // Danger / negative
  INACTIVE: 'muted', REJECTED: 'danger', FAILED: 'danger', CANCELLED: 'muted',
  OVERDUE: 'danger', EXPIRED: 'danger', BLOCKED: 'danger', CRITICAL: 'danger',
  SUSPENDED: 'danger', DEFAULTED: 'danger', NEGATIVE: 'danger',
  // Restricted
  RESTRICTED: 'restricted', SENSITIVE: 'restricted',
  // Info
  INFO: 'info', HIGH: 'danger', NORMAL: 'info', LOW: 'muted',
  MEDIUM: 'warning',
  // Dismissed / neutral
  DISMISSED: 'muted', ARCHIVED: 'muted', DEACTIVATED: 'muted',
  SYSTEM: 'info', USER: 'primary', AI_ASSISTED: 'restricted',
};

export function getStatusVariant(status: string | null | undefined): StatusVariant {
  if (!status) return 'muted';
  return STATUS_MAP[status.toUpperCase()] ?? 'default';
}

export function getRiskVariant(level: string | null | undefined): StatusVariant {
  if (!level) return 'muted';
  const map: Record<string, StatusVariant> = {
    LOW: 'success', MEDIUM: 'warning', HIGH: 'danger', CRITICAL: 'danger', EXTREME: 'danger',
  };
  return map[level.toUpperCase()] ?? 'muted';
}

export function getPriorityVariant(priority: string | null | undefined): StatusVariant {
  if (!priority) return 'muted';
  const map: Record<string, StatusVariant> = {
    LOW: 'muted', NORMAL: 'default', MEDIUM: 'info', HIGH: 'warning', URGENT: 'danger', CRITICAL: 'danger',
  };
  return map[priority.toUpperCase()] ?? 'default';
}

export function getPaymentStatusVariant(status: string | null | undefined): StatusVariant {
  if (!status) return 'muted';
  const map: Record<string, StatusVariant> = {
    PAID: 'success', PARTIALLY_PAID: 'warning', UNPAID: 'danger',
    OVERDUE: 'danger', PENDING: 'warning', REFUNDED: 'info', CANCELLED: 'muted',
  };
  return map[status.toUpperCase()] ?? 'muted';
}

export function getApprovalStatusVariant(status: string | null | undefined): StatusVariant {
  if (!status) return 'muted';
  const map: Record<string, StatusVariant> = {
    PENDING: 'warning', APPROVED: 'success', REJECTED: 'danger',
    CANCELLED: 'muted', ESCALATED: 'danger', IN_REVIEW: 'info',
  };
  return map[status.toUpperCase()] ?? 'muted';
}

export function getComplianceStatusVariant(status: string | null | undefined): StatusVariant {
  if (!status) return 'muted';
  const map: Record<string, StatusVariant> = {
    COMPLIANT: 'success', NON_COMPLIANT: 'danger', PARTIAL: 'warning',
    PENDING_REVIEW: 'info', EXPIRED: 'danger', UPCOMING: 'warning',
  };
  return map[status.toUpperCase()] ?? 'muted';
}

export function getInventoryStatusVariant(qty: number | null | undefined, reorderPoint?: number | null): StatusVariant {
  if (qty === null || qty === undefined) return 'muted';
  if (qty <= 0) return 'danger';
  if (reorderPoint && qty <= reorderPoint) return 'warning';
  return 'success';
}

// Status variant → CSS classes map
export const STATUS_CLASSES: Record<StatusVariant, string> = {
  default: 'bg-zinc-100 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300',
  success: 'bg-emerald-50 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400',
  warning: 'bg-amber-50 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400',
  danger: 'bg-red-50 text-red-700 dark:bg-red-900/30 dark:text-red-400',
  info: 'bg-cyan-50 text-cyan-700 dark:bg-cyan-900/30 dark:text-cyan-400',
  restricted: 'bg-violet-50 text-violet-700 dark:bg-violet-900/30 dark:text-violet-400',
  muted: 'bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400',
  primary: 'bg-blue-50 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400',
};

export const DOT_CLASSES: Record<StatusVariant, string> = {
  default: 'bg-zinc-400',
  success: 'bg-emerald-500',
  warning: 'bg-amber-500',
  danger: 'bg-red-500',
  info: 'bg-cyan-500',
  restricted: 'bg-violet-500',
  muted: 'bg-slate-400',
  primary: 'bg-blue-500',
};
