import {
  CanActivate,
  ExecutionContext,
  Injectable,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHash, createPublicKey, timingSafeEqual } from 'node:crypto';
import type { Request } from 'express';
import { PrismaService } from '../../prisma/prisma.service';
import { directMtlsPeer } from '../msaidizi-devices/direct-mtls-peer';

/**
 * Runs before any verifier controller interceptor (including Multer). The
 * listener port is kernel-derived, not a forwarding header, so the ordinary
 * API listener cannot be used to reach disk-backed verifier request parsing.
 */
@Injectable()
export class MsaidiziEvaluatorMtlsGuard implements CanActivate {
  constructor(
    private readonly config: ConfigService,
    private readonly prisma: PrismaService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    if (
      !flag(this.config, 'MSAIDIZI_UPDATE_EVALUATOR_ENABLED') ||
      !flag(this.config, 'MSAIDIZI_EVALUATOR_MTLS_ENABLED')
    ) {
      throw new ServiceUnavailableException('The dedicated evaluator mTLS listener is disabled');
    }
    const configuredPort = Number(
      this.config.get<string | number>('MSAIDIZI_EVALUATOR_MTLS_PORT', 3444),
    );
    const request = context.switchToHttp().getRequest<Request>();
    if (
      !Number.isSafeInteger(configuredPort) ||
      configuredPort < 1 ||
      configuredPort > 65_535 ||
      request.socket.localPort !== configuredPort
    ) {
      throw new ServiceUnavailableException(
        'Verifier endpoints are available only on the dedicated mTLS listener',
      );
    }

    const peer = directMtlsPeer(request);
    if (!peer.chainAuthorized) {
      throw new UnauthorizedException('The evaluator client certificate chain is unauthorized');
    }
    const certificatePin = requiredPin(this.config, 'MSAIDIZI_EVALUATOR_CLIENT_CERT_SHA256');
    const spkiPin = requiredPin(this.config, 'MSAIDIZI_EVALUATOR_CLIENT_SPKI_SHA256');
    if (
      !fixedHexEquals(peer.certificateSha256, certificatePin) ||
      !peer.publicKeySpkiSha256 ||
      !fixedHexEquals(peer.publicKeySpkiSha256, spkiPin)
    ) {
      throw new UnauthorizedException('The evaluator client certificate pin does not match');
    }

    const reusedCertificate = await this.prisma.msaidiziDevice.count({
      where: { certificateThumbprint: peer.certificateSha256 },
    });
    if (reusedCertificate !== 0) {
      throw new UnauthorizedException('An enrolled device certificate cannot be an evaluator');
    }
    const devices = await this.prisma.msaidiziDevice.findMany({ select: { publicKey: true } });
    for (const device of devices) {
      try {
        const publicKey = createPublicKey(device.publicKey);
        const digest = createHash('sha256')
          .update(publicKey.export({ type: 'spki', format: 'der' }))
          .digest('hex');
        if (fixedHexEquals(digest, spkiPin)) {
          throw new UnauthorizedException('An enrolled device key cannot be an evaluator');
        }
      } catch (error) {
        if (error instanceof UnauthorizedException) throw error;
        throw new UnauthorizedException('An enrolled device key record is invalid');
      }
    }
    return true;
  }
}

function flag(config: ConfigService, name: string): boolean {
  return ['1', 'true', 'yes', 'on'].includes(
    String(config.get<string>(name) ?? '')
      .trim()
      .toLowerCase(),
  );
}

function requiredPin(config: ConfigService, name: string): string {
  const value = String(config.get<string>(name) ?? '')
    .trim()
    .toLowerCase();
  if (!/^[0-9a-f]{64}$/.test(value)) {
    throw new ServiceUnavailableException('The evaluator transport identity pin is unavailable');
  }
  return value;
}

function fixedHexEquals(left: string, right: string): boolean {
  if (!/^[0-9a-f]{64}$/i.test(left) || !/^[0-9a-f]{64}$/i.test(right)) return false;
  return timingSafeEqual(Buffer.from(left, 'hex'), Buffer.from(right, 'hex'));
}
