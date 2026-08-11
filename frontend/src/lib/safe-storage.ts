/**
 * Best-effort localStorage access. Private browsing, disabled storage, or a
 * full quota must never crash a feature — persistence is an enhancement, and
 * callers that care can branch on the boolean result.
 */
export function safeLocalStorageSet(key: string, value: string): boolean {
  try {
    window.localStorage.setItem(key, value);
    return true;
  } catch {
    return false;
  }
}

export function safeLocalStorageGet(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}
