/**
 * Release switch for the ITEMBA OS shell (POS_REMAKE_PLAN_2026-09-23.md §3 P3).
 *
 * Off (the default) renders the pre-OS experience: sidebar + topbar dashboard,
 * the original sign-in page, and `/` landing on `/dashboard`. On renders the
 * OS desktop, dock, windows and OS sign-in. Only the shell is switched; pages,
 * APIs and the POS are the same code either way.
 *
 * NEXT_PUBLIC_ variables are inlined at build time, so flipping this needs a
 * rebuild of the frontend image (build arg NEXT_PUBLIC_ITEMBA_OS_ENABLED).
 * Anything other than the exact string "true" is off.
 */
export function isItembaOsEnabled(value: string | undefined): boolean {
  return value === 'true';
}

export const ITEMBA_OS_ENABLED = isItembaOsEnabled(process.env.NEXT_PUBLIC_ITEMBA_OS_ENABLED);
