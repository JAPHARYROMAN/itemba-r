import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { MsaidiziDeviceStatus } from '@prisma/client';
import type { Request } from 'express';
import { PrismaService } from '../../prisma/prisma.service';
import { assertDirectDeviceMtlsListener, directMtlsPeer } from './direct-mtls-peer';

type SupervisorRole = 'UPDATE' | 'RECOVERY';

/**
 * Authenticates a role-specific supervisor identity before controller code runs.
 * Services repeat the same role and device binding as a defence-in-depth check.
 */
abstract class MsaidiziSupervisorMtlsGuard implements CanActivate {
  protected abstract readonly role: SupervisorRole;

  constructor(private readonly prisma: PrismaService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<Request>();
    assertDirectDeviceMtlsListener(request);
    const peer = directMtlsPeer(request);
    const spkiSha256 = peer.publicKeySpkiSha256;
    if (!spkiSha256) {
      throw new UnauthorizedException('The supervisor TLS peer has no SPKI identity');
    }
    const requestedDeviceId = requestBodyDeviceId(request);
    const identityWhere =
      this.role === 'UPDATE'
        ? {
            updateSupervisorCertificateSha256: peer.certificateSha256,
            updateSupervisorPublicKeySpkiSha256: spkiSha256,
          }
        : {
            recoverySupervisorCertificateSha256: peer.certificateSha256,
            recoverySupervisorPublicKeySpkiSha256: spkiSha256,
          };
    const device = await this.prisma.msaidiziDevice.findFirst({
      where: {
        ...(requestedDeviceId ? { id: requestedDeviceId } : {}),
        status: {
          in: [
            MsaidiziDeviceStatus.ACTIVE,
            MsaidiziDeviceStatus.OFFLINE,
            MsaidiziDeviceStatus.KILLED,
          ],
        },
        ...identityWhere,
      },
      select: { id: true },
    });
    if (!device) {
      throw new UnauthorizedException(
        `The ${this.role.toLowerCase()} supervisor TLS identity is not bound to this device`,
      );
    }
    return true;
  }
}

@Injectable()
export class MsaidiziUpdateSupervisorMtlsGuard extends MsaidiziSupervisorMtlsGuard {
  protected readonly role = 'UPDATE' as const;

  constructor(prisma: PrismaService) {
    super(prisma);
  }
}

@Injectable()
export class MsaidiziRecoverySupervisorMtlsGuard extends MsaidiziSupervisorMtlsGuard {
  protected readonly role = 'RECOVERY' as const;

  constructor(prisma: PrismaService) {
    super(prisma);
  }
}

function requestBodyDeviceId(request: Request): string | null {
  const body = request.body;
  if (!body || typeof body !== 'object' || Array.isArray(body)) return null;
  const candidate = (body as Record<string, unknown>).deviceId;
  return typeof candidate === 'string' && candidate.length > 0 ? candidate : null;
}
