import { BadRequestException, ConflictException, ForbiddenException } from '@nestjs/common';
import { MobilePosEnrollment } from '@prisma/client';
import { MobilePosAuthService, mobilePosHash } from './mobile-pos-auth.service';
import { NotificationsService } from '../notifications/notifications.service';
import { CompanyScopeService } from '../../common/services/company-scope.service';
import { OrganizationScopeService } from '../../common/services/organization-scope.service';
import { AuthUser } from '../../common/decorators/current-user.decorator';

jest.mock('argon2', () => ({ hash: jest.fn(async () => 'private-test-hash') }));
const requestId = '11111111-1111-4111-8111-111111111111';
const claimToken = 'c'.repeat(32);
const inviteToken = 'i'.repeat(32);
const body = { requestId, claimToken, name: 'Maua', role: 'CASHIER' as const };
const manager: AuthUser = {
  id: 'reviewer',
  email: 'reviewer@itemba.invalid',
  roles: ['manager'],
  roleScopes: ['COMPANY'],
  permissions: ['mobile_pos_onboarding.manage', 'notifications.view'],
  companyId: 'company-a',
  companyAccess: [],
  divisionAccess: [],
  branchAccess: [],
};
function candidate(id: string, overrides: Partial<AuthUser> = {}) {
  const user = { ...manager, id, ...overrides };
  return {
    ...user,
    status: 'ACTIVE',
    authKind: 'PASSWORD',
    deletedAt: null,
    userRoles: [
      {
        role: {
          name: 'manager',
          scope: user.roleScopes![0],
          rolePermissions: user.permissions.map((code) => ({ permission: { code } })),
        },
      },
    ],
  };
}
function fixture() {
  const setup = {
    id: 'setup-a',
    companyId: 'company-a',
    divisionId: 'division-a',
    branchId: 'branch-a',
    enabled: true,
    approvalRequired: true,
    paymentMappings: [],
  };
  const enrollments = new Map<string, MobilePosEnrollment>();
  const inbox = new Map<string, Record<string, unknown>>();
  const recipients = [
    candidate('company-admin'),
    candidate('branch-admin', {
      roleScopes: ['BRANCH'],
      branchAccess: [{ branchId: 'branch-a', accessLevel: 'WRITE' }],
    }),
    candidate('division-admin', {
      roleScopes: ['DIVISION'],
      divisionAccess: [{ divisionId: 'division-a', accessLevel: 'MANAGE' }],
    }),
    candidate('other-branch', {
      roleScopes: ['BRANCH'],
      branchAccess: [{ branchId: 'branch-b', accessLevel: 'MANAGE' }],
    }),
    candidate('foreign-company', { companyId: 'company-b' }),
    candidate('read-only', {
      companyId: 'company-b',
      companyAccess: [{ companyId: 'company-a', accessLevel: 'READ' }],
    }),
    candidate('group-read-only', { companyId: null, roleScopes: ['GROUP'], companyAccess: [] }),
    candidate('group-admin', {
      companyId: null,
      roleScopes: ['GROUP'],
      companyAccess: [{ companyId: 'company-a', accessLevel: 'WRITE' }],
    }),
    candidate('other-group', {
      companyId: 'company-b',
      roleScopes: ['GROUP'],
      companyAccess: [{ companyId: 'company-b', accessLevel: 'MANAGE' }],
    }),
    candidate('no-permission', { permissions: [] }),
    candidate('no-inbox', { permissions: ['mobile_pos_onboarding.manage'] }),
    candidate('reviewer'),
    candidate('linker'),
  ];
  const prisma = {
    mobilePosInvite: {
      findUnique: jest.fn(async () => ({
        id: 'invite-a',
        branchSetup: setup,
        expiresAt: new Date(Date.now() + 86400000),
        revokedAt: null,
      })),
    },
    mobilePosEnrollment: {
      create: jest.fn(async ({ data }: { data: Partial<MobilePosEnrollment> }) => {
        const row: MobilePosEnrollment = {
          id: requestId,
          branchSetupId: setup.id,
          companyId: setup.companyId,
          divisionId: setup.divisionId,
          branchId: setup.branchId,
          name: 'Maua',
          requestedRole: 'CASHIER',
          status: 'PENDING',
          approvedRole: null,
          userId: null,
          terminalId: null,
          claimTokenHash: mobilePosHash(claimToken),
          claimExpiresAt: new Date(Date.now() + 86400000),
          setupTokenHash: null,
          setupExpiresAt: null,
          deviceSecretHash: null,
          pinHash: null,
          credentialVersion: 1,
          failedPinAttempts: 0,
          lockedUntil: null,
          approvedById: null,
          approvedAt: null,
          rejectedReason: null,
          createdAt: new Date(),
          updatedAt: new Date(),
          ...data,
        };
        enrollments.set(row.id, row);
        return row;
      }),
      findUnique: jest.fn(async ({ where }: { where: { id: string } }) => {
        const row = enrollments.get(where.id);
        return row ? { ...row, branchSetup: setup } : null;
      }),
      findUniqueOrThrow: jest.fn(async ({ where }: { where: { id: string } }) => {
        const row = enrollments.get(where.id);
        if (!row) throw new Error('missing enrollment');
        return { ...row };
      }),
      findFirst: jest.fn(async () => enrollments.get(requestId)),
      updateMany: jest.fn(
        async ({
          where,
          data,
        }: {
          where: { id: string; status: string; userId?: null };
          data: Partial<MobilePosEnrollment>;
        }) => {
          const row = enrollments.get(where.id);
          if (!row || row.status !== where.status || (where.userId === null && row.userId !== null))
            return { count: 0 };
          enrollments.set(row.id, { ...row, ...data });
          return { count: 1 };
        },
      ),
    },
    user: {
      findMany: jest.fn(async () => recipients),
      findUnique: jest.fn(async ({ where }: { where: { id: string } }) =>
        recipients.find((r) => r.id === where.id),
      ),
      create: jest.fn(),
    },
    mobilePosTerminal: { create: jest.fn() },
    notification: {
      upsert: jest.fn(
        async ({
          where,
          create,
        }: {
          where: { notificationNumber: string };
          create: Record<string, unknown>;
        }) => {
          if (!inbox.has(where.notificationNumber))
            inbox.set(where.notificationNumber, { ...create });
          return inbox.get(where.notificationNumber);
        },
      ),
      updateMany: jest.fn(async () => {
        for (const record of inbox.values())
          if (record.notificationType === 'APPROVAL_REQUIRED') record.status = 'READ';
        return { count: inbox.size };
      }),
    },
    company: { findUniqueOrThrow: jest.fn(async () => ({ id: setup.companyId })) },
    division: { findUniqueOrThrow: jest.fn(async () => ({ id: setup.divisionId })) },
    branch: { findUniqueOrThrow: jest.fn(async () => ({ id: setup.branchId })) },
    $executeRaw: jest.fn(),
  };
  const transaction = jest.fn(async (fn: (tx: typeof prisma) => Promise<unknown>) => {
    const previousIds = new Set(enrollments.keys());
    const previousNotifications = new Set(inbox.keys());
    try {
      return await fn(prisma);
    } catch (error) {
      for (const id of enrollments.keys()) if (!previousIds.has(id)) enrollments.delete(id);
      for (const key of inbox.keys()) if (!previousNotifications.has(key)) inbox.delete(key);
      throw error;
    }
  });
  const db = { ...prisma, $transaction: transaction };
  const audit = { logStrictInTransaction: jest.fn() };
  const email = { sendEmail: jest.fn() };
  const notifications = new NotificationsService(db as never, audit as never, email as never);
  const service = new MobilePosAuthService(
    db as never,
    {} as never,
    {} as never,
    audit as never,
    new CompanyScopeService(db as never),
    new OrganizationScopeService(db as never),
    notifications,
  );
  return { service, prisma, transaction, enrollments, inbox, recipients, audit, email };
}

