import { ForbiddenException } from '@nestjs/common';
import { AccessLevel } from '@prisma/client';
import { CompanyScopeService } from '../../common/services/company-scope.service';
import { AuthUser } from '../../common/decorators/current-user.decorator';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { FuelReportingService } from './fuel-reporting.service';

const company = { id: 'mwanjalisi', code: 'MWANJALISI', name: 'Mwanjalisi Oil' };
const division = { id: 'fuel', name: 'Fuel', companyId: company.id, company };
const admin: AuthUser = {
  id: 'group-admin',
  email: 'admin@example.invalid',
  roles: ['GROUP_SUPER_ADMIN'],
  roleScopes: ['GROUP'],
  permissions: ['fuel_reporting.admin', 'fuel_reporting.manage'],
  companyAccess: [],
};

describe('Fuel Reporting pinned company and station access', () => {
  const prisma = {
    company: { findMany: jest.fn() },
    division: { findMany: jest.fn(), findFirst: jest.fn() },
    branch: { findMany: jest.fn() },
    $transaction: jest.fn(),
  };
  let scope: CompanyScopeService;
  let service: FuelReportingService;

  beforeEach(() => {
    jest.resetAllMocks();
    scope = new CompanyScopeService(prisma as unknown as PrismaService);
    service = new FuelReportingService(
      prisma as unknown as PrismaService,
      scope,
      {} as AuditLogsService,
    );
    prisma.company.findMany.mockImplementation(async ({ where }) =>
      where.id.in.includes(company.id) ? [company] : [],
    );
    prisma.division.findMany.mockImplementation(async ({ where }) =>
      where.companyId.in.includes(company.id) ? [division] : [],
    );
    prisma.division.findFirst.mockResolvedValue(division);
    prisma.branch.findMany.mockResolvedValue([]);
  });

  it('lists the explicitly requested company for a group reader without granting station writes', async () => {
    const register = await service.stations(admin, company.id);
    expect(register.companies).toEqual([{ ...company, canManageStations: false }]);
    expect(register.divisions).toEqual([
      {
        id: division.id,
        name: division.name,
        companyId: company.id,
        companyName: company.name,
        companyCode: company.code,
      },
    ]);
    await expect(
      service.createStation(admin, {
        divisionId: division.id,
        code: 'NEW',
        name: 'New station',
        location: '',
      }),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('recognises explicit company write access and primary company management', async () => {
    for (const user of [
      { ...admin, companyAccess: [{ companyId: company.id, accessLevel: AccessLevel.WRITE }] },
      { ...admin, companyId: company.id },
    ]) {
      const data = await service.stations(user, company.id);
      expect(data.companies).toEqual([{ ...company, canManageStations: true }]);
    }
  });

  it('retains company metadata when there is no active division', async () => {
    prisma.division.findMany.mockResolvedValue([]);
    const data = await service.stations(admin, company.id);
    expect(data.companies).toEqual([{ ...company, canManageStations: false }]);
    expect(data.divisions).toEqual([]);
    expect(data.stations).toEqual([]);
  });

  it('does not expand an unfiltered group list to every company', async () => {
    await expect(service.stations(admin)).resolves.toEqual({
      companies: [],
      divisions: [],
      stations: [],
    });
  });

  it('denies an unassigned company-scoped user before querying the directory', async () => {
    const user = { ...admin, roleScopes: ['COMPANY'], companyId: 'another-company' };
    await expect(service.stations(user, company.id)).rejects.toBeInstanceOf(ForbiddenException);
    await expect(service.bootstrap(user, company.id)).rejects.toBeInstanceOf(ForbiddenException);
    expect(prisma.company.findMany).not.toHaveBeenCalled();
    expect(prisma.division.findMany).not.toHaveBeenCalled();
    expect(prisma.branch.findMany).not.toHaveBeenCalled();
  });

  it('preserves branch assignments when bootstrapping a pinned company', async () => {
    const user = {
      ...admin,
      roles: ['BRANCH_MANAGER'],
      roleScopes: ['BRANCH'],
      companyAccess: [{ companyId: company.id, accessLevel: AccessLevel.READ }],
      branchAccess: [{ branchId: 'assigned', accessLevel: AccessLevel.WRITE }],
    };
    await service.bootstrap(user, company.id);
    expect(prisma.branch.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          id: { in: ['assigned'] },
          division: expect.objectContaining({ companyId: { in: [company.id] } }),
        }),
      }),
    );
    await expect(service.stations(user, company.id)).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('propagates a failed permission lookup instead of disguising it as read-only access', async () => {
    jest
      .spyOn(scope, 'assertCanAccessCompany')
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error('Access lookup unavailable'));
    await expect(service.stations(admin, company.id)).rejects.toThrow('Access lookup unavailable');
    expect(prisma.division.findMany).not.toHaveBeenCalled();
  });
});
