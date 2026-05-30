import { SecurityService } from './security.service';

function makeService(
  overrides: { activeUsersWithoutRoles?: number; refreshExpiresIn?: string } = {},
) {
  const prisma = {
    securityEvent: {
      groupBy: jest.fn().mockResolvedValue([{ severity: 'LOW', _count: { id: 5 } }]),
      findMany: jest.fn().mockResolvedValue([]),
      count: jest.fn().mockImplementation(async ({ where }: any) => {
        if (where?.eventType === 'SUSPICIOUS_ACTIVITY') return 0;
        if (where?.status === 'OPEN') return 0;
        return 0;
      }),
    },
    activeSession: {
      count: jest.fn().mockImplementation(async ({ where }: any) => {
        if (where?.status === 'REVOKED') return 1;
        if (where?.expiresAt) return 0;
        return 3;
      }),
    },
    user: {
      count: jest.fn().mockImplementation(async ({ where }: any) => {
        if (where?.userRoles?.none) return overrides.activeUsersWithoutRoles ?? 0;
        if (where?.companyId === null) return 0;
        if (where?.lockedUntil) return 0;
        return 5;
      }),
    },
    userSecurityProfile: {
      groupBy: jest.fn().mockResolvedValue([
        { twoFactorEnabled: true, _count: { id: 4 } },
        { twoFactorEnabled: false, _count: { id: 1 } },
      ]),
      count: jest.fn().mockImplementation(async ({ where }: any = {}) => {
        if (where?.twoFactorEnabled === true) return 4;
        if (where?.forceTwoFactorSetup === true) return 1;
        return 5;
      }),
    },
    refreshToken: { count: jest.fn().mockResolvedValue(0) },
    role: {
      count: jest
        .fn()
        .mockImplementation(async ({ where }: any = {}) => (where?.rolePermissions?.none ? 0 : 6)),
    },
    permission: { count: jest.fn().mockResolvedValue(120) },
  } as any;

  const config = {
    get: jest.fn((key: string, fallback?: string) => {
      const values: Record<string, string> = {
        JWT_REFRESH_EXPIRES_IN: overrides.refreshExpiresIn ?? 'never',
        JWT_ACCESS_EXPIRES_IN: '15m',
        JWT_REFRESH_SECRET: 'refresh-secret',
        JWT_ACCESS_SECRET: 'access-secret',
      };
      return values[key] ?? fallback;
    }),
  } as any;

  return {
    service: new SecurityService(prisma, {} as any, config),
    prisma,
    config,
  };
}

describe('SecurityService readiness', () => {
  it('returns production-ready auth, session, and access readiness when controls are healthy', async () => {
    const { service } = makeService();

    const readiness = await service.getReadiness();

    expect(readiness.score).toBeGreaterThanOrEqual(90);
    expect(readiness.status).toBe('READY');
    expect(readiness.target).toBe(90);
    expect(readiness.checks).toHaveLength(5);
  });

  it('marks users without roles as a critical access-control blocker', async () => {
    const { service } = makeService({ activeUsersWithoutRoles: 2 });

    const readiness = await service.getReadiness();

    expect(readiness.status).toBe('CRITICAL');
    expect(readiness.checks.find((check) => check.key === 'rbac-scope-coverage')?.status).toBe(
      'CRITICAL',
    );
  });

  it('includes readiness on the security dashboard response', async () => {
    const { service } = makeService();

    const dashboard = await service.getDashboard();

    expect(dashboard.activeSessionsCount).toBe(3);
    expect(dashboard.twoFactorAdoptionRate).toBe(80);
    expect(dashboard.readiness.score).toBeGreaterThanOrEqual(90);
  });
});
