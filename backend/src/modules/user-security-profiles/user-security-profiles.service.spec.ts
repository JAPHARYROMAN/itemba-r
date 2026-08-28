import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { AccessLevel } from '@prisma/client';
import { UserSecurityProfilesService } from './user-security-profiles.service';

const actor = { id: 'admin-1' } as any;

function makeService(
  opts: {
    profile?: Record<string, any> | null;
    targetUser?: Record<string, any> | null;
    groupScoped?: boolean;
    denyCompanyManage?: boolean;
  } = {},
) {
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
    opts.targetUser === undefined ? { companyId: 'company-1', companyAccess: [] } : opts.targetUser;

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
    isGroupScoped: jest.fn(() => opts.groupScoped ?? true),
    assertGroupScoped: jest.fn(),
    assertCanAccessCompany: jest.fn(async () => {
      if (opts.denyCompanyManage) throw new ForbiddenException('Company access denied');
    }),
    accessibleCompanyIds: jest.fn(async () => ['company-1']),
  } as any;

  const service = new UserSecurityProfilesService(prisma, auditLogs, companyScope);
  return { service, prisma, userDelegate, userSecurityProfile, auditLogs, companyScope };
}

describe('UserSecurityProfilesService', () => {
  describe('governed persistence and audit', () => {
    it('creates only administrative fields and attributes the audit to the target company', async () => {
      const { service, userSecurityProfile, auditLogs } = makeService();

      await service.create(
        {
          userId: 'user-1',
          forcePasswordChange: true,
          forceTwoFactorSetup: true,
          securityRiskLevel: 'MEDIUM',
        },
        actor,
      );

      const data = userSecurityProfile.create.mock.calls[0][0].data;
      expect(data).toEqual({
        userId: 'user-1',
        twoFactorEnabled: false,
        twoFactorMethod: 'NONE',
        forcePasswordChange: true,
        forceTwoFactorSetup: true,
        securityRiskLevel: 'MEDIUM',
      });
      expect(data).not.toHaveProperty('twoFactorSecretEncrypted');
      expect(data).not.toHaveProperty('backupCodesHash');
      expect(auditLogs.log).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'USER_SECURITY_PROFILE_CREATED',
          entityType: 'UserSecurityProfile',
          entityId: 'profile-new',
          userId: 'admin-1',
          companyId: 'company-1',
        }),
      );
    });

    it('updates only allowlisted fields and never copies stored secret material', async () => {
      const { service, userSecurityProfile, auditLogs } = makeService({
        profile: {
          id: 'profile-1',
          userId: 'user-1',
          twoFactorEnabled: false,
          twoFactorSecretEncrypted: 'opaque-enrollment-value',
          backupCodesHash: ['opaque-code-digest'],
          user: { companyId: 'company-1', companyAccess: [] },
        },
      });

      await service.update('profile-1', { forcePasswordChange: true }, actor);

      const data = userSecurityProfile.update.mock.calls[0][0].data;
      expect(data).toEqual({ forcePasswordChange: true });
      expect(data).not.toHaveProperty('twoFactorSecretEncrypted');
      expect(data).not.toHaveProperty('backupCodesHash');
      expect(auditLogs.log).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'USER_SECURITY_PROFILE_UPDATED',
          entityType: 'UserSecurityProfile',
          entityId: 'profile-1',
          userId: 'admin-1',
          companyId: 'company-1',
        }),
      );
    });

    it('denies a foreign-company create before profile persistence or audit', async () => {
      const { service, userSecurityProfile, auditLogs } = makeService({
        groupScoped: false,
        denyCompanyManage: true,
      });

      await expect(service.create({ userId: 'user-1' }, actor)).rejects.toBeInstanceOf(
        ForbiddenException,
      );
      expect(userSecurityProfile.create).not.toHaveBeenCalled();
      expect(auditLogs.log).not.toHaveBeenCalled();
    });
  });

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
