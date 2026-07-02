import { ExternalMessageStatus } from '@prisma/client';
import { mapProviderStatus, isDeliveredStatus } from './message-delivery-status';

describe('mapProviderStatus', () => {
  it('maps delivered synonyms (case/whitespace-insensitive)', () => {
    for (const raw of ['DELIVERED', 'delivered', ' Delivrd ', 'success', 'OK', 'completed']) {
      expect(mapProviderStatus(raw)).toBe(ExternalMessageStatus.DELIVERED);
    }
  });

  it('maps sent/in-transit synonyms', () => {
    for (const raw of ['SENT', 'dispatched', 'submitted', 'enroute']) {
      expect(mapProviderStatus(raw)).toBe(ExternalMessageStatus.SENT);
    }
  });

  it('maps failure synonyms', () => {
    for (const raw of ['FAILED', 'failure', 'undeliverable', 'rejected', 'expired']) {
      expect(mapProviderStatus(raw)).toBe(ExternalMessageStatus.FAILED);
    }
  });

  it('maps cancelled synonyms', () => {
    for (const raw of ['CANCELLED', 'canceled', 'cancel']) {
      expect(mapProviderStatus(raw)).toBe(ExternalMessageStatus.CANCELLED);
    }
  });

  it('returns null for unknown / non-terminal statuses', () => {
    for (const raw of ['', '   ', 'pending', 'queued', 'accepted', 'whoknows']) {
      expect(mapProviderStatus(raw)).toBeNull();
    }
  });

  it('isDeliveredStatus is true only for DELIVERED', () => {
    expect(isDeliveredStatus(ExternalMessageStatus.DELIVERED)).toBe(true);
    expect(isDeliveredStatus(ExternalMessageStatus.FAILED)).toBe(false);
    expect(isDeliveredStatus(ExternalMessageStatus.SENT)).toBe(false);
  });
});
