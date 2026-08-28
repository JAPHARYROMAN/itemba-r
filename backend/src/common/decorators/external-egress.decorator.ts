import { SetMetadata } from '@nestjs/common';

/** Manifest metadata key for server-side ERP operations that can leave Itemba. */
export const EXTERNAL_EGRESS_KEY = 'itemba:external-egress';

export interface ExternalEgressMetadata {
  /** Only strictly parsed, adapter-issued v1 receipts are accepted. */
  metering: 'adapter-receipt-v1';
  /** Pessimistic bytes reserved before one dispatch crosses the ERP boundary. */
  reservationBytes: number;
}

/**
 * Declares that a controller operation can produce external network egress.
 *
 * The declaration does not enable the operation. Durable execution additionally
 * requires an EXTERNAL plan effect, task/step budget reservation, and an exact
 * adapter-issued metering receipt. Human requests remain on their existing path.
 */
export function ExternalEgress(metadata: ExternalEgressMetadata): MethodDecorator & ClassDecorator {
  if (
    metadata.metering !== 'adapter-receipt-v1' ||
    !Number.isSafeInteger(metadata.reservationBytes) ||
    metadata.reservationBytes <= 0
  ) {
    throw new TypeError(
      'External egress metadata requires adapter-receipt-v1 and a positive safe-integer reservationBytes',
    );
  }
  return SetMetadata(EXTERNAL_EGRESS_KEY, Object.freeze({ ...metadata }));
}
