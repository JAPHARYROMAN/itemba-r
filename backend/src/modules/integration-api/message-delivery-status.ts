import { ExternalMessageStatus } from '@prisma/client';

/**
 * Maps a raw provider delivery-status string to an {@link ExternalMessageStatus}.
 *
 * Providers use wildly different vocabularies ("delivered", "DELIVRD",
 * "success", "failed", "undeliverable", "expired", ...). We normalise on the
 * uppercased/trimmed token and collapse synonyms onto the enum.
 *
 * Returns `null` for statuses we do not recognise or that are not terminal
 * (e.g. "queued", "accepted", "pending") — the caller then leaves the message
 * status untouched instead of clobbering it with an invalid value.
 */
export function mapProviderStatus(raw: string): ExternalMessageStatus | null {
  const token = (raw ?? '').trim().toUpperCase();
  if (!token) return null;

  switch (token) {
    // Delivered / success synonyms.
    case 'DELIVERED':
    case 'DELIVRD':
    case 'DELIVER':
    case 'SUCCESS':
    case 'SUCCEEDED':
    case 'OK':
    case 'COMPLETED':
      return ExternalMessageStatus.DELIVERED;

    // Sent / dispatched-but-not-yet-confirmed synonyms.
    case 'SENT':
    case 'DISPATCHED':
    case 'SUBMITTED':
    case 'ENROUTE':
    case 'EN_ROUTE':
      return ExternalMessageStatus.SENT;

    // Failure synonyms.
    case 'FAILED':
    case 'FAILURE':
    case 'ERROR':
    case 'UNDELIVERABLE':
    case 'UNDELIVERED':
    case 'UNDELIV':
    case 'REJECTED':
    case 'REJECTD':
    case 'EXPIRED':
    case 'DELETED':
      return ExternalMessageStatus.FAILED;

    // Cancelled synonyms.
    case 'CANCELLED':
    case 'CANCELED':
    case 'CANCEL':
      return ExternalMessageStatus.CANCELLED;

    default:
      return null;
  }
}

/** Statuses that carry a delivery timestamp (`deliveredAt`). */
export function isDeliveredStatus(status: ExternalMessageStatus): boolean {
  return status === ExternalMessageStatus.DELIVERED;
}
