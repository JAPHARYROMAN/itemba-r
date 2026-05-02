import { BadRequestException, Injectable } from '@nestjs/common';
import {
  WebhookEndpointStatus,
  WebhookProcessingStatus,
  WebhookVerificationStatus,
} from '@prisma/client';
import * as crypto from 'crypto';
import { PrismaService } from '../../prisma/prisma.service';

type WebhookEndpointPolicy = {
  id: string;
  status: WebhookEndpointStatus;
  secretHash?: string | null;
  allowedEvents?: unknown;
};

@Injectable()
export class WebhookEventControlService {
  constructor(private readonly prisma: PrismaService) {}

  verifySharedSecret(endpoint: WebhookEndpointPolicy, providedSecret?: string | null): boolean {
    if (!endpoint.secretHash) return true;
    if (!providedSecret) return false;

    const providedHash = crypto.createHash('sha256').update(providedSecret).digest('hex');
    return this.constantTimeEquals(endpoint.secretHash, providedHash);
  }

  assertEndpointAcceptsEvent(endpoint: WebhookEndpointPolicy, eventName: string): void {
    if (endpoint.status !== WebhookEndpointStatus.ACTIVE) {
      throw new BadRequestException('Webhook endpoint is not active');
    }

    const allowedEvents = Array.isArray(endpoint.allowedEvents)
      ? endpoint.allowedEvents.map(String)
      : [];
    if (allowedEvents.length > 0 && !allowedEvents.includes(eventName)) {
      throw new BadRequestException(`Webhook endpoint does not accept event "${eventName}"`);
    }
  }

  async findDuplicateEvent(params: {
    webhookEndpointId?: string | null;
    providerId?: string | null;
    externalEventId?: string | null;
  }) {
    if (!params.externalEventId) return null;
    return this.prisma.webhookEvent.findFirst({
      where: {
        externalEventId: params.externalEventId,
        ...(params.webhookEndpointId ? { webhookEndpointId: params.webhookEndpointId } : {}),
        ...(params.providerId ? { providerId: params.providerId } : {}),
      },
      select: {
        id: true,
        webhookEventNumber: true,
        processingStatus: true,
        verificationStatus: true,
        receivedAt: true,
      },
    });
  }

  assertCanReprocess(event: {
    processingStatus: WebhookProcessingStatus;
    verificationStatus: WebhookVerificationStatus;
  }): void {
    if (event.verificationStatus === WebhookVerificationStatus.FAILED) {
      throw new BadRequestException('Webhook event with failed verification cannot be reprocessed');
    }

    const reprocessableStatuses: WebhookProcessingStatus[] = [
      WebhookProcessingStatus.FAILED,
      WebhookProcessingStatus.IGNORED,
      WebhookProcessingStatus.DUPLICATE,
    ];
    if (!reprocessableStatuses.includes(event.processingStatus)) {
      throw new BadRequestException(
        'Only failed, ignored, or duplicate webhook events can be reprocessed',
      );
    }
  }

  private constantTimeEquals(expected: string, actual: string): boolean {
    const expectedBuffer = Buffer.from(expected);
    const actualBuffer = Buffer.from(actual);
    if (expectedBuffer.length !== actualBuffer.length) return false;
    return crypto.timingSafeEqual(expectedBuffer, actualBuffer);
  }
}
