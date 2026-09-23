import { FuelReportingService } from './fuel-reporting.service';
import { AuthUser } from '../../common/decorators/current-user.decorator';
import { PrismaService } from '../../prisma/prisma.service';
import { CompanyScopeService } from '../../common/services';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { CreateReportingPumpDto } from './fuel-reporting.dto';
import { ALL_PERMISSIONS, ROLES } from '../../../../database/seeds/permission-matrix';

const branchId = 'a0663e36-0c71-4a29-bdb6-889c4e000001';
const manager: AuthUser = {
  id: 'manager',
  email: 'manager@test.local',
  roles: ['BRANCH_MANAGER'],
  roleScopes: ['BRANCH'],
  permissions: ['fuel_reporting.read', 'fuel_reporting.manage'],
  branchAccess: [{ branchId, accessLevel: 'WRITE' }],
};
describe('Fuel reporting access boundaries', () => {
  const prisma = { branch: { findFirst: jest.fn() }, fuelReport: { findMany: jest.fn() } };
  const scope = { assertCanAccessCompany: jest.fn() };
  const service = new FuelReportingService(
    prisma as unknown as PrismaService,
    scope as unknown as CompanyScopeService,
    {} as AuditLogsService,
  );
  beforeEach(() => {
    jest.clearAllMocks();
    prisma.branch.findFirst.mockResolvedValue({
      id: branchId,
      division: { companyId: 'company', company: {} },
    });
    prisma.fuelReport.findMany.mockResolvedValue([]);
  });
  it('rejects pump mutations from a manager even if accidentally granted admin permission', async () => {
    await expect(
      service.createPump(
        { ...manager, permissions: [...manager.permissions, 'fuel_reporting.admin'] },
        {} as CreateReportingPumpDto,
      ),
    ).rejects.toThrow(/Only an admin/);
    await expect(service.deactivatePump(manager, 'pump')).rejects.toThrow(/Only an admin/);
    expect(prisma.branch.findFirst).not.toHaveBeenCalled();
  });
  it('requires an explicit branch grant, even with company-wide membership', async () => {
    await expect(
      service.history({ ...manager, companyId: 'company', branchAccess: [] }, branchId),
    ).rejects.toThrow(/not assigned/);
    await expect(service.history(manager, branchId)).resolves.toEqual([]);
  });
  it('rejects all station administration from a manager with an accidental admin grant', async () => {
    const mistaken = { ...manager, permissions: [...manager.permissions, 'fuel_reporting.admin'] };
    await expect(service.stations(mistaken)).rejects.toThrow(/Only an admin/);
    await expect(
      service.createStation(mistaken, {
        divisionId: branchId,
        code: 'NEW',
        name: 'New station',
        location: '',
      }),
    ).rejects.toThrow(/Only an admin/);
    await expect(
      service.updateStation(mistaken, branchId, { code: 'NEW', name: 'New station', location: '' }),
    ).rejects.toThrow(/Only an admin/);
    await expect(service.setStationActive(mistaken, branchId, false)).rejects.toThrow(
      /Only an admin/,
    );
    await expect(service.setStationActive(mistaken, branchId, true)).rejects.toThrow(
      /Only an admin/,
    );
    expect(prisma.branch.findFirst).not.toHaveBeenCalled();
  });
  it('rejects absent branch selectors rather than broadening a Prisma query', async () => {
    await expect(service.history(manager, undefined as unknown as string)).rejects.toThrow(
      /valid branch/,
    );
    expect(prisma.branch.findFirst).not.toHaveBeenCalled();
  });
  it('seeds reporting only for managers/reviewers and reserves setup for admin', () => {
    const grants = (role: string) =>
      ALL_PERMISSIONS.filter(
        (p) => p.module === 'fuel_reporting' && ROLES.find((r) => r.name === role)!.filter(p),
      ).map((p) => p.action);
    expect(grants('BRANCH_MANAGER')).toEqual(['read', 'manage']);
    expect(grants('GROUP_SUPER_ADMIN')).toEqual(['read', 'manage', 'admin']);
    expect(grants('COMPANY_MANAGER')).toEqual(['read']);
    expect(grants('PUMP_ATTENDANT')).toEqual([]);
    expect(grants('STATION_SUPERVISOR')).toEqual([]);
  });
});
