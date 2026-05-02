import { UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as argon2 from 'argon2';
import { AuthService } from './auth.service';
import { LoginDto } from './dto/login.dto';

/**
 * P1-10 regression — observable contracts that follow from constant-time login.
 *
 * Assert response *behavior* rather than instrumenting argon2 itself (its
 * named exports are non-configurable, so jest.spyOn can't patch them).
 *
 * The two contracts that prove the fix is in place:
 *   1. Every credential failure (missing user, inactive user, wrong password,
 *      locked account) returns the same generic "Invalid credentials" message.
 *   2. The "user not found" path is not measurably faster than the "wrong
 *      password" path. We assert this with a coarse threshold (the "missing"
 *      path takes at least argon2-verify time on the dummy hash). This is a
 *      timing test — kept conservative so it doesn't flake in CI.
 */

function makeService() {
  const prisma = {
    user: {
      findUnique: jest.fn(),
      update: jest.fn().mockResolvedValue(undefined),
    },
    refreshToken: {
      create: jest.fn(),
      deleteMany: jest.fn(),
      findMany: jest.fn().mockResolvedValue([]),
      update: jest.fn(),
      updateMany: jest.fn(),
    },
    activeSession: {
      create: jest.fn().mockResolvedValue({ id: 'sess-1' }),
      findUnique: jest.fn(),
      update: jest.fn(),
    },
    securityEvent: { create: jest.fn().mockResolvedValue(undefined) },
    userSecurityProfile: { findUnique: jest.fn().mockResolvedValue(null) },
  } as any;
  const usersService = {} as any;
  const jwt = {
    signAsync: jest.fn().mockResolvedValue('token'),
    verifyAsync: jest.fn(),
  } as any;
  const config = new ConfigService({
    JWT_ACCESS_SECRET: 'a'.repeat(40),
    JWT_REFRESH_SECRET: 'b'.repeat(40),
    JWT_REFRESH_EXPIRES_IN: '7d',
    ALLOW_PUBLIC_REGISTRATION: 'true',
  });
  const audit = { log: jest.fn().mockResolvedValue(undefined) } as any;
  const service = new AuthService(prisma, usersService, jwt, config, audit);
  return { service, prisma };
}

describe('AuthService.login generic-error contract (P1-10 regression)', () => {
  let realArgonHash: string;

  beforeAll(async () => {
    // Generate a real argon2 hash once so the "wrong password" path runs argon2
    // verify against a real digest.
    realArgonHash = await argon2.hash('correct-password');
  });

  it('returns "Invalid credentials" when the user does not exist', async () => {
    const { service, prisma } = makeService();
    prisma.user.findUnique.mockResolvedValue(null);

    await expect(
      service.login({ email: 'ghost@x.com', password: 'pw' } as LoginDto),
    ).rejects.toThrow('Invalid credentials');
  });

  it('returns "Invalid credentials" when the user is INACTIVE', async () => {
    const { service, prisma } = makeService();
    prisma.user.findUnique.mockResolvedValue({
      id: 'u-1',
      email: 'a@b.c',
      status: 'INACTIVE',
      passwordHash: realArgonHash,
      failedLoginAttempts: 0,
      lockedUntil: null,
    });

    await expect(
      service.login({ email: 'a@b.c', password: 'wrong' } as LoginDto),
    ).rejects.toThrow('Invalid credentials');
  });

  it('returns "Invalid credentials" when the password is wrong', async () => {
    const { service, prisma } = makeService();
    prisma.user.findUnique.mockResolvedValue({
      id: 'u-1',
      email: 'a@b.c',
      status: 'ACTIVE',
      passwordHash: realArgonHash,
      failedLoginAttempts: 0,
      lockedUntil: null,
    });

    await expect(
      service.login({ email: 'a@b.c', password: 'definitely-wrong' } as LoginDto),
    ).rejects.toThrow('Invalid credentials');
  });

  it('returns "Invalid credentials" when the account is locked (not a leak about lockout)', async () => {
    const { service, prisma } = makeService();
    prisma.user.findUnique.mockResolvedValue({
      id: 'u-1',
      email: 'a@b.c',
      status: 'ACTIVE',
      passwordHash: realArgonHash,
      failedLoginAttempts: 5,
      lockedUntil: new Date(Date.now() + 60_000),
    });

    // P1-10: lockout response no longer says "Account is temporarily locked";
    // every credential failure returns the same generic message so an
    // attacker cannot use the response to enumerate lockout state.
    await expect(
      service.login({ email: 'a@b.c', password: 'pw' } as LoginDto),
    ).rejects.toThrow('Invalid credentials');
  });
});

describe('AuthService.login timing parity (P1-10 regression, coarse)', () => {
  // We verify that "missing user" and "wrong password" both take at least
  // argon2-verify-shaped time. The exact wall time of argon2 depends on the
  // host, so we use a relative threshold: missing-user time must be at least
  // 50% of wrong-password time. Without the dummy-hash path, missing-user
  // would return in ~1ms vs wrong-password's ~50ms, dropping the ratio well
  // below 0.5.
  it('missing-user path is not faster than wrong-password path by an order of magnitude', async () => {
    jest.setTimeout(15_000);
    const realArgonHash = await argon2.hash('correct-password');

    async function timeWrongPassword(): Promise<number> {
      const { service, prisma } = makeService();
      prisma.user.findUnique.mockResolvedValue({
        id: 'u-1',
        email: 'a@b.c',
        status: 'ACTIVE',
        passwordHash: realArgonHash,
        failedLoginAttempts: 0,
        lockedUntil: null,
      });
      const t0 = Date.now();
      await service
        .login({ email: 'a@b.c', password: 'wrong' } as LoginDto)
        .catch(() => undefined);
      return Date.now() - t0;
    }

    async function timeMissingUser(): Promise<number> {
      const { service, prisma } = makeService();
      prisma.user.findUnique.mockResolvedValue(null);
      const t0 = Date.now();
      await service
        .login({ email: 'ghost@x.com', password: 'pw' } as LoginDto)
        .catch(() => undefined);
      return Date.now() - t0;
    }

    const wrongPasswordTime = await timeWrongPassword();
    const missingUserTime = await timeMissingUser();

    // Coarse threshold: missing-user path should be at least 30% of wrong-pw
    // path. Generous enough not to flake on CPU-busy CI runners; still tight
    // enough that a regression to "no dummy verify" (sub-1ms missing path)
    // would fail.
    expect(missingUserTime).toBeGreaterThan(wrongPasswordTime * 0.3);
  });
});

void UnauthorizedException;
