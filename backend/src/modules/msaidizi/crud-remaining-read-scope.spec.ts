import { ForbiddenException } from '@nestjs/common';
import { AccessLevel } from '@prisma/client';
import { AuthUser } from '../../common/decorators/current-user.decorator';
import { DataIsolationService } from '../data-isolation/data-isolation.service';
import { DepartmentsService } from '../hr/departments/departments.service';
import { EmployeesService } from '../hr/employees/employees.service';
import { PositionsService } from '../hr/positions/positions.service';

const companyUser = (companyId: string): AuthUser =>
  ({
    id: 'user-a',
    email: 'user-a@itemba.invalid',
    fullName: 'Company A Reader',
    companyId,
    roleScopes: ['COMPANY'],
    permissions: ['departments.view', 'employees.view', 'positions.view'],
    companyAccess: [{ companyId, accessLevel: AccessLevel.READ }],
  }) as AuthUser;

describe('remaining read scope enforcement', () => {
  it('denies foreign-company HR code previews before reading code source state', async () => {
    const prisma = {
      company: { findUnique: jest.fn() },
      department: { findMany: jest.fn() },
      employee: { count: jest.fn() },
      position: { findMany: jest.fn() },
    };
    const audit = {};
    const user = companyUser('company-a');
    const departments = new DepartmentsService(prisma as never, audit as never);
    const employees = new EmployeesService(prisma as never, audit as never);
    const positions = new PositionsService(prisma as never, audit as never);

    await expect(departments.previewNextDepartmentCode('company-b', user)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    await expect(employees.previewNextEmployeeCode('company-b', user)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    await expect(positions.previewNextPositionCode('company-b', user)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    expect(prisma.company.findUnique).not.toHaveBeenCalled();
    expect(prisma.department.findMany).not.toHaveBeenCalled();
    expect(prisma.employee.count).not.toHaveBeenCalled();
    expect(prisma.position.findMany).not.toHaveBeenCalled();
  });

  it('keeps the existing next-code algorithms after the scope gate', async () => {
    const prisma = {
      company: {
        findUnique: jest.fn().mockResolvedValue({ code: 'ITEMBA', employeeCodePrefix: 'ITA' }),
        findFirst: jest.fn().mockResolvedValue({ code: 'ITEMBA', employeeCodePrefix: 'ITA' }),
      },
      department: {
        findMany: jest
          .fn()
          .mockResolvedValue([
            { departmentCode: 'ITA-DEPT-001' },
            { departmentCode: 'ITA-DEPT-003' },
          ]),
      },
      employee: { count: jest.fn().mockResolvedValue(8) },
      position: {
        findMany: jest
          .fn()
          .mockResolvedValue([{ positionCode: 'ITA-POS-001' }, { positionCode: 'ITA-POS-003' }]),
      },
    };
    const audit = {};
    const user = companyUser('company-a');

    await expect(
      new DepartmentsService(prisma as never, audit as never).previewNextDepartmentCode(
        'company-a',
        user,
      ),
    ).resolves.toBe('ITA-DEPT-002');
    await expect(
      new EmployeesService(prisma as never, audit as never).previewNextEmployeeCode(
        'company-a',
        user,
      ),
    ).resolves.toBe('ITA-EMP-0009');
    await expect(
      new PositionsService(prisma as never, audit as never).previewNextPositionCode(
        'company-a',
        user,
      ),
    ).resolves.toBe('ITA-POS-002');
  });

  it('requires a group-scoped principal before querying the data-isolation dashboard', async () => {
    const prisma = {
      dataIsolationTestRun: { count: jest.fn(), findMany: jest.fn() },
      dataIsolationTestIssue: { groupBy: jest.fn() },
    };
    const companyScope = {
      assertGroupScoped: jest.fn(() => {
        throw new ForbiddenException('Group scope required');
      }),
    };
    const service = new DataIsolationService(prisma as never, companyScope as never);

    await expect(service.getDashboard(companyUser('company-a'))).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    expect(companyScope.assertGroupScoped).toHaveBeenCalledTimes(1);
    expect(prisma.dataIsolationTestRun.count).not.toHaveBeenCalled();
    expect(prisma.dataIsolationTestRun.findMany).not.toHaveBeenCalled();
    expect(prisma.dataIsolationTestIssue.groupBy).not.toHaveBeenCalled();
  });
});
