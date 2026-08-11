import { BadRequestException, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as argon2 from 'argon2';
import { AuthService } from './auth.service';
import { LoginDto } from './dto/login.dto';

/**
 * Regression coverage for the Wave C password-rotation lockout fix.
 *
 * Before the fix, login()/completeLogin2FA() returned a `passwordChange`-scoped
 * tempToken but NO endpoint consumed it and NOTHING cleared
 * User.mustChangePassword — so a flagged account (the seeded admin) could verify
 * its password yet never obtain a session. These specs assert the full recovery
 * path: flagged login -> tempToken -> change-password (clears flags, auto-login)
 * -> next login issues normal tokens.
 */

function makeService(configOverrides: Record<string, string> = {}) {
  const prisma = {
    user: {
      findUnique: jest.fn(),
      findFirst: jest.fn().mockResolvedValue(null),
      update: jest.fn().mockResolvedValue(undefined),
    },
    userSecurityProfile: {
      findUnique: jest.fn().mockResolvedValue(null),
      upsert: jest.fn().mockResolvedValue(undefined),
    },
    passwordHistory: {
      findMany: jest.fn().mockResolvedValue([]),
      create: jest.fn().mockResolvedValue(undefined),
    },
    refreshToken: {
      create: jest.fn().mockResolvedValue(undefined),
      deleteMany: jest.fn().mockResolvedValue(undefined),
      findMany: jest.fn().mockResolvedValue([]),
      update: jest.fn().mockResolvedValue(undefined),
      updateMany: jest.fn().mockResolvedValue({ count: 0 }),
    },
    activeSession: {
      create: jest.fn().mockResolvedValue({ id: 'sess-1' }),
      findUnique: jest.fn(),
      update: jest.fn().mockResolvedValue(undefined),
      updateMany: jest.fn().mockResolvedValue({ count: 0 }),
    },
    securityEvent: { create: jest.fn().mockResolvedValue(undefined) },
    // $transaction(array) resolves each operation; our mocked ops already return
    // resolved promises, so simply await them all.
    $transaction: jest.fn((ops: Promise<unknown>[]) => Promise.all(ops)),
  } as any;

  const jwt = {
    signAsync: jest.fn().mockResolvedValue('signed-token'),
    verifyAsync: jest.fn(),
  } as any;

  const config = new ConfigService({
    JWT_ACCESS_SECRET: 'a'.repeat(40),
    JWT_REFRESH_SECRET: 'b'.repeat(40),
    JWT_REFRESH_EXPIRES_IN: '7d',
    ...configOverrides,
  });
  const audit = { log: jest.fn().mockResolvedValue(undefined) } as any;
  const service = new AuthService(prisma, {} as any, jwt, config, audit);
  return { service, prisma, jwt, audit };
}

const ADMIN_PASSWORD = 'Admin#Pass123';

async function seededAdminRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'admin-1',
    email: 'admin@itemba.local',
    fullName: 'Seeded Admin',
    status: 'ACTIVE',
    passwordHash: await argon2.hash(ADMIN_PASSWORD),
    mustChangePassword: true,
    failedLoginAttempts: 0,
    lockedUntil: null,
    ...overrides,
  };
}

