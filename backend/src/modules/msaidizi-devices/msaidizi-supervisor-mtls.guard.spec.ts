import { UnauthorizedException } from '@nestjs/common';
import { directMtlsPeer } from './direct-mtls-peer';
import {
  MsaidiziRecoverySupervisorMtlsGuard,
  MsaidiziUpdateSupervisorMtlsGuard,
} from './msaidizi-supervisor-mtls.guard';

jest.mock('./direct-mtls-peer', () => ({
  assertDirectDeviceMtlsListener: jest.fn(),
  directMtlsPeer: jest.fn(),
}));

describe('role-specific supervisor mTLS guards', () => {
  beforeEach(() => {
    jest.mocked(directMtlsPeer).mockReturnValue({
      certificateSha256: 'A'.repeat(64),
      publicKeyPem: 'unused',
      publicKeySha256: 'B'.repeat(64),
      publicKeySpkiSha256: 'C'.repeat(64),
      validFrom: new Date(0),
      validTo: new Date(Date.now() + 60_000),
      chainAuthorized: true,
    });
  });

  afterEach(() => jest.clearAllMocks());

  it('binds update requests to both update pins and the body device id', async () => {
    const prisma = database({ id: 'device-1' });
    const guard = new MsaidiziUpdateSupervisorMtlsGuard(prisma as never);

    await expect(guard.canActivate(context({ deviceId: 'device-1' }))).resolves.toBe(true);

    expect(prisma.msaidiziDevice.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          id: 'device-1',
          updateSupervisorCertificateSha256: 'A'.repeat(64),
          updateSupervisorPublicKeySpkiSha256: 'C'.repeat(64),
        }),
      }),
    );
    const where = prisma.msaidiziDevice.findFirst.mock.calls[0][0].where;
    expect(where).not.toHaveProperty('certificateThumbprint');
    expect(where).not.toHaveProperty('recoverySupervisorCertificateSha256');
  });

  it('rejects an ordinary-device or cross-role identity on the update channel', async () => {
    const prisma = database(null);
    const guard = new MsaidiziUpdateSupervisorMtlsGuard(prisma as never);

    await expect(guard.canActivate(context({ deviceId: 'device-1' }))).rejects.toThrow(
      'update supervisor TLS identity is not bound',
    );
  });

  it('uses recovery pins and authenticates artifact-style requests without a body id', async () => {
    const prisma = database({ id: 'device-2' });
    const guard = new MsaidiziRecoverySupervisorMtlsGuard(prisma as never);

    await expect(guard.canActivate(context(undefined))).resolves.toBe(true);

    const where = prisma.msaidiziDevice.findFirst.mock.calls[0][0].where;
    expect(where).not.toHaveProperty('id');
    expect(where).toEqual(
      expect.objectContaining({
        recoverySupervisorCertificateSha256: 'A'.repeat(64),
        recoverySupervisorPublicKeySpkiSha256: 'C'.repeat(64),
      }),
    );
  });

  it('fails closed when the TLS peer has no DER-SPKI pin', async () => {
    jest.mocked(directMtlsPeer).mockReturnValueOnce({
      certificateSha256: 'A'.repeat(64),
      publicKeyPem: 'unused',
      publicKeySha256: 'B'.repeat(64),
      validFrom: new Date(0),
      validTo: new Date(Date.now() + 60_000),
      chainAuthorized: true,
    });
    const prisma = database({ id: 'device-1' });

    await expect(
      new MsaidiziUpdateSupervisorMtlsGuard(prisma as never).canActivate(context({})),
    ).rejects.toBeInstanceOf(UnauthorizedException);
    expect(prisma.msaidiziDevice.findFirst).not.toHaveBeenCalled();
  });
});

function database(result: { id: string } | null) {
  return { msaidiziDevice: { findFirst: jest.fn().mockResolvedValue(result) } };
}

function context(body: unknown) {
  return {
    switchToHttp: () => ({ getRequest: () => ({ body, socket: {} }) }),
  } as never;
}