describe('POS enrollment delivery and reviewed administrator linkage', () => {
  it('persists one request and one inbox item per authorized scoped office admin across a lost-response retry', async () => {
    const f = fixture();
    const first = await f.service.register(inviteToken, body);
    const retry = await f.service.register(inviteToken, body);
    expect(retry).toEqual(first);
    expect(first).toMatchObject({
      enrollmentId: requestId,
      claimToken,
      status: 'PENDING',
      adminLinked: false,
    });
    expect(f.enrollments.size).toBe(1);
    expect(f.prisma.mobilePosEnrollment.create).toHaveBeenCalledTimes(1);
    expect([...f.inbox.values()].map((r) => r.recipientUserId).sort()).toEqual([
      'branch-admin',
      'company-admin',
      'division-admin',
      'group-admin',
      'linker',
      'reviewer',
    ]);
    expect(f.prisma.user.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ status: 'ACTIVE', authKind: 'PASSWORD', deletedAt: null }),
      }),
    );
    expect(f.inbox.size).toBe(6);
    expect(f.audit.logStrictInTransaction).toHaveBeenCalledTimes(1);
    for (const item of f.inbox.values()) {
      expect(item).toMatchObject({
        companyId: 'company-a',
        linkedEntityType: 'MobilePosEnrollment',
        linkedEntityId: requestId,
        actionUrl: `/pos-draft?view=devices&enrollmentId=${requestId}`,
      });
      expect(JSON.stringify(item)).not.toContain(claimToken);
      expect(JSON.stringify(item)).not.toContain(mobilePosHash(claimToken));
    }
    expect(f.email.sendEmail).not.toHaveBeenCalled();
  });

  it.each([
    { name: 'Different name' },
    { role: 'STOCKIST' as const },
    { claimToken: 'x'.repeat(32) },
  ])('refuses a changed retry without a second request or notification', async (change) => {
    const f = fixture();
    await f.service.register(inviteToken, body);
    await expect(f.service.register(inviteToken, { ...body, ...change })).rejects.toBeInstanceOf(
      ConflictException,
    );
    expect(f.enrollments.size).toBe(1);
    expect(f.inbox.size).toBe(6);
  });

  it.each([
    { requestId, name: 'Maua', role: 'CASHIER' as const },
    { claimToken, name: 'Maua', role: 'CASHIER' as const },
  ])('requires the complete retry pair', async (dto) => {
    const f = fixture();
    await expect(f.service.register(inviteToken, dto)).rejects.toBeInstanceOf(BadRequestException);
    expect(f.transaction).not.toHaveBeenCalled();
  });

  it('rolls back enrollment when inbox persistence fails and allows the same request to recover', async () => {
    const f = fixture();
    f.prisma.notification.upsert.mockRejectedValueOnce(new Error('inbox unavailable'));
    await expect(f.service.register(inviteToken, body)).rejects.toThrow('inbox unavailable');
    expect(f.enrollments.size).toBe(0);
    expect(f.inbox.size).toBe(0);
    await f.service.register(inviteToken, body);
    expect(f.enrollments.size).toBe(1);
    expect(f.inbox.size).toBe(6);
  });

  it('requires ADMIN review before linking and does not grant an office account or a PIN terminal', async () => {
    const f = fixture();
    await f.service.register(inviteToken, { ...body, role: 'ADMIN' });
    await expect(f.service.adminLink(requestId, claimToken, manager)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    const approved = await f.service.approve(requestId, { role: 'ADMIN' }, manager);
    expect(approved).toMatchObject({
      approvedRole: 'ADMIN',
      status: 'APPROVED',
      userId: null,
      terminalId: null,
      adminLinked: false,
    });
    expect(f.prisma.user.create).not.toHaveBeenCalled();
    expect(f.prisma.mobilePosTerminal.create).not.toHaveBeenCalled();
    const reviewed = f.enrollments.get(requestId)!;
    const linked = await f.service.adminLink(requestId, claimToken, { ...manager, id: 'linker' });
    expect(linked).toMatchObject({ userId: 'linker', adminLinked: true, terminalId: null });
    expect(f.enrollments.get(requestId)).toMatchObject({
      approvedById: 'reviewer',
      approvedAt: reviewed.approvedAt,
    });
    expect(await f.service.adminLink(requestId, claimToken, { ...manager, id: 'linker' })).toEqual(
      linked,
    );
    const retry = await f.service.register(inviteToken, { ...body, role: 'ADMIN' });
    expect(retry).toMatchObject({
      status: 'APPROVED',
      role: 'ADMIN',
      requestedRole: 'ADMIN',
      adminLinked: true,
    });
    expect(f.enrollments.size).toBe(1);
    expect(f.inbox.size).toBe(12);
    await expect(f.service.adminLink(requestId, claimToken, manager)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    expect(
      [...f.inbox.values()]
        .filter((n) => n.notificationType === 'APPROVAL_REQUIRED')
        .every((n) => n.status === 'READ'),
    ).toBe(true);
    expect(
      [...f.inbox.values()].filter((n) => n.notificationType === 'APPROVAL_APPROVED'),
    ).toHaveLength(6);
  });

  it.each([
    { ...manager, tokenUse: 'mobile-pos' as const },
    { ...manager, principalType: 'SERVICE' },
    { ...manager, permissions: [] },
    { ...manager, companyId: 'company-b' },
    {
      ...manager,
      roleScopes: ['BRANCH'],
      branchAccess: [{ branchId: 'branch-b', accessLevel: 'MANAGE' }],
    },
  ])('does not turn permission or scope failures into administrator grants', async (actor) => {
    const f = fixture();
    await f.service.register(inviteToken, { ...body, role: 'ADMIN' });
    await expect(f.service.approve(requestId, { role: 'ADMIN' }, actor)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    expect(f.enrollments.get(requestId)?.status).toBe('PENDING');
  });

  it('honors the decision and link compare-and-set without losing the reviewer or issuing grants', async () => {
    const f = fixture();
    await f.service.register(inviteToken, { ...body, role: 'ADMIN' });
    f.prisma.mobilePosEnrollment.updateMany.mockResolvedValueOnce({ count: 0 });
    await expect(f.service.approve(requestId, { role: 'ADMIN' }, manager)).rejects.toBeInstanceOf(
      ConflictException,
    );
    expect(f.enrollments.get(requestId)?.status).toBe('PENDING');
    await f.service.approve(requestId, { role: 'ADMIN' }, manager);
    f.prisma.mobilePosEnrollment.updateMany.mockResolvedValueOnce({ count: 0 });
    await expect(f.service.adminLink(requestId, claimToken, manager)).rejects.toBeInstanceOf(
      ConflictException,
    );
    expect(f.enrollments.get(requestId)).toMatchObject({ userId: null, approvedById: manager.id });
    expect(f.prisma.user.create).not.toHaveBeenCalled();
  });

  it('announces rejection without copying decision text or claim secrets into the notification', async () => {
    const f = fixture();
    await f.service.register(inviteToken, body);
    await f.service.reject(requestId, `Do not copy secret ${claimToken}`, manager);
    const updates = [...f.inbox.values()].filter((n) => n.notificationType === 'APPROVAL_REJECTED');
    expect(updates).toHaveLength(6);
    expect(JSON.stringify(updates)).not.toContain(claimToken);
    expect(f.enrollments.get(requestId)?.status).toBe('REJECTED');
  });
});
