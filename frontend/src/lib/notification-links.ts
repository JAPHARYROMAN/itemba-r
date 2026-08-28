const INTERNAL_ACTION_ORIGIN = 'https://itemba.invalid';

/**
 * Notification action URLs are persisted data. Only a same-origin absolute
 * path may become a navigation target; malformed or scheme-relative values are
 * rendered as inert notification text.
 */
export function safeNotificationActionUrl(value: unknown): string | null {
  if (
    typeof value !== 'string' ||
    !value.startsWith('/') ||
    value.startsWith('//') ||
    value.includes('\\') ||
    /[\u0000-\u001f\u007f]/.test(value)
  ) {
    return null;
  }

  try {
    const parsed = new URL(value, INTERNAL_ACTION_ORIGIN);
    if (parsed.origin !== INTERNAL_ACTION_ORIGIN || parsed.username || parsed.password) return null;
    return `${parsed.pathname}${parsed.search}${parsed.hash}`;
  } catch {
    return null;
  }
}
