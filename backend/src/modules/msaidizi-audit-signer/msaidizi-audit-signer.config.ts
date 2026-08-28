import { ServiceUnavailableException, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Injectable } from '@nestjs/common';
import { DirectMtlsPeerIdentity } from '../msaidizi-devices/direct-mtls-peer';

@Injectable()
export class MsaidiziAuditSignerConfig {
  readonly enabled: boolean;
  readonly killed: boolean;
  readonly signerKeyId: string;
  readonly certificateSha256: string;
  readonly subjectPublicKeySha256: string;
  readonly maxSegmentEvents: number;
  readonly checkpointTtlSeconds: number;
  readonly maxClockSkewSeconds: number;

  constructor(config: ConfigService) {
    this.enabled = truthy(config.get<string>('MSAIDIZI_AUDIT_SIGNER_ENABLED', 'false'));
    this.killed = truthy(config.get<string>('MSAIDIZI_AUDIT_SIGNER_KILL_SWITCH', 'false'));
    this.signerKeyId = config.get<string>('MSAIDIZI_AUDIT_SIGNER_KEY_ID', '').trim();
    this.certificateSha256 = config
      .get<string>('MSAIDIZI_AUDIT_SIGNER_CLIENT_CERT_SHA256', '')
      .trim()
      .toLowerCase();
    this.subjectPublicKeySha256 = config
      .get<string>('MSAIDIZI_AUDIT_SIGNER_CLIENT_SPKI_SHA256', '')
      .trim()
      .toLowerCase();
    this.maxSegmentEvents = config.get<number>('MSAIDIZI_AUDIT_SIGNER_MAX_SEGMENT_EVENTS', 256);
    this.checkpointTtlSeconds = config.get<number>(
      'MSAIDIZI_AUDIT_SIGNER_CHECKPOINT_TTL_SECONDS',
      300,
    );
    this.maxClockSkewSeconds = config.get<number>(
      'MSAIDIZI_AUDIT_SIGNER_MAX_CLOCK_SKEW_SECONDS',
      30,
    );
  }

  assertReady(): void {
    if (!this.enabled) throw new ServiceUnavailableException('Trusted audit signer is disabled');
    if (this.killed) {
      throw new ServiceUnavailableException('Trusted audit signer kill switch is active');
    }
  }

  assertPinnedPeer(peer: DirectMtlsPeerIdentity): void {
    this.assertReady();
    if (
      !peer.chainAuthorized ||
      peer.certificateSha256.toLowerCase() !== this.certificateSha256 ||
      peer.publicKeySpkiSha256?.toLowerCase() !== this.subjectPublicKeySha256
    ) {
      throw new UnauthorizedException('The audit signer TLS certificate is not pinned');
    }
  }
}

function truthy(value: string): boolean {
  return ['1', 'true', 'yes', 'on'].includes(value.trim().toLowerCase());
}
