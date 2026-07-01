import { BadRequestException } from '@nestjs/common';
import { AccessLevel } from '@prisma/client';
import { UserSecurityProfilesService } from './user-security-profiles.service';

const actor = { id: 'admin-1' } as any;

function makeService(opts: {
  profile?: Record<string, any> | null;
  targetUser?: Record<string, any> | null;
} = {}) {
  const profile =
    opts.profile === undefined
      ? {
          id: 'profile-1',
          userId: 'user-1',
          twoFactorEnabled: false,
          twoFactorSecretEncrypted: null,
          lockedUntil: null,
          user: { companyId: 'company-1', companyAccess: [] },
        }
      : opts.profile;

  const targetUser =
    opts.targetUser === undefined
      ? { companyId: 'company-1', companyAccess: [] }
      : opts.targetUser;

  const userSecurityProfile = {
    findFirst: jest.fn(async () => profile),
    findUnique: jest.fn(async () => profile),
    create: jest.fn(async ({ data }: any) => ({ id: 'profile-new', ...data })),
    update: jest.fn(async ({ data }: any) => ({ id: 'profile-1', ...data })),
    count: jest.fn(async () => 0),
    findMany: jest.fn(async () => []),
  };

  const userDelegate = {
    findFirst: jest.fn(async () => targetUser),
    update: jest.fn(async () => ({})),
  };

  const prisma: any = {
    userSecurityProfile,
    user: userDelegate,
    $transaction: jest.fn(async (cb: any) => cb(prisma)),
  };

  const auditLogs = { log: jest.fn(async () => undefined) } as any;

  // Group-scoped actor so access checks are permissive; the findings under test are
  // about 2FA / lock enforcement, not company scoping (covered elsewhere).
  const companyScope = {
    isGroupScoped: jest.fn(() => true),
    assertGroupScoped: jest.fn(),
    assertCanAccessCompany: jest.fn(async () => undefined),
    accessibleCompanyIds: jest.fn(async () => ['company-1']),
  } as any;

  const service = new UserSecurityProfilesService(prisma, auditLogs, companyScope);
  return { service, prisma, userDelegate, userSecurityProfile, auditLogs };
}

describe('UserSecurityProfilesService', () => {
  describe('2FA enablement without a secret (lockout prevention)', () => {
    it('rejects enabling twoFactorEnabled on create (no secret can exist yet)', async () => {
      const { service, userSecurityProfile } = makeService();
      await expect(
        service.create({ userId: 'user-1', twoFactorEnabled: true }, actor),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(userSecurityProfile.create).not.toHaveBeenCalled();
    });

    it('forces twoFactorEnabled to false on create even if omitted-truthy string sneaks in', async () => {
      const { service, userSecurityProfile } = makeService();
      await service.create({ userId: 'user-1' }, actor);
      expect(userSecurityProfile.create).toHaveBeenCalledTimes(1);
      expect(userSecurityProfile.create.mock.calls[0][0].data.twoFactorEnabled).toBe(false);
    });

    it('rejects enabling twoFactorEnabled on update when no secret is provisioned', async () => {
      const { service, userSecurityProfile } = makeService({
        profile: {
          id: 'profile-1',
          userId: 'user-1',
          twoFactorEnabled: false,
          twoFactorSecretEncrypted: null,
          lockedUntil: null,
          user: { companyId: 'company-1', companyAccess: [] },
        },
      });
      await expect(
        service.update('profile-1', { twoFactorEnabled: true }, actor),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(userSecurityProfile.update).not.toHaveBeenCalled();
    });

    it('allows enabling twoFactorEnabled on update when a secret exists', async () => {
      const { service, userSecurityProfile } = makeService({
        profile: {
          id: 'profile-1',
          userId: 'user-1',
          twoFactorEnabled: false,
          twoFactorSecretEncrypted: 'enc-secret',
          lockedUntil: null,
          user: { companyId: 'company-1', companyAccess: [] },
        },
      });
      await service.update('profile-1', { twoFactorEnabled: true }, actor);
      expect(userSecurityProfile.update).toHaveBeenCalledTimes(1);
      expect(userSecurityProfile.update.mock.calls[0][0].data.twoFactorEnabled).toBe(true);
    });
  });

  describe('admin lock is mirrored onto the User row so login honors it', () => {
    it('mirrors lockedUntil onto User.lockedUntil when locking via the profile', async () => {
      const lockDate = new Date(Date.now() + 60 * 60_000).toISOString();
      const { service, userDelegate } = makeService();
      await service.update('profile-1', { lockedUntil: lockDate }, actor);
      expect(userDelegate.update).toHaveBeenCalledTimes(1);
      const args = (userDelegate.update as jest.Mock).mock.calls[0][0] as any;
      expect(args.where).toEqual({ id: 'user-1' });
      expect(args.data.lockedUntil).toEqual(new Date(lockDate));
    });

    it('clears User.lockedUntil and resets failedLoginAttempts when unlocking (lockedUntil=null)', async () => {
      const { service, userDelegate } = makeService();
      await service.update('profile-1', { lockedUntil: null }, actor);
      expect(userDelegate.update).toHaveBeenCalledTimes(1);
      const args = (userDelegate.update as jest.Mock).mock.calls[0][0] as any;
      expect(args.data).toEqual({ lockedUntil: null, failedLoginAttempts: 0 });
    });

    it('does not touch the User row when lockedUntil is not part of the update', async () => {
      const { service, userDelegate } = makeService();
      await service.update('profile-1', { securityRiskLevel: 'HIGH' }, actor);
      expect(userDelegate.update).not.toHaveBeenCalled();
    });
  });
});
