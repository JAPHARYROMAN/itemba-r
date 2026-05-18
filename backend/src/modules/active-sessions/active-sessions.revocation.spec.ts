import { ActiveSessionsService } from './active-sessions.service';
import { AuthUser } from '../../common/decorators/current-user.decorator';

/**
 * P1-01 regression — ActiveSessionsService.revoke() is authoritative.
 *
 * The Phase 3 contract: revoke flips the session row to REVOKED, revokes
 * any unrevoked refresh tokens issued at-or-after the session's start, and
 * invalidates the user's permission cache cluster-wide.
 *
 * These tests assert each of those three side effects fires and that the
 * audit log captures the transition.
 */

describe('ActiveSessionsService.revoke (P1-01 regression)', () => {
  const actor: AuthUser = {
    id: 'admin-1',
    email: 'admin@itemba.local',
    roles: ['Group Admin'],
    roleScopes: ['GROUP'],
    permissions: ['active_sessions.revoke'],
    companyId: null,
    companyAccess: [],
  };

  function makeHarness() {
    const findFirstSession = jest.fn();
    const updateInTx = jest.fn();
    const refreshTokenUpdateMany = jest.fn();

    const prisma = {
      activeSession: {
        findFirst: findFirstSession,
        update: jest.fn(),
      },
      refreshToken: {
        updateMany: jest.fn(),
      },
      $transaction: jest.fn(async (cb: any) => {
        // Provide a transactional client whose calls capture into closures so
        // tests can assert on them.
        return cb({
          activeSession: { update: updateInTx },
          refreshToken: { updateMany: refreshTokenUpdateMany },
        });
      }),
    } as any;

    const auditLogs = { log: jest.fn().mockResolvedValue(undefined) } as any;
    const companyScope = {
      assertCanAccessCompany: jest.fn().mockResolvedValue(undefined),
      companyWhereFor: jest.fn().mockResolvedValue({}),
      accessibleCompanyIds: jest.fn().mockResolvedValue([]),
      isGroupScoped: jest.fn().mockReturnValue(true),
    } as any;
    const permissionCache = {
      invalidate: jest.fn().mockResolvedValue(undefined),
      get: jest.fn(),
      set: jest.fn(),
      invalidateAll: jest.fn(),
    } as any;

    const service = new ActiveSessionsService(prisma, auditLogs, companyScope, permissionCache);
    return { service, prisma, auditLogs, permissionCache, updateInTx, refreshTokenUpdateMany };
  }

  it('flips the session row to REVOKED inside a transaction', async () => {
    const harness = makeHarness();
    const sessionStart = new Date('2026-05-01T08:00:00Z');
    harness.prisma.activeSession.findFirst.mockResolvedValue({
      id: 'sess-1',
      userId: 'user-1',
      startedAt: sessionStart,
      status: 'ACTIVE',
    });
    harness.updateInTx.mockResolvedValue({
      id: 'sess-1',
      status: 'REVOKED',
      revokedAt: new Date(),
    });

    await harness.service.revoke('sess-1', { revokeReason: 'manual revoke' }, actor);

    expect(harness.updateInTx).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'sess-1' },
        data: expect.objectContaining({
          status: 'REVOKED',
          revokeReason: 'manual revoke',
        }),
      }),
    );
  });

  it('revokes refresh tokens issued at-or-after the session start', async () => {
    const harness = makeHarness();
    const sessionStart = new Date('2026-05-01T08:00:00Z');
    harness.prisma.activeSession.findFirst.mockResolvedValue({
      id: 'sess-1',
      userId: 'user-9',
      startedAt: sessionStart,
      status: 'ACTIVE',
    });
    harness.updateInTx.mockResolvedValue({});

    await harness.service.revoke('sess-1', {}, actor);

    expect(harness.refreshTokenUpdateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          userId: 'user-9',
          revokedAt: null,
          createdAt: { gte: sessionStart },
        }),
        data: expect.objectContaining({
          revokedReason: 'SESSION_REVOKED',
        }),
      }),
    );
  });

  it('invalidates the affected user in the permission cache', async () => {
    const harness = makeHarness();
    harness.prisma.activeSession.findFirst.mockResolvedValue({
      id: 'sess-1',
      userId: 'user-77',
      startedAt: new Date(),
      status: 'ACTIVE',
    });
    harness.updateInTx.mockResolvedValue({});

    await harness.service.revoke('sess-1', {}, actor);

    expect(harness.permissionCache.invalidate).toHaveBeenCalledWith('user-77');
  });

  it('writes a SESSION_REVOKED audit log with the actor and the diff', async () => {
    const harness = makeHarness();
    const before = {
      id: 'sess-1',
      userId: 'user-1',
      startedAt: new Date(),
      status: 'ACTIVE',
    };
    harness.prisma.activeSession.findFirst.mockResolvedValue(before);
    const after = { id: 'sess-1', status: 'REVOKED', revokedAt: new Date() };
    harness.updateInTx.mockResolvedValue(after);

    await harness.service.revoke('sess-1', {}, { ...actor, id: 'admin-42' });

    expect(harness.auditLogs.log).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'SESSION_REVOKED',
        entityType: 'ActiveSession',
        entityId: 'sess-1',
        userId: 'admin-42',
        oldValue: before,
        newValue: after,
      }),
    );
  });
});
