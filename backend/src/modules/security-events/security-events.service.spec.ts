import { NotFoundException } from '@nestjs/common';
import { AuthUser } from '../../common/decorators/current-user.decorator';
import { SecurityEventsService } from './security-events.service';

function companyUser(overrides: Partial<AuthUser> = {}): AuthUser {
  return {
    id: 'user-1',
    email: 'officer@itemba.local',
    fullName: 'Security Officer',
    roles: ['COMPANY_MANAGER'],
    roleScopes: ['COMPANY'],
    permissions: ['security_events.view'],
    companyId: 'company-1',
    companyAccess: [],
    ...overrides,
  };
}

function groupUser(overrides: Partial<AuthUser> = {}): AuthUser {
  return {
    id: 'group-admin-1',
    email: 'group-admin@itemba.local',
    fullName: 'Group Super Admin',
    roles: ['GROUP_SUPER_ADMIN'],
    roleScopes: ['GROUP'],
    permissions: ['security_events.view'],
    companyId: 'company-1',
    companyAccess: [{ companyId: 'company-2', accessLevel: 'MANAGE' }],
    ...overrides,
  };
}

function makeHarness() {
  const prisma = {
    securityEvent: {
      findMany: jest.fn().mockResolvedValue([]),
      count: jest.fn().mockResolvedValue(0),
      findFirst: jest.fn().mockResolvedValue(null),
    },
  } as any;
  const auditLogs = { log: jest.fn().mockResolvedValue(undefined) } as any;
  const service = new SecurityEventsService(prisma, auditLogs);
  return { prisma, auditLogs, service };
}

describe('SecurityEventsService company scoping', () => {
  describe('findAll', () => {
    it('scopes a company user to their companies only and does NOT surface companyId:null auth events', async () => {
      const { prisma, service } = makeHarness();
      await service.findAll({}, companyUser());

      const where = prisma.securityEvent.findMany.mock.calls[0][0].where;
      // Regular company scope: no OR widening to null companyId rows.
      expect(where.OR).toBeUndefined();
      expect(where.companyId).toEqual({ in: ['company-1'] });
    });

    it('surfaces group-level (companyId:null) auth events for a group-scoped viewer', async () => {
      const { prisma, service } = makeHarness();
      await service.findAll({ eventType: 'SUSPICIOUS_ACTIVITY' }, groupUser());

      const where = prisma.securityEvent.findMany.mock.calls[0][0].where;
      expect(where.eventType).toBe('SUSPICIOUS_ACTIVITY');
      expect(where.OR).toEqual([
        { companyId: { in: ['company-1', 'company-2'] } },
        { companyId: null },
      ]);
    });

    it('narrows a group viewer to the requested company (no null widening) when companyId is supplied', async () => {
      const { prisma, service } = makeHarness();
      await service.findAll({ companyId: 'company-2' }, groupUser());

      const where = prisma.securityEvent.findMany.mock.calls[0][0].where;
      expect(where.OR).toBeUndefined();
      expect(where.companyId).toBe('company-2');
    });
  });

  describe('findOne', () => {
    it('lets a group viewer drill into a companyId:null auth event', async () => {
      const { prisma, service } = makeHarness();
      prisma.securityEvent.findFirst.mockResolvedValue({ id: 'se-1', companyId: null });

      const record = await service.findOne('se-1', groupUser());

      const where = prisma.securityEvent.findFirst.mock.calls[0][0].where;
      expect(where.id).toBe('se-1');
      expect(where.OR).toEqual([
        { companyId: { in: ['company-1', 'company-2'] } },
        { companyId: null },
      ]);
      expect(record).toEqual({ id: 'se-1', companyId: null });
    });

    it('keeps a company user scoped to their companies on drill-in', async () => {
      const { prisma, service } = makeHarness();
      prisma.securityEvent.findFirst.mockResolvedValue(null);

      await expect(service.findOne('se-1', companyUser())).rejects.toBeInstanceOf(
        NotFoundException,
      );

      const where = prisma.securityEvent.findFirst.mock.calls[0][0].where;
      expect(where.OR).toBeUndefined();
      expect(where.companyId).toEqual({ in: ['company-1'] });
    });
  });
});
