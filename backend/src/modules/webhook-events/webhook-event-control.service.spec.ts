import { BadRequestException } from '@nestjs/common';
import {
  WebhookEndpointStatus,
  WebhookProcessingStatus,
  WebhookVerificationStatus,
} from '@prisma/client';
import * as crypto from 'crypto';
import { WebhookEventControlService } from './webhook-event-control.service';

const prisma = {
  webhookEvent: {
    findFirst: jest.fn(),
  },
};

describe('WebhookEventControlService', () => {
  let service: WebhookEventControlService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new WebhookEventControlService(prisma as any);
  });

  it('verifies shared secrets with a stored hash', () => {
    const secretHash = crypto.createHash('sha256').update('secret-value').digest('hex');

    expect(
      service.verifySharedSecret(
        { id: 'endpoint-1', status: WebhookEndpointStatus.ACTIVE, secretHash },
        'secret-value',
      ),
    ).toBe(true);
    expect(
      service.verifySharedSecret(
        { id: 'endpoint-1', status: WebhookEndpointStatus.ACTIVE, secretHash },
        'wrong-value',
      ),
    ).toBe(false);
  });

  it('allows unrestricted active endpoints when no allowed event list exists', () => {
    expect(() =>
      service.assertEndpointAcceptsEvent(
        { id: 'endpoint-1', status: WebhookEndpointStatus.ACTIVE, allowedEvents: null },
        'payment.completed',
      ),
    ).not.toThrow();
  });

  it('rejects inactive endpoints and unsupported event names', () => {
    expect(() =>
      service.assertEndpointAcceptsEvent(
        { id: 'endpoint-1', status: WebhookEndpointStatus.SUSPENDED },
        'payment.completed',
      ),
    ).toThrow(BadRequestException);

    expect(() =>
      service.assertEndpointAcceptsEvent(
        {
          id: 'endpoint-1',
          status: WebhookEndpointStatus.ACTIVE,
          allowedEvents: ['payment.completed'],
        },
        'payment.failed',
      ),
    ).toThrow(BadRequestException);
  });

  it('looks up duplicate events only when an external event id is present', async () => {
    await expect(
      service.findDuplicateEvent({ webhookEndpointId: 'endpoint-1', externalEventId: null }),
    ).resolves.toBeNull();
    expect(prisma.webhookEvent.findFirst).not.toHaveBeenCalled();

    prisma.webhookEvent.findFirst.mockResolvedValue({ id: 'event-1' });
    await expect(
      service.findDuplicateEvent({
        webhookEndpointId: 'endpoint-1',
        providerId: 'provider-1',
        externalEventId: 'external-1',
      }),
    ).resolves.toEqual({ id: 'event-1' });
    expect(prisma.webhookEvent.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          externalEventId: 'external-1',
          webhookEndpointId: 'endpoint-1',
          providerId: 'provider-1',
        },
      }),
    );
  });

  it('allows reprocessing only failed, ignored, or duplicate events with valid verification', () => {
    expect(() =>
      service.assertCanReprocess({
        processingStatus: WebhookProcessingStatus.FAILED,
        verificationStatus: WebhookVerificationStatus.VERIFIED,
      }),
    ).not.toThrow();

    expect(() =>
      service.assertCanReprocess({
        processingStatus: WebhookProcessingStatus.PROCESSED,
        verificationStatus: WebhookVerificationStatus.VERIFIED,
      }),
    ).toThrow(BadRequestException);

    expect(() =>
      service.assertCanReprocess({
        processingStatus: WebhookProcessingStatus.FAILED,
        verificationStatus: WebhookVerificationStatus.FAILED,
      }),
    ).toThrow(BadRequestException);
  });
});