describe('AuthService password-rotation recovery path (Wave C lockout fix)', () => {
  it('(a) a mustChangePassword user logging in gets requiresPasswordChange + a tempToken', async () => {
    const { service, prisma, jwt } = makeService();
    prisma.user.findUnique.mockResolvedValue(await seededAdminRow());
    jwt.signAsync.mockResolvedValue('pw-change-token');

    const result: any = await service.login({
      email: 'admin@itemba.local',
      password: ADMIN_PASSWORD,
    } as LoginDto);

    expect(result.requiresPasswordChange).toBe(true);
    expect(result.reason).toBe('MUST_CHANGE_PASSWORD');
    expect(result.tempToken).toBe('pw-change-token');
    // Critically: no session/access token was issued for a flagged account.
    expect(result.accessToken).toBeUndefined();
    // The temp token was scoped to passwordChange, not a full session.
    expect(jwt.signAsync).toHaveBeenCalledWith(
      expect.objectContaining({ scope: 'passwordChange', sub: 'admin-1' }),
      expect.objectContaining({ expiresIn: '15m' }),
    );
  });

  it('(a2) a 2FA-enrolled account that is ALSO flagged for rotation is routed to 2FA FIRST, never to change-password (no 2FA bypass)', async () => {
    // Regression for the adversarial-review finding: the password-change gate
    // used to run BEFORE the 2FA gate in login(), so an account with 2FA enabled
    // AND a rotation flag (e.g. elapsed passwordExpiresAt / admin
    // forcePasswordChange) would be handed a `passwordChange` token to anyone who
    // knew only the password — which change-password then converts into a FULL
    // session, bypassing the second factor entirely. login() must now surface the
    // 2FA challenge; the rotation gate is re-checked post-2FA in completeLogin2FA.
    const { service, prisma, jwt } = makeService();
    prisma.user.findUnique.mockResolvedValue(await seededAdminRow());
    // 2FA is enrolled AND the account is flagged (both mustChangePassword on the
    // user row and forcePasswordChange on the profile).
    prisma.userSecurityProfile.findUnique.mockResolvedValue({
      userId: 'admin-1',
      twoFactorEnabled: true,
      twoFactorSecretEncrypted: 'enc',
      forcePasswordChange: true,
      passwordExpiresAt: new Date(Date.now() - 86_400_000),
      lockedUntil: null,
      failedLoginAttempts: 0,
    });
    jwt.signAsync.mockResolvedValue('2fa-temp-token');

    const result: any = await service.login({
      email: 'admin@itemba.local',
      password: ADMIN_PASSWORD,
    } as LoginDto);

    // Must demand 2FA, NOT hand out a password-change token.
    expect(result.requires2FA).toBe(true);
    expect(result.tempToken).toBe('2fa-temp-token');
    expect(result.requiresPasswordChange).toBeUndefined();
    expect(result.accessToken).toBeUndefined();
    // The temp token minted was scoped to twoFactor, not passwordChange.
    expect(jwt.signAsync).toHaveBeenCalledWith(
      expect.objectContaining({ scope: 'twoFactor', sub: 'admin-1' }),
      expect.objectContaining({ expiresIn: '5m' }),
    );
    expect(jwt.signAsync).not.toHaveBeenCalledWith(
      expect.objectContaining({ scope: 'passwordChange' }),
      expect.anything(),
    );
  });

  it('(a3) completeLogin2FA surfaces the password-change requirement only AFTER the 2FA code is verified', async () => {
    // The correct (post-2FA) side of the rotation gate: a 2FA user who clears the
    // code but is flagged for rotation gets a passwordChange token — this is the
    // only path that mints such a token for a 2FA account, so change-password's
    // auto-login can only happen once the second factor is proven.
    const { service, prisma, jwt } = makeService();
    jwt.verifyAsync.mockResolvedValue({
      sub: 'admin-1',
      email: 'admin@itemba.local',
      scope: 'twoFactor',
    });
    prisma.user.findUnique.mockResolvedValue(await seededAdminRow());
    prisma.userSecurityProfile.findUnique.mockResolvedValue({
      userId: 'admin-1',
      twoFactorEnabled: true,
      twoFactorSecretEncrypted: 'enc',
      forcePasswordChange: true,
      passwordExpiresAt: null,
      lockedUntil: null,
      failedLoginAttempts: 0,
    });
    jwt.signAsync.mockResolvedValue('pw-change-after-2fa');
    const twoFactorService = {
      verifyChallenge: jest.fn().mockResolvedValue(undefined),
    };

    const result: any = await service.completeLogin2FA(
      '2fa-temp-token',
      '123456',
      twoFactorService,
    );

    expect(twoFactorService.verifyChallenge).toHaveBeenCalledWith('admin-1', '123456', undefined);
    expect(result.requiresPasswordChange).toBe(true);
    // seededAdminRow has mustChangePassword=true, which takes precedence over the
    // profile's forcePasswordChange in passwordChangeRequiredReason.
    expect(result.reason).toBe('MUST_CHANGE_PASSWORD');
    expect(result.tempToken).toBe('pw-change-after-2fa');
    expect(result.accessToken).toBeUndefined();
  });

  it('(b) change-password with the tempToken sets the password, clears the flags, and returns real tokens', async () => {
    const { service, prisma, jwt } = makeService();
    // Verifying the passwordChange-scoped tempToken.
    jwt.verifyAsync.mockResolvedValue({
      sub: 'admin-1',
      email: 'admin@itemba.local',
      scope: 'passwordChange',
    });
    prisma.user.findUnique.mockResolvedValue(await seededAdminRow());
    // Auto-login tokens.
    jwt.signAsync
      .mockResolvedValueOnce('new-access-token')
      .mockResolvedValueOnce('new-refresh-token');

    const result = await service.changePassword('pw-change-token', 'BrandNew#Pw123');

    expect(result).toEqual({
      accessToken: 'new-access-token',
      refreshToken: 'new-refresh-token',
      tokenType: 'Bearer',
    });

    // User.mustChangePassword must be cleared.
    const userUpdate = prisma.user.update.mock.calls.find(
      (c: any[]) => c[0]?.where?.id === 'admin-1',
    );
    expect(userUpdate[0].data).toEqual(
      expect.objectContaining({
        mustChangePassword: false,
        failedLoginAttempts: 0,
        lockedUntil: null,
        passwordHash: expect.any(String),
      }),
    );

    // UserSecurityProfile.forcePasswordChange must be cleared and expiry refreshed.
    expect(prisma.userSecurityProfile.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { userId: 'admin-1' },
        update: expect.objectContaining({
          forcePasswordChange: false,
          passwordExpiresAt: expect.any(Date),
        }),
      }),
    );

    // New password must be recorded in history and hashed (argon2).
    expect(prisma.passwordHistory.create).toHaveBeenCalled();
    const newHash = userUpdate[0].data.passwordHash;
    expect(newHash.startsWith('$argon2')).toBe(true);
    expect(await argon2.verify(newHash, 'BrandNew#Pw123')).toBe(true);
  });

  it('(c) the NEXT login (after the flag is cleared) issues normal tokens, not a change challenge', async () => {
    const { service, prisma, jwt } = makeService();
    // Simulate the row AFTER the change: flag cleared, new password set.
    prisma.user.findUnique.mockResolvedValue(
      await seededAdminRow({
        mustChangePassword: false,
        passwordHash: await argon2.hash('BrandNew#Pw123'),
      }),
    );
    jwt.signAsync.mockResolvedValueOnce('access-2').mockResolvedValueOnce('refresh-2');

    const result: any = await service.login({
      email: 'admin@itemba.local',
      password: 'BrandNew#Pw123',
    } as LoginDto);

    expect(result.requiresPasswordChange).toBeUndefined();
    expect(result).toEqual({
      accessToken: 'access-2',
      refreshToken: 'refresh-2',
      tokenType: 'Bearer',
    });
  });

  it('rejects change-password when the tempToken has the wrong scope (no 2FA/normal token accepted)', async () => {
    const { service, jwt } = makeService();
    jwt.verifyAsync.mockResolvedValue({ sub: 'admin-1', scope: 'twoFactor' });

    await expect(service.changePassword('not-a-pw-token', 'BrandNew#Pw123')).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });

  it('rejects change-password when the tempToken is invalid/expired', async () => {
    const { service, jwt } = makeService();
    jwt.verifyAsync.mockRejectedValue(new Error('jwt expired'));

    await expect(service.changePassword('expired', 'BrandNew#Pw123')).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });

  it('enforces the minimum-length policy on the new password', async () => {
    const { service, prisma, jwt } = makeService();
    jwt.verifyAsync.mockResolvedValue({
      sub: 'admin-1',
      scope: 'passwordChange',
    });
    prisma.user.findUnique.mockResolvedValue(await seededAdminRow());

    await expect(service.changePassword('tok', 'short')).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(prisma.user.update).not.toHaveBeenCalled();
  });

  it('rejects reuse of the current password', async () => {
    const { service, prisma, jwt } = makeService();
    jwt.verifyAsync.mockResolvedValue({
      sub: 'admin-1',
      scope: 'passwordChange',
    });
    prisma.user.findUnique.mockResolvedValue(await seededAdminRow());

    await expect(service.changePassword('tok', ADMIN_PASSWORD)).rejects.toThrow('reuse');
    expect(prisma.user.update).not.toHaveBeenCalled();
  });

  it('rejects reuse of a recent (historical) password', async () => {
    const { service, prisma, jwt } = makeService();
    jwt.verifyAsync.mockResolvedValue({
      sub: 'admin-1',
      scope: 'passwordChange',
    });
    prisma.user.findUnique.mockResolvedValue(await seededAdminRow());
    prisma.passwordHistory.findMany.mockResolvedValue([
      { passwordHash: await argon2.hash('OldRecent#1') },
    ]);

    await expect(service.changePassword('tok', 'OldRecent#1')).rejects.toThrow('reuse');
  });
});

