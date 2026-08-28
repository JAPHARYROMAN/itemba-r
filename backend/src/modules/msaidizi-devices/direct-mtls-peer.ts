import { UnauthorizedException } from '@nestjs/common';
import { createHash, X509Certificate } from 'node:crypto';
import { TLSSocket } from 'node:tls';
import type { Request } from 'express';

export interface DirectMtlsPeerIdentity {
  certificateSha256: string;
  publicKeyPem: string;
  publicKeySha256: string;
  /** SHA-256 of DER SubjectPublicKeyInfo; used for externally pinned peers. */
  publicKeySpkiSha256?: string;
  validFrom: Date;
  validTo: Date;
  chainAuthorized: boolean;
}

/** Defence in depth for direct-device controllers behind the route-isolated listener. */
export function assertDirectDeviceMtlsListener(
  request: Request,
  environment: NodeJS.ProcessEnv = process.env,
): void {
  const enabled = ['1', 'true', 'yes', 'on'].includes(
    (environment.MSAIDIZI_DIRECT_MTLS_ENABLED ?? '').trim().toLowerCase(),
  );
  if (!enabled) return;
  const configuredPort = Number(environment.MSAIDIZI_DIRECT_MTLS_PORT ?? 3443);
  if (!Number.isSafeInteger(configuredPort) || request.socket.localPort !== configuredPort) {
    throw new UnauthorizedException(
      'Direct device routes are available only on the dedicated mTLS listener',
    );
  }
}

/**
 * Reads identity only from the live TLS socket. Forwarding headers are never
 * consulted: a proxy-asserted certificate is not a device identity.
 */
export function directMtlsPeer(request: Request): DirectMtlsPeerIdentity {
  const socket = request.socket;
  if (!(socket instanceof TLSSocket) || !socket.encrypted) {
    throw new UnauthorizedException('A direct client TLS certificate is required');
  }
  const peerFinished = socket.getPeerFinished?.();
  const protocol = socket.getProtocol?.();
  if (
    !Buffer.isBuffer(peerFinished) ||
    peerFinished.length === 0 ||
    (protocol !== 'TLSv1.2' && protocol !== 'TLSv1.3')
  ) {
    throw new UnauthorizedException(
      'The direct TLS peer did not prove possession in this handshake',
    );
  }

  const peer = socket.getPeerCertificate(true);
  if (!peer.raw || peer.raw.length === 0) {
    throw new UnauthorizedException('The direct TLS peer did not present a certificate');
  }

  try {
    const certificate = new X509Certificate(peer.raw);
    const now = Date.now();
    const validFrom = new Date(certificate.validFrom);
    const validTo = new Date(certificate.validTo);
    if (validFrom.getTime() > now || validTo.getTime() <= now) {
      throw new UnauthorizedException(
        'The direct TLS peer certificate is outside its validity window',
      );
    }
    const publicKey = certificate.publicKey;
    if (
      certificate.ca ||
      publicKey.asymmetricKeyType !== 'ec' ||
      publicKey.asymmetricKeyDetails?.namedCurve !== 'prime256v1'
    ) {
      throw new UnauthorizedException('The direct TLS peer must use a non-CA P-256 certificate');
    }
    const publicKeyPem = publicKey.export({ type: 'spki', format: 'pem' }).toString();
    const normalizedPublicKeyPem = publicKeyPem.replace(/\r\n/g, '\n').trim();
    return {
      certificateSha256: createHash('sha256').update(certificate.raw).digest('hex').toUpperCase(),
      publicKeyPem,
      publicKeySha256: createHash('sha256')
        .update(normalizedPublicKeyPem, 'utf8')
        .digest('hex')
        .toUpperCase(),
      publicKeySpkiSha256: createHash('sha256')
        .update(publicKey.export({ type: 'spki', format: 'der' }))
        .digest('hex')
        .toUpperCase(),
      validFrom,
      validTo,
      // A first-trust self-signed certificate is intentionally not CA-authorized.
      // TLS Finished proof plus the one-time pairing challenge establishes first
      // trust; later requests are bound to the persisted fingerprint and SPKI.
      chainAuthorized: socket.authorized === true,
    };
  } catch (error) {
    if (error instanceof UnauthorizedException) throw error;
    throw new UnauthorizedException('The direct TLS peer certificate could not be validated');
  }
}
