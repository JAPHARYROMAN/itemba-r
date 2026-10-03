import type { PartyKind } from './party-balance.helper';

/**
 * Party linkage (Phase 3): the one place the backend knows where a party opens, for
 * destinations it must persist (alert metadata, notification actionUrl). Mirrors
 * `openPartyIn('profile', kind, id)` in frontend/src/features/party/party-links.ts; the
 * alerts page prefers its own helper when it has the linked entity, so a route change is
 * two edits, never a guessed path.
 */
export function partyProfileHref(kind: PartyKind, id: string): string {
  const key = encodeURIComponent(id);
  return kind === 'supplier' ? `/invoice-desk/suppliers/${key}` : `/sales-desk/customers/${key}`;
}
