import { ConfigService } from '@nestjs/config';
import { AuthService } from './auth.service';

function makeService(overrides: { refreshExpiresIn?: string } = {}) {
  const prisma = {
    user: {
      findUnique: jest.fn(),
    },
    refreshToken: {
      create: jest.fn().mockResolvedValue(undefined),
      deleteMany: jest.fn().mockResolvedValue(undefined),
      findFirst: jest.fn(),
      findMany: jest.fn().mockResolvedValue([]),
      update: jest.fn().mockResolvedValue(undefined),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
    },
    activeSession: {
      create: jest.fn().mockResolvedValue({ id: 'session-1' }),
      findUnique: jest.fn().mockResolvedValue({
        status: 'ACTIVE',
        expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
      }),
      update: jest.fn().mockResolvedValue(undefined),
    },
    securityEvent: {
      create: jest.fn().mockResolvedValue(undefined),
    },
  } as any;

  const jwt = {
    signAsync: jest
      .fn()
      .mockResolvedValueOnce('new-access-token')
      .mockResolvedValueOnce('new-refresh-token'),
    verifyAsync: jest.fn(),
  } as any;

  const config = new ConfigService({
    JWT_ACCESS_SECRET: 'a'.repeat(40),
    JWT_REFRESH_SECRET: 'b'.repeat(40),
    JWT_REFRESH_EXPIRES_IN: overrides.refreshExpiresIn ?? '7d',
  });
  const audit = { log: jest.fn().mockResolvedValue(undefined) } as any;
  const service = new AuthService(prisma, {} as any, jwt, config, audit);

  return { service, prisma, audit };
}

function refreshRecord(overrides: Record<string, unknown> = {}) {
  return {
    id: 'refresh-token-1',
    userId: 'user-1',
    tokenHash: 'stored-token-hash',
    familyId: 'family-1',
    expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
    ipAddress: null,
    userAgent: null,
    revokedAt: null,
    revokedReason: null,
    createdAt: new Date(),
    ...overrides,
  };
}

describe('AuthService.refresh rotation race handling', () => {
  it('allows a recently rotated refresh token without revoking the token family', async () => {
    const { service, prisma } = makeService();
    prisma.refreshToken.findFirst.mockResolvedValue(
      refreshRecord({
        revokedAt: new Date(Date.now() - 1_000),
        revokedReason: 'ROTATION',
      }),
    );
    prisma.user.findUnique.mockResolvedValue({
      id: 'user-1',
      email: 'user@example.com',
      status: 'ACTIVE',
    });

    const result = await service.refresh('user-1', 'raw-refresh-token', undefined, 'session-1');

    expect(result).toEqual({
      accessToken: 'new-access-token',
      refreshToken: 'new-refresh-token',
      tokenType: 'Bearer',
    });
    expect(prisma.refreshToken.update).not.toHaveBeenCalled();
    expect(prisma.refreshToken.updateMany).not.toHaveBeenCalled();
    expect(prisma.activeSession.update).toHaveBeenCalledWith({
      where: { id: 'session-1' },
      data: { lastActivityAt: expect.any(Date) },
    });
    expect(prisma.refreshToken.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          userId: 'user-1',
          familyId: 'family-1',
        }),
      }),
    );
  });

  it('still treats stale revoked refresh tokens as reuse and revokes the family', async () => {
    const { service, prisma } = makeService();
    prisma.refreshToken.findFirst.mockResolvedValue(
      refreshRecord({
        revokedAt: new Date(Date.now() - 61_000),
        revokedReason: 'ROTATION',
      }),
    );

    await expect(
      service.refresh('user-1', 'raw-refresh-token', undefined, 'session-1'),
    ).rejects.toThrow('Refresh token reuse detected');

    expect(prisma.refreshToken.updateMany).toHaveBeenCalledWith({
      where: { familyId: 'family-1', revokedAt: null },
      data: { revokedAt: expect.any(Date), revokedReason: 'REUSE_DETECTED' },
    });
    expect(prisma.user.findUnique).not.toHaveBeenCalled();
    expect(prisma.refreshToken.create).not.toHaveBeenCalled();
  });
});

describe('AuthService persistent refresh sessions', () => {
  it('omits refresh JWT expiration and stores a far-future expiry when configured as never', async () => {
    const { service, prisma } = makeService({ refreshExpiresIn: 'never' });

    await (service as any).issueTokens('user-1', 'user@example.com');

    expect(prisma.activeSession.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          expiresAt: new Date('9999-12-31T23:59:59.999Z'),
        }),
      }),
    );
    expect(prisma.refreshToken.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          expiresAt: new Date('9999-12-31T23:59:59.999Z'),
        }),
      }),
    );
    expect((service as any).jwt.signAsync).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ jti: expect.any(String) }),
      { secret: 'b'.repeat(40) },
    );
  });
});
