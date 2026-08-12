import type { PosStringKey } from './pos-i18n';
import type { PosTranslate } from './pos-types';

/**
 * Best-effort map from backend rejection free-text to plain-Swahili keys for
 * the rejected-sale ritual (spec-sales §5.3/§6). The backend emits English
 * prose, not error codes, so this is pattern matching by design — real error
 * codes are an audit-track ask, not a blocker.
 *
 * TRIPWIRE — these patterns are coupled to the exact backend copy below.
 * If backend wording changes, rows silently fall through to the generic
 * fallback (safe, but less helpful). Sources, verified 2026-08-12:
 * - backend/src/modules/inventory-movements/inventory-movements.service.ts
 *     "Insufficient stock at branch/location …: requested …, available …"
 *     "Insufficient available stock at branch/location …: … after reservations"
 * - backend/src/modules/mobile-pos-lite/mobile-pos-lite.service.ts
 *     "One or more products are unavailable for this terminal"
 *     "<name> does not have a selling price"
 *     "Activate this Mobile POS device before selling"
 *     "This Mobile POS terminal is not active"
 *     "This device is not registered for the selected Mobile POS terminal"
 *     "This Mobile POS terminal is assigned to a different sales rep"
 *     "The assigned Mobile POS user is not active"
 *     "Credit is not enabled on this Mobile POS terminal"
 *     "Select the customer before completing a credit sale"
 *     "The selected customer is not available for this terminal branch"
 * - backend/src/modules/sales-orders/sales-orders.service.ts
 *     "Credit sale exceeds <name>'s credit limit. Limit: …"
 *     "Blocked customers cannot be used for credit sales"
 */
const ERROR_PATTERNS: ReadonlyArray<{ pattern: RegExp; key: PosStringKey }> = [
  // Insufficient stock (inventory-movements issue path)
  { pattern: /insufficient (available )?stock/i, key: 'errInsufficientStock' },
  // Product inactive / unpriced / not visible to this terminal
  {
    pattern: /products? (is|are) unavailable for this terminal|does not have a selling price/i,
    key: 'errProductUnavailable',
  },
  // Terminal suspended / device unbound / rep mismatch (requireTerminal chain)
  {
    pattern:
      /terminal is not active|device is not registered|assigned to a different sales rep|mobile pos user is not active|activate this mobile pos device/i,
    key: 'terminalUnavailable',
  },
  // Credit limit breached
  { pattern: /credit limit/i, key: 'errCreditLimit' },
  // Credit customer invalid / blocked / credit disabled on the terminal
  {
    pattern:
      /blocked customers|customer is not available for this terminal|select the customer before|credit is not enabled/i,
    key: 'errCustomerInvalid',
  },
  // Idempotency replay conflicts (best-effort; the sale path normally replays
  // silently, so this only catches explicit duplicate/idempotency copy)
  { pattern: /idempoten|duplicate/i, key: 'errAlreadySent' },
];

/** The i18n key a raw backend rejection maps to (exported for tests). */
export function posErrorKey(raw: string): PosStringKey {
  const match = ERROR_PATTERNS.find(({ pattern }) => pattern.test(raw));
  return match?.key ?? 'errorFallback';
}

/**
 * Plain-Swahili (or English, per the active language) message for a raw
 * backend rejection string. Unknown copy falls back to
 * `errorFallback` ("Haikukubaliwa — mwite msimamizi").
 */
export function posErrorMessage(raw: string, t: PosTranslate): string {
  return t(posErrorKey(raw));
}
