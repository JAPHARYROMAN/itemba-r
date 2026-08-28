import { ConflictException, UnauthorizedException } from '@nestjs/common';
import { directMtlsPeer } from './direct-mtls-peer';
import { supervisorEnrollmentCodeDigest } from './device-security';
import { MsaidiziDevicesService } from './msaidizi-devices.service';

jest.mock('./direct-mtls-peer', () => ({ directMtlsPeer: jest.fn() }));

const pepper = 'supervisor-enrollment-pepper-with-more-than-32-characters';
const enrollmentId = '11111111-1111-4111-8111-111111111111';
const deviceId = '22222222-2222-4222-8222-222222222222';
const enrollmentCode = 'AAAA-BBBB-CCCC-DDDD-EEEE-FFFF-0000-1111';

describe('role-specific supervisor enrollment', () => {
  beforeEach(() => {
    jest.mocked(directMtlsPeer).mockReturnValue(peer());
  });

  afterEach(() => jest.clearAllMocks());

  it('persists only an HMAC for an oversight-created, single-use challenge', async () => {
    const { service, prisma } = harness();
    prisma.msaidiziDevice.findFirst.mockResolvedValue(activeDevice());
    prisma.msaidiziSupervisorEnrollmentChallenge.create.mockImplementation(
      async ({ data }: { data: Record<string, unknown> }) => ({
        id: data.id,
        deviceId: data.deviceId,
        role: data.role,
        expiresAt: data.expiresAt,
      }),
    );

    const result = await service.createSupervisorEnrollmentCode(deviceId, { role: 'UPDATE' }, {
      id: 'oversight-user',
    } as never);

    expect(result.enrollmentCode).toMatch(/^[0-9A-F]{4}(?:-[0-9A-F]{4}){7}$/);
    const data = prisma.msaidiziSupervisorEnrollmentChallenge.create.mock.calls[0][0].data;
    expect(data.challengeDigest).toMatch(/^[0-9a-f]{64}$/);
    expect(JSON.stringify(data)).not.toContain(result.enrollmentCode);
    expect(prisma.msaidiziSupervisorEnrollmentChallenge.updateMany).toHaveBeenCalledWith({
      where: { deviceId, role: 'UPDATE', consumedAt: null },
      data: { consumedAt: expect.any(Date) },
    });
  });

  it('atomically binds only the requested role certificate and DER-SPKI pins', async () => {
    const { service, prisma } = harness();
    prisma.msaidiziSupervisorEnrollmentChallenge.findUnique.mockResolvedValue(
      challenge({ consumedAt: null }),
    );
    prisma.msaidiziDevice.findMany.mockResolvedValue([
      {
        publicKey: 'PAIRING_DIGEST_V1:not-a-public-key',
        certificateThumbprint: 'D'.repeat(64),
        egressBoundaryPublicKeySha256: null,
        updateSupervisorCertificateSha256: null,
        updateSupervisorPublicKeySpkiSha256: null,
        recoverySupervisorCertificateSha256: null,
        recoverySupervisorPublicKeySpkiSha256: null,
      },
    ]);
    prisma.msaidiziDevice.updateMany.mockResolvedValue({ count: 1 });
    prisma.msaidiziSupervisorEnrollmentChallenge.updateMany.mockResolvedValue({ count: 1 });

    const result = await service.completeSupervisorEnrollment(
      { deviceId, enrollmentId, role: 'UPDATE', enrollmentCode },
      {} as never,
    );

    expect(result).toEqual({ deviceId, role: 'UPDATE', enrolled: true, replay: false });
    expect(prisma.msaidiziDevice.updateMany).toHaveBeenCalledWith({
      where: expect.objectContaining({
        id: deviceId,
        updateSupervisorCertificateSha256: null,
        updateSupervisorPublicKeySpkiSha256: null,
      }),
      data: {
        updateSupervisorCertificateSha256: 'A'.repeat(64),
        updateSupervisorPublicKeySpkiSha256: 'C'.repeat(64),
      },
    });
    expect(prisma.msaidiziSupervisorEnrollmentChallenge.updateMany).toHaveBeenCalledWith({
      where: {
        id: enrollmentId,
        challengeDigest: supervisorEnrollmentCodeDigest(
          pepper,
          enrollmentId,
          deviceId,
          'UPDATE',
          enrollmentCode,
        ),
        consumedAt: null,
      },
      data: { consumedAt: expect.any(Date) },
    });
  });

  it('accepts an exact lost-response replay but rejects the same code from another key', async () => {
    const exact = harness();
    exact.prisma.msaidiziSupervisorEnrollmentChallenge.findUnique.mockResolvedValue(
      challenge({
        consumedAt: new Date(),
        device: activeDevice({
          updateSupervisorCertificateSha256: 'A'.repeat(64),
          updateSupervisorPublicKeySpkiSha256: 'C'.repeat(64),
        }),
      }),
    );
    await expect(
      exact.service.completeSupervisorEnrollment(
        { deviceId, enrollmentId, role: 'UPDATE', enrollmentCode },
        {} as never,
      ),
    ).resolves.toEqual({ deviceId, role: 'UPDATE', enrolled: true, replay: true });
    expect(exact.prisma.msaidiziDevice.updateMany).not.toHaveBeenCalled();

    const wrongKey = harness();
    wrongKey.prisma.msaidiziSupervisorEnrollmentChallenge.findUnique.mockResolvedValue(
      challenge({
        consumedAt: new Date(),
        device: activeDevice({
          updateSupervisorCertificateSha256: 'E'.repeat(64),
          updateSupervisorPublicKeySpkiSha256: 'F'.repeat(64),
        }),
      }),
    );
    await expect(
      wrongKey.service.completeSupervisorEnrollment(
        { deviceId, enrollmentId, role: 'UPDATE', enrollmentCode },
        {} as never,
      ),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('rejects reuse of a companion, cross-role, or other reserved identity', async () => {
    const { service, prisma } = harness();
    prisma.msaidiziSupervisorEnrollmentChallenge.findUnique.mockResolvedValue(
      challenge({ consumedAt: null }),
    );
    prisma.msaidiziDevice.findMany.mockResolvedValue([
      {
        publicKey: 'PAIRING_DIGEST_V1:not-a-public-key',
        certificateThumbprint: null,
        egressBoundaryPublicKeySha256: null,
        updateSupervisorCertificateSha256: null,
        updateSupervisorPublicKeySpkiSha256: null,
        recoverySupervisorCertificateSha256: 'A'.repeat(64),
        recoverySupervisorPublicKeySpkiSha256: 'F'.repeat(64),
      },
    ]);

    await expect(
      service.completeSupervisorEnrollment(
        { deviceId, enrollmentId, role: 'UPDATE', enrollmentCode },
        {} as never,
      ),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(prisma.msaidiziDevice.updateMany).not.toHaveBeenCalled();
  });
});

function harness() {
  const prisma = {
    $queryRaw: jest.fn().mockResolvedValue([]),
    $transaction: jest.fn(),
    msaidiziDevice: {
      findFirst: jest.fn(),
      findMany: jest.fn(),
      updateMany: jest.fn(),
    },
    msaidiziSupervisorEnrollmentChallenge: {
      create: jest.fn(),
      findUnique: jest.fn(),
      updateMany: jest.fn().mockResolvedValue({ count: 0 }),
    },
  };
  prisma.$transaction.mockImplementation(async (callback: (tx: typeof prisma) => unknown) =>
    callback(prisma),
  );
  const config = {
    supervisorEnrollmentPepper: pepper,
    supervisorEnrollmentTtlSeconds: 300,
    supervisorEnrollmentReady: () => true,
    reservedSupervisorIdentityDigests: new Set<string>(),
  };
  const audit = { log: jest.fn().mockResolvedValue(undefined) };
  return {
    prisma,
    service: new MsaidiziDevicesService(
      prisma as never,
      config as never,
      {} as never,
      audit as never,
    ),
  };
}

function peer() {
  return {
    certificateSha256: 'A'.repeat(64),
    publicKeyPem: 'unused',
    publicKeySha256: 'B'.repeat(64),
    publicKeySpkiSha256: 'C'.repeat(64),
    validFrom: new Date(0),
    validTo: new Date(Date.now() + 60_000),
    chainAuthorized: false,
  };
}

function activeDevice(overrides: Record<string, unknown> = {}) {
  return {
    id: deviceId,
    principalId: 'principal-1',
    status: 'ACTIVE',
    updateSupervisorCertificateSha256: null,
    updateSupervisorPublicKeySpkiSha256: null,
    recoverySupervisorCertificateSha256: null,
    recoverySupervisorPublicKeySpkiSha256: null,
    ...overrides,
  };
}

function challenge(overrides: Record<string, unknown>) {
  return {
    id: enrollmentId,
    deviceId,
    role: 'UPDATE',
    challengeDigest: supervisorEnrollmentCodeDigest(
      pepper,
      enrollmentId,
      deviceId,
      'UPDATE',
      enrollmentCode,
    ),
    createdByUserId: 'oversight-user',
    expiresAt: new Date(Date.now() + 60_000),
    consumedAt: null,
    device: activeDevice(),
    ...overrides,
  };
}
