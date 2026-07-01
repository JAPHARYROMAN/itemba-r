import { ConfigService } from '@nestjs/config';
import * as argon2 from 'argon2';
import { PasswordResetService } from './password-reset.service';

/**
 * Regression coverage: the email password-reset flow must be a COMPLETE recovery
 * path for a flagged account. Alongside setting the new password it must clear
 * User.mustChangePassword and UserSecurityProfile.forcePasswordChange and refresh
 * passwordExpiresAt — otherwise a reset would leave the account still gated and
 * unable to obtain a session (the same class of lockout as the Wave C bug).
 */

function makeService(configOverrides: Record<string, string> = {}) {
  const prisma = {
    passwordResetToken: {
      updateMany: jest.fn().mockResolvedValue({ count: 0 }),
      create: jest.fn().mockResolvedValue(undefined),
      findFirst: jest.fn(),
      findMany: jest.fn().mockResolvedValue([]),
      update: jest.fn().mockResolvedValue(undefined),
    },
    passwordHistory: {
      findMany: jest.fn().mockResolvedValue([]),
      create: jest.fn().mockResolvedValue(undefined),
    },
    user: { update: jest.fn().mockResolvedValue(undefined) },
    userSecurityProfile: { upsert: jest.fn().mockResolvedValue(undefined) },
    refreshToken: { updateMany: jest.fn().mockResolvedValue({ count: 0 }) },
    activeSession: { updateMany: jest.fn().mockResolvedValue({ count: 0 }) },
    securityEvent: { create: jest.fn().mockResolvedValue(undefined) },
    $transaction: jest.fn((ops: Promise<unknown>[]) => Promise.all(ops)),
  } as any;

  const audit = { log: jest.fn().mockResolvedValue(undefined) } as any;
  const config = new ConfigService({
    APP_ENCRYPTION_KEY: 'k'.repeat(40),
    ...configOverrides,
  });
  const service = new PasswordResetService(prisma, audit, config);
  return { service, prisma };
}

describe('PasswordResetService.resetPassword clears the rotation gate', () => {
  it('(d) clears mustChangePassword + forcePasswordChange and refreshes passwordExpiresAt', async () => {
    const { service, prisma } = makeService();
    prisma.passwordResetToken.findFirst.mockResolvedValue({
      id: 'tok-1',
      userId: 'user-1',
      user: {
        id: 'user-1',
        email: 'admin@itemba.local',
        fullName: 'Admin',
        status: 'ACTIVE',
      },
    });

    const result = await service.resetPassword('raw-reset-token', 'BrandNew#Pw123');

    // User.mustChangePassword cleared.
    expect(prisma.user.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'user-1' },
        data: expect.objectContaining({
          mustChangePassword: false,
          passwordHash: expect.any(String),
          failedLoginAttempts: 0,
          lockedUntil: null,
        }),
      }),
    );

    // UserSecurityProfile.forcePasswordChange cleared + expiry refreshed.
    expect(prisma.userSecurityProfile.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { userId: 'user-1' },
        update: expect.objectContaining({
          forcePasswordChange: false,
          passwordExpiresAt: expect.any(Date),
        }),
        create: expect.objectContaining({
          userId: 'user-1',
          forcePasswordChange: false,
        }),
      }),
    );

    // Existing sessions/refresh tokens are dropped.
    expect(prisma.refreshToken.updateMany).toHaveBeenCalled();
    expect(prisma.activeSession.updateMany).toHaveBeenCalled();
    expect(result.message).toMatch(/log in/i);
  });

  it('disables password expiry when PASSWORD_ROTATION_DAYS is 0', async () => {
    const { service, prisma } = makeService({ PASSWORD_ROTATION_DAYS: '0' });
    prisma.passwordResetToken.findFirst.mockResolvedValue({
      id: 'tok-1',
      userId: 'user-1',
      user: { id: 'user-1', email: 'a@b.c', fullName: 'A', status: 'ACTIVE' },
    });

    await service.resetPassword('raw-reset-token', 'BrandNew#Pw123');

    const upsertArgs = prisma.userSecurityProfile.upsert.mock.calls[0][0];
    expect(upsertArgs.update.passwordExpiresAt).toBeNull();
  });
});

// Keep argon2 import used even if the compiler prunes unused symbols.
void argon2;
