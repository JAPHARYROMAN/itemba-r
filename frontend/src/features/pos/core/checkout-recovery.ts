import type { PendingMobilePosLiteSale } from '@/lib/mobile-pos-lite-store';
import type { SaleResult } from './pos-types';

export type CheckoutObservation =
  | { state: 'confirmed'; sale: SaleResult }
  | { state: 'not_found' }
  | { state: 'needs_attention'; reference: string };

type Dependencies = {
  save: (attempt: PendingMobilePosLiteSale) => Promise<unknown>;
  remove: (id: string) => Promise<unknown>;
  submit: (payload: PendingMobilePosLiteSale['payload']) => Promise<SaleResult>;
  observe: (key: string) => Promise<CheckoutObservation>;
  connectionFailure: (error: unknown) => boolean;
};

export type CheckoutOutcome =
  | { kind: 'confirmed'; sale: SaleResult }
  | { kind: 'queued'; attempt: PendingMobilePosLiteSale }
  | { kind: 'review'; attempt: PendingMobilePosLiteSale; error?: unknown }
  | { kind: 'rejected'; error: unknown };

/** One durable request identity, even after the server committed but its response was lost. */
export async function sendCheckout(
  attempt: PendingMobilePosLiteSale,
  dependencies: Dependencies,
  offlineCashEnabled: boolean,
): Promise<CheckoutOutcome> {
  const frozen = structuredClone({ ...attempt, requiresReview: true });
  await dependencies.save(frozen); // Failure here MUST prevent submission.
  try {
    const sale = await dependencies.submit(frozen.payload);
    // The server acknowledgement is authoritative even when device cleanup fails.
    await dependencies.remove(frozen.id).catch(() => undefined);
    return { kind: 'confirmed', sale };
  } catch (error) {
    const connection = dependencies.connectionFailure(error);
    if (!connection) {
      try {
        const observed = await dependencies.observe(frozen.payload.idempotencyKey);
        if (observed.state === 'confirmed') {
          await dependencies.remove(frozen.id).catch(() => undefined);
          return { kind: 'confirmed', sale: observed.sale };
        }
        // An authoritative validation failure with NO record can be corrected.
        // Permission errors, conflicts and incomplete orders remain protected.
        const status = (error as { status?: unknown } | null)?.status;
        if (observed.state === 'not_found' && (status === 400 || status === 422)) {
          await dependencies.remove(frozen.id);
          return { kind: 'rejected', error };
        }
      } catch {
        // Observation unavailable: retain the frozen attempt and report review.
        return { kind: 'review', attempt: frozen, error };
      }
    }
    if (connection && frozen.payload.paymentMethod === 'CASH' && offlineCashEnabled) {
      const queued = { ...frozen, requiresReview: false };
      try {
        await dependencies.save(queued);
        return { kind: 'queued', attempt: queued };
      } catch {
        // Keep the last committed manual copy, never claim a queued write.
        return { kind: 'review', attempt: frozen, error };
      }
    }
    return { kind: 'review', attempt: frozen, error };
  }
}

/** Checking a saved attempt is read-only. Retry is a separate, explicit user action. */
export async function observeCheckout(
  attempt: PendingMobilePosLiteSale,
  dependencies: Dependencies,
) {
  const result = await dependencies.observe(attempt.payload.idempotencyKey);
  if (result.state === 'confirmed') await dependencies.remove(attempt.id).catch(() => undefined);
  return result;
}
