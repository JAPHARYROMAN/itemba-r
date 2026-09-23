import type { CartLine, PosPriceReason, Session } from './pos-types';

/**
 * Price editing on the till (POS_REMAKE_PLAN_2026-09-23.md section 5).
 *
 * These helpers only decide what the phone OFFERS. The server re-checks every
 * edited line against the permission, the terminal limit and the below-cost
 * guard, and answers a refusal in one cost-blind sentence; nothing here is a
 * control the server trusts.
 */
export const POS_PRICE_REASONS: readonly PosPriceReason[] = [
  'REGULAR_CUSTOMER',
  'BULK_OFFER',
  'DAMAGED',
  'OTHER',
];

/** What the rep is charging for one unit of this line (VAT-inclusive). */
export function lineUnitPrice(line: CartLine): number {
  return line.price?.unitPrice ?? line.product.sellingPrice;
}

/** Positive for a discount, negative for an increase, as a percent of list. */
export function priceDropPct(listPrice: number, charged: number): number {
  if (listPrice <= 0) return 0;
  return ((listPrice - charged) / listPrice) * 100;
}

export type PriceCheck =
  | { kind: 'same' }
  | { kind: 'rise'; pct: number }
  | { kind: 'drop'; pct: number; limit: number | null }
  | { kind: 'overLimit'; pct: number; limit: number }
  | { kind: 'invalid' };

/**
 * Mirrors the server's rule: raising needs only the permission; lowering is
 * capped by the terminal's maxPriceDropPct unless the user is unlimited
 * (limit: null). The below-cost guard is the server's alone: the phone never
 * knows a cost.
 */
export function checkPrice(session: Session, listPrice: number, charged: number): PriceCheck {
  if (!Number.isFinite(charged) || charged < 1) return { kind: 'invalid' };
  if (charged === listPrice) return { kind: 'same' };
  const pct = priceDropPct(listPrice, charged);
  if (pct < 0) return { kind: 'rise', pct: -pct };
  if (session.priceEditUnlimited) return { kind: 'drop', pct, limit: null };
  const limit = session.maxPriceDropPct ?? 0;
  return pct > limit + 1e-9 ? { kind: 'overLimit', pct, limit } : { kind: 'drop', pct, limit };
}

/** Rounded for display: one decimal only when it matters (4.7%, 10%). */
export function formatPct(pct: number): string {
  const rounded = Math.round(pct * 10) / 10;
  return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1);
}
