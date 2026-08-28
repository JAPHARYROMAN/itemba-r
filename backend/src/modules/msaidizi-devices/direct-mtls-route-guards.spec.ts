import { UnauthorizedException } from '@nestjs/common';
import { MsaidiziAuditSignerGuard } from '../msaidizi-audit-signer/msaidizi-audit-signer.guard';
import { DirectMtlsDeviceGuard } from './direct-mtls-device.guard';
import {
  MsaidiziRecoverySupervisorMtlsGuard,
  MsaidiziUpdateSupervisorMtlsGuard,
} from './msaidizi-supervisor-mtls.guard';

describe('direct mTLS controller listener isolation', () => {
  const priorEnabled = process.env.MSAIDIZI_DIRECT_MTLS_ENABLED;
  const priorPort = process.env.MSAIDIZI_DIRECT_MTLS_PORT;

  beforeEach(() => {
    process.env.MSAIDIZI_DIRECT_MTLS_ENABLED = 'true';
    process.env.MSAIDIZI_DIRECT_MTLS_PORT = '3443';
  });

  afterAll(() => {
    restore('MSAIDIZI_DIRECT_MTLS_ENABLED', priorEnabled);
    restore('MSAIDIZI_DIRECT_MTLS_PORT', priorPort);
  });

  it.each([
    ['device', () => new DirectMtlsDeviceGuard()],
    ['update supervisor', () => new MsaidiziUpdateSupervisorMtlsGuard({} as never)],
    ['recovery supervisor', () => new MsaidiziRecoverySupervisorMtlsGuard({} as never)],
    ['audit signer', () => new MsaidiziAuditSignerGuard({ assertPinnedPeer: jest.fn() } as never)],
  ])('rejects the %s channel before peer parsing on the ordinary API port', async (_name, make) => {
    const guard = make();
    await expect(
      Promise.resolve().then(() => guard.canActivate(context(3001))),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });
});

function context(localPort: number) {
  return {
    switchToHttp: () => ({ getRequest: () => ({ socket: { localPort }, body: {} }) }),
  } as never;
}

function restore(name: string, value: string | undefined): void {
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
}