describe('AuthService.login tolerant email lookup (legacy mixed-case rows)', () => {
  it('authenticates a legacy mixed-case account via case-insensitive fallback', async () => {
    const { service, prisma, jwt } = makeService();
    // Strict lookup by lowercased email misses the legacy row.
    prisma.user.findUnique.mockResolvedValue(null);
    prisma.user.findFirst.mockResolvedValue({
      id: 'legacy-1',
      email: 'Legacy.User@Example.com',
      fullName: 'Legacy',
      status: 'ACTIVE',
      passwordHash: await argon2.hash('LegacyPass1'),
      mustChangePassword: false,
      failedLoginAttempts: 0,
      lockedUntil: null,
    });
    jwt.signAsync.mockResolvedValueOnce('legacy-access').mockResolvedValueOnce('legacy-refresh');

    const result: any = await service.login({
      email: 'legacy.user@example.com',
      password: 'LegacyPass1',
    } as LoginDto);

    expect(prisma.user.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { email: { equals: 'legacy.user@example.com', mode: 'insensitive' } },
      }),
    );
    expect(result).toEqual({
      accessToken: 'legacy-access',
      refreshToken: 'legacy-refresh',
      tokenType: 'Bearer',
    });
  });

  it('does not fall back when the strict lookup already matched', async () => {
    const { service, prisma, jwt } = makeService();
    prisma.user.findUnique.mockResolvedValue({
      id: 'u-1',
      email: 'a@b.c',
      fullName: 'A',
      status: 'ACTIVE',
      passwordHash: await argon2.hash('GoodPass1'),
      mustChangePassword: false,
      failedLoginAttempts: 0,
      lockedUntil: null,
    });
    jwt.signAsync.mockResolvedValue('tok');

    await service.login({ email: 'a@b.c', password: 'GoodPass1' } as LoginDto);

    expect(prisma.user.findFirst).not.toHaveBeenCalled();
  });
});
