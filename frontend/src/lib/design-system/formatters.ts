// ITEMBA-R Aurora Design System — Formatters

export function toFiniteNumber(value: number | string | null | undefined, fallback = 0): number {
  if (value === null || value === undefined || value === '') return fallback;
  const num = typeof value === 'string' ? Number(value) : value;
  return Number.isFinite(num) ? num : fallback;
}

/**
 * Format a number as Tanzanian Shillings (or any currency)
 */
export function formatMoney(
  value: number | string | null | undefined,
  currency = 'TZS',
  options?: { compact?: boolean; decimals?: number }
): string {
  if (value === null || value === undefined || value === '') return '—';
  const num = toFiniteNumber(value, Number.NaN);
  if (!Number.isFinite(num)) return '—';

  if (options?.compact) {
    if (Math.abs(num) >= 1_000_000_000) return `${currency} ${(num / 1_000_000_000).toFixed(1)}B`;
    if (Math.abs(num) >= 1_000_000) return `${currency} ${(num / 1_000_000).toFixed(1)}M`;
    if (Math.abs(num) >= 1_000) return `${currency} ${(num / 1_000).toFixed(1)}K`;
  }

  const decimals = options?.decimals ?? 0;
  return `${currency} ${num.toLocaleString('en-US', { minimumFractionDigits: decimals, maximumFractionDigits: decimals })}`;
}

/**
 * Format a date string as readable date (e.g., "25 Apr 2026")
 */
export function formatDate(value: string | Date | null | undefined): string {
  if (!value) return '—';
  try {
    return new Date(value).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
  } catch {
    return '—';
  }
}

/**
 * Format a date string with time (e.g., "25 Apr 2026, 14:32")
 */
export function formatDateTime(value: string | Date | null | undefined): string {
  if (!value) return '—';
  try {
    return new Date(value).toLocaleDateString('en-GB', {
      day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit',
    });
  } catch {
    return '—';
  }
}

/**
 * Format a number with thousands separator
 */
export function formatNumber(value: number | string | null | undefined, decimals = 0): string {
  if (value === null || value === undefined || value === '') return '—';
  const num = toFiniteNumber(value, Number.NaN);
  if (!Number.isFinite(num)) return '—';
  return num.toLocaleString('en-US', { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
}

/**
 * Format a number as a percentage (e.g., "45.2%")
 */
export function formatPercent(value: number | string | null | undefined, decimals = 1): string {
  if (value === null || value === undefined || value === '') return '—';
  const num = toFiniteNumber(value, Number.NaN);
  if (!Number.isFinite(num)) return '—';
  return `${num.toFixed(decimals)}%`;
}

/**
 * Format a quantity with unit (e.g., "1,234 L")
 */
export function formatQuantity(value: number | string | null | undefined, unit = '', decimals = 0): string {
  if (value === null || value === undefined || value === '') return '—';
  const num = toFiniteNumber(value, Number.NaN);
  if (!Number.isFinite(num)) return '—';
  const formatted = num.toLocaleString('en-US', { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
  return unit ? `${formatted} ${unit}` : formatted;
}

/**
 * Format a status string to a readable label (e.g., PARTIALLY_PAID → Partially Paid)
 */
export function formatStatusLabel(status: string | null | undefined): string {
  if (!status) return '—';
  return status.replace(/_/g, ' ').toLowerCase().replace(/\b\w/g, c => c.toUpperCase());
}

/**
 * Format a user's display name
 */
export function formatUserName(user: { firstName?: string; lastName?: string; name?: string; email?: string } | null | undefined): string {
  if (!user) return '—';
  if (user.firstName && user.lastName) return `${user.firstName} ${user.lastName}`;
  if (user.name) return user.name;
  if (user.email) return user.email.split('@')[0];
  return '—';
}

/**
 * Format a company code + name
 */
export function formatCompanyName(company: { name: string; code?: string } | null | undefined): string {
  if (!company) return '—';
  return company.code ? `${company.code} — ${company.name}` : company.name;
}

/**
 * Get relative time label (e.g., "2 hours ago", "3 days ago")
 */
export function formatRelativeTime(value: string | Date | null | undefined): string {
  if (!value) return '—';
  try {
    const date = new Date(value);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMins / 60);
    const diffDays = Math.floor(diffHours / 24);
    if (diffMins < 1) return 'just now';
    if (diffMins < 60) return `${diffMins}m ago`;
    if (diffHours < 24) return `${diffHours}h ago`;
    if (diffDays < 30) return `${diffDays}d ago`;
    return formatDate(value);
  } catch {
    return '—';
  }
}

/**
 * Truncate text with ellipsis
 */
export function truncate(text: string | null | undefined, maxLength = 50): string {
  if (!text) return '—';
  if (text.length <= maxLength) return text;
  return text.slice(0, maxLength) + '…';
}
