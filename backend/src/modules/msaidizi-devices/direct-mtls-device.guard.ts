import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import type { Request } from 'express';
import { assertDirectDeviceMtlsListener, directMtlsPeer } from './direct-mtls-peer';

/**
 * Authenticates the device channel before controller code runs. The service
 * repeats peer-to-device binding after this transport-level gate.
 */
@Injectable()
export class DirectMtlsDeviceGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<Request>();
    assertDirectDeviceMtlsListener(request);
    directMtlsPeer(request);
    return true;
  }
}
