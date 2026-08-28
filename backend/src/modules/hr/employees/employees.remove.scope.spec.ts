import { ForbiddenException } from '@nestjs/common';
import { AccessLevel } from '@prisma/client';
import { AuthUser } from '../../../common/decorators/current-user.decorator';
import { EmployeesService } from './employees.service';

const existing = {
  id: 'employee-1',
  companyId: 'company-1',
  employeeCode: 'EMP-0001',
  fullName: 'Scoped Employee',
  employmentStatus: 'ACTIVE',
  deletedAt: null,
};

function companyWriter(): AuthUser {
  return {
    id: 'user-write',
    email: 'writer@itemba.local',
    roles: ['COMPANY_HR_MANAGER'],
    roleScopes: ['COMPANY'],
    role: { scope: 'COMPANY' },
    permissions: ['employees.delete'],
    companyId: 'company-1',
    companyAccess: [],
  };
}

function groupReader(): AuthUser {
  return {
    id: 'user-read',
    email: 'reader@itemba.local',
    roles: ['GROUP_HR_AUDITOR'],
    roleScopes: ['GROUP'],
    role: { scope: 'GROUP' },
    permissions: ['employees.delete'],
    companyId: null,
    companyAccess: [{ companyId: 'company-1', accessLevel: AccessLevel.READ }],
  };
}

function makeHarness() {
  const count = jest.fn().mockResolvedValue(0);
  const prisma = {
    employee: {
      findFirst: jest.fn().mockResolvedValue(existing),
      update: jest.fn().mockResolvedValue({
        ...existing,
        employmentStatus: 'INACTIVE',
        deletedAt: new Date(),
      }),
    },
    employeeAllowance: { count },
    employeeDeduction: { count: jest.fn().mockResolvedValue(0) },
    leaveRequest: { count: jest.fn().mockResolvedValue(0) },
    salaryAdvance: { count: jest.fn().mockResolvedValue(0) },
    payrollEntry: { count: jest.fn().mockResolvedValue(0) },
  } as any;
  const audit = { log: jest.fn().mockResolvedValue(undefined) } as any;
  return { service: new EmployeesService(prisma, audit), prisma, audit };
}

describe('EmployeesService.remove company write authorization', () => {
  it('soft-deletes with a company-attributed audit row for an authorized writer', async () => {
    const { service, prisma, audit } = makeHarness();

    await expect(service.remove('employee-1', companyWriter())).resolves.toEqual({
      message: 'Employee deleted',
    });

    expect(prisma.employee.update).toHaveBeenCalledWith({
      where: { id: 'employee-1' },
      data: { deletedAt: expect.any(Date), employmentStatus: 'INACTIVE' },
    });
    expect(audit.log).toHaveBeenCalledTimes(1);
    expect(audit.log).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 'user-write',
        action: 'DELETE',
        entityType: 'Employee',
        entityId: 'employee-1',
        companyId: 'company-1',
        oldValue: existing,
      }),
    );
  });

  it('rejects a GROUP user with only READ access before dependency checks or mutation', async () => {
    const { service, prisma, audit } = makeHarness();

    await expect(service.remove('employee-1', groupReader())).rejects.toBeInstanceOf(
      ForbiddenException,
    );

    expect(prisma.employeeAllowance.count).not.toHaveBeenCalled();
    expect(prisma.employee.update).not.toHaveBeenCalled();
    expect(audit.log).not.toHaveBeenCalled();
  });
});
