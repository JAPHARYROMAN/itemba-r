/**
 * posErrorMessage — the rejected-sale ritual's plain-Swahili map.
 *
 * TRIPWIRE SUITE: every string below is the EXACT copy the backend throws on
 * the mobile sale path (see pos-errors.ts header for file/line provenance).
 * If a backend message is reworded, its case here fails — that is the point:
 * the map must be re-verified, not silently degraded to the fallback.
 */
import { describe, expect, it } from 'vitest';
import { posErrorKey, posErrorMessage } from './pos-errors';
import type { PosTranslate } from './pos-types';

const t: PosTranslate = (key) => `<${key}>`;

describe('posErrorKey — exact backend strings', () => {
  it.each([
    // inventory-movements.service.ts (SALE_ISSUE guards)
    [
      'Insufficient stock at branch/location b-123: requested 5, available 2',
      'errInsufficientStock',
    ],
    [
      'Insufficient available stock at branch/location b-123: requested 5, available 1 after reservations',
      'errInsufficientStock',
    ],
    // mobile-pos-lite.service.ts resolveSaleLines
    ['One or more products are unavailable for this terminal', 'errProductUnavailable'],
    ['Soda Baridi does not have a selling price', 'errProductUnavailable'],
    // mobile-pos-lite.service.ts requireTerminal / assertAssignedUserCanSell
    ['Activate this Mobile POS device before selling', 'terminalUnavailable'],
    ['This Mobile POS terminal is not active', 'terminalUnavailable'],
    ['This device is not registered for the selected Mobile POS terminal', 'terminalUnavailable'],
    ['This Mobile POS terminal is assigned to a different sales rep', 'terminalUnavailable'],
    ['The assigned Mobile POS user is not active', 'terminalUnavailable'],
    // sales-orders.service.ts assertCustomerCreditAvailable
    [
      "Credit sale exceeds Asha Duka's credit limit. Limit: 100000.00, current balance: 90000.00, this sale: 25000.00",
      'errCreditLimit',
    ],
    ['Blocked customers cannot be used for credit sales', 'errCustomerInvalid'],
    // mobile-pos-lite.service.ts createSale credit guards
    ['Credit is not enabled on this Mobile POS terminal', 'errCustomerInvalid'],
    ['Select the customer before completing a credit sale', 'errCustomerInvalid'],
    ['The selected customer is not available for this terminal branch', 'errCustomerInvalid'],
    // best-effort duplicate/idempotency copy
    ['Duplicate sale detected', 'errAlreadySent'],
    ['Idempotency conflict', 'errAlreadySent'],
  ])('%s → %s', (raw, key) => {
    expect(posErrorKey(raw)).toBe(key);
  });

  it('falls back to errorFallback for unknown backend copy', () => {
    expect(posErrorKey('Something completely new went wrong')).toBe('errorFallback');
    expect(posErrorKey('')).toBe('errorFallback');
    // Near-miss guard: the payment-method message must NOT be mistaken for
    // the credit-disabled one.
    expect(posErrorKey('This payment method is not enabled on this Mobile POS terminal')).toBe(
      'errorFallback',
    );
  });
});

describe('posErrorMessage', () => {
  it('translates the mapped key through t', () => {
    expect(
      posErrorMessage('Insufficient stock at branch/location b-1: requested 2, available 0', t),
    ).toBe('<errInsufficientStock>');
    expect(posErrorMessage('total mystery', t)).toBe('<errorFallback>');
  });
});
