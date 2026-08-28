import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import type { Request } from 'express';
import {
  assertDirectDeviceMtlsListener,
  directMtlsPeer,
  DirectMtlsPeerIdentity,
} from '../msaidizi-devices/direct-mtls-peer';
import { MsaidiziAuditSignerConfig } from './msaidizi-audit-signer.config';

const PEER = Symbol('msaidizi-audit-signer-peer');

@Injectable()
export class MsaidiziAuditSignerGuard implements CanActivate {
  constructor(private readonly config: MsaidiziAuditSignerConfig) {}

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<Request>();
    assertDirectDeviceMtlsListener(request);
    const peer = directMtlsPeer(request);
    this.config.assertPinnedPeer(peer);
    (request as Request & { [PEER]?: DirectMtlsPeerIdentity })[PEER] = peer;
    return true;
  }
}

export function authenticatedAuditSignerPeer(request: Request): DirectMtlsPeerIdentity {
  const peer = (request as Request & { [PEER]?: DirectMtlsPeerIdentity })[PEER];
  if (!peer) throw new Error('Audit signer guard did not bind the direct TLS peer');
  return peer;
}
