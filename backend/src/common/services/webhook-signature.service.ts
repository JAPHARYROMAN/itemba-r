import { Injectable, UnauthorizedException } from '@nestjs/common';
import * as crypto from 'crypto';
import { PrismaService } from '../../prisma/prisma.service';

/**
 * Verifies HMAC signatures on inbound webhook requests.
 *
 * Background: WebhookEndpoint stores a SHA-256 hash of the secret. Inbound
 * receivers should call `verify()` with the raw request body, the signature
 * header (e.g. `x-webhook-signature`), and a timestamp header (`x-webhook-timestamp`).
 *
 * Two integrations are supported simultaneously:
 *
 *   1. Internal (our own outbound webhooks coming back as inbound test events):
 *      `signature = HMAC_SHA256(secret, `${timestamp}.${rawBody}`)`
 *
 *   2. Provider-specific schemes can call `verifyHmac()` directly with the
 *      provider's prescribed string-to-sign.
 *
 * NOTE: Because we only persist a HASH of the secret (never the secret itself),
 * this service expects callers to supply the secret out-of-band — typically by
 * storing it in IntegrationConnection.config (encrypted). For internal webhook
 * endpoints, the raw secret is returned exactly once at creation time and the
 * client is expected to keep it.
 */
@Injectable()
export class WebhookSignatureService {
  constructor(private readonly prisma: PrismaService) {}

  /** Compute an HMAC-SHA256 signature in lowercase hex. */
  signHmac(secret: string, stringToSign: string): string {
    return crypto.createHmac('sha256', secret).update(stringToSign).digest('hex');
  }

  /** Constant-time compare to prevent timing attacks. */
  private safeEqual(a: string, b: string): boolean {
    const ab = Buffer.from(a, 'utf8');
    const bb = Buffer.from(b, 'utf8');
    if (ab.length !== bb.length) return false;
    return crypto.timingSafeEqual(ab, bb);
  }

  /**
   * Generic HMAC verification. Throws UnauthorizedException on mismatch.
   * Returns silently on success.
   */
  verifyHmac(secret: string, stringToSign: string, providedSignature: string): void {
    const expected = this.signHmac(secret, stringToSign);
    if (!this.safeEqual(expected, providedSignature)) {
      throw new UnauthorizedException('Webhook signature verification failed');
    }
  }

  /**
   * Verify an inbound webhook for one of our own WebhookEndpoint rows.
   *
   * The protocol expected on the wire:
   *   - x-webhook-signature: hex HMAC-SHA256 of `${timestamp}.${rawBody}`
   *   - x-webhook-timestamp: ISO date or unix epoch
   *
   * Replay window: timestamps older than 5 minutes are rejected.
   */
  verifyInternal(input: {
    secret: string;
    rawBody: string;
    signatureHeader: string | undefined;
    timestampHeader: string | undefined;
    replayWindowSeconds?: number;
  }): void {
    const { secret, rawBody, signatureHeader, timestampHeader } = input;
    const window = (input.replayWindowSeconds ?? 300) * 1000;

    if (!signatureHeader || !timestampHeader) {
      throw new UnauthorizedException('Missing webhook signature or timestamp header');
    }

    // Timestamp must parse and be within the replay window.
    const ts = /^\d+$/.test(timestampHeader)
      ? new Date(parseInt(timestampHeader, 10) * 1000)
      : new Date(timestampHeader);
    if (isNaN(ts.getTime())) {
      throw new UnauthorizedException('Invalid webhook timestamp');
    }
    if (Math.abs(Date.now() - ts.getTime()) > window) {
      throw new UnauthorizedException('Webhook timestamp outside replay window');
    }

    this.verifyHmac(secret, `${timestampHeader}.${rawBody}`, signatureHeader);
  }

  /**
   * Cross-check that a presented secret hashes to a stored secretHash on a
   * WebhookEndpoint. Useful when a provider sends the secret directly rather
   * than an HMAC. Updates lastUsedAt on success.
   */
  async lookupEndpointBySecret(presentedSecret: string) {
    const hash = crypto.createHash('sha256').update(presentedSecret).digest('hex');
    const endpoint = await this.prisma.webhookEndpoint.findFirst({
      where: { secretHash: hash, deletedAt: null, status: 'ACTIVE' },
    });
    if (!endpoint) {
      throw new UnauthorizedException('Unknown webhook endpoint');
    }
    return endpoint;
  }
}
