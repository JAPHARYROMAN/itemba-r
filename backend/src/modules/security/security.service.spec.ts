import { ForbiddenException } from '@nestjs/common';
import { AuthUser } from '../../common/decorators/current-user.decorator';
import { SecurityService } from './security.service';

const GROUP_USER: AuthUser = {
  id: 'group-user',
  email: 'group-user@itemba.invalid',
  roles: ['group-reader'],
  roleScopes: ['GROUP'],
  permissions: ['security.dashboard.view'],
  companyId: 'company-1',
};

const COMPANY_USER: AuthUser = {
  ...GROUP_USER,
  id: 'company-user',
  email: 'company-user@itemba.invalid',
  roles: ['company-reader'],
  roleScopes: ['COMPANY'],
};

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
    queryMocks: [
      prisma.securityEvent.groupBy,
      prisma.securityEvent.findMany,
      prisma.securityEvent.count,
      prisma.activeSession.count,
      prisma.user.count,
      prisma.userSecurityProfile.groupBy,
      prisma.userSecurityProfile.count,
      prisma.refreshToken.count,
      prisma.role.count,
      prisma.permission.count,
    ],
  };
}

describe('SecurityService readiness', () => {
  it('returns production-ready auth, session, and access readiness when controls are healthy', async () => {
    const { service } = makeService();

    const readiness = await service.getReadiness(GROUP_USER);

    expect(readiness.score).toBeGreaterThanOrEqual(90);
    expect(readiness.status).toBe('READY');
    expect(readiness.target).toBe(90);
    expect(readiness.checks).toHaveLength(5);
  });

  it('marks users without roles as a critical access-control blocker', async () => {
    const { service } = makeService({ activeUsersWithoutRoles: 2 });

    const readiness = await service.getReadiness(GROUP_USER);

    expect(readiness.status).toBe('CRITICAL');
    expect(readiness.checks.find((check) => check.key === 'rbac-scope-coverage')?.status).toBe(
      'CRITICAL',
    );
  });

  it('includes readiness on the security dashboard response', async () => {
    const { service } = makeService();

    const dashboard = await service.getDashboard(GROUP_USER);

    expect(dashboard.activeSessionsCount).toBe(3);
    expect(dashboard.twoFactorAdoptionRate).toBe(80);
    expect(dashboard.readiness.score).toBeGreaterThanOrEqual(90);
  });

  it.each(['getDashboard', 'getSummary', 'getReadiness'] as const)(
    'denies a company principal before any query in %s',
    async (method) => {
      const { service, queryMocks, config } = makeService();

      await expect(service[method](COMPANY_USER)).rejects.toBeInstanceOf(ForbiddenException);

      for (const query of queryMocks) expect(query).not.toHaveBeenCalled();
      expect(config.get).not.toHaveBeenCalled();
    },
  );
});
