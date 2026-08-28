import { ForbiddenException } from '@nestjs/common';
import { AuthUser } from '../../../common/decorators/current-user.decorator';
import { PrismaService } from '../../../prisma/prisma.service';
import { AuditLogsService } from '../../audit-logs/audit-logs.service';
import { EmployeeAssignmentsService } from './employee-assignments.service';

describe('EmployeeAssignmentsService.create company authorization', () => {
  const companyUser: AuthUser = {
    id: 'user-a',
    email: 'user-a@itemba.invalid',
    permissions: ['employees.assignments.manage'],
    roles: ['company-user'],
    companyId: 'company-a',
    companyAccess: [],
    roleScopes: ['COMPANY'],
  };

  it('rejects a foreign-company assignment before opening a transaction or writing audit', async () => {
    const prisma = {
      $transaction: jest.fn(),
      employeeAssignment: { create: jest.fn() },
    };
    const audit = { log: jest.fn() };
    const service = new EmployeeAssignmentsService(
      prisma as unknown as PrismaService,
      audit as unknown as AuditLogsService,
    );

    await expect(
      service.create(
        {
          employeeId: 'employee-b',
          companyId: 'company-b',
          startDate: '2031-01-01T00:00:00.000Z',
          isPrimary: false,
        },
        companyUser,
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);

    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(prisma.employeeAssignment.create).not.toHaveBeenCalled();
    expect(audit.log).not.toHaveBeenCalled();
  });

  it('rejects an inaccessible source employee before creating a transfer assignment', async () => {
    const employeeFindFirst = jest.fn().mockResolvedValue({
      companyId: 'company-b',
      divisionId: null,
    });
    const assignmentCreate = jest.fn();
    const tx = {
      employee: { findFirst: employeeFindFirst },
      employeeAssignment: {
        create: assignmentCreate,
        findFirst: jest.fn(),
        updateMany: jest.fn(),
      },
    };
    const prisma = {
      $transaction: jest.fn(async (callback: (client: typeof tx) => unknown) => callback(tx)),
    };
    const audit = { log: jest.fn() };
    const service = new EmployeeAssignmentsService(
      prisma as unknown as PrismaService,
      audit as unknown as AuditLogsService,
    );

    await expect(
      service.create(
        {
          employeeId: 'employee-b',
          companyId: 'company-a',
          startDate: '2031-01-01T00:00:00.000Z',
          isPrimary: false,
        },
        companyUser,
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);

    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    expect(employeeFindFirst).toHaveBeenCalledWith({
      where: { id: 'employee-b', deletedAt: null },
      select: { companyId: true, divisionId: true },
    });
    expect(assignmentCreate).not.toHaveBeenCalled();
    expect(audit.log).not.toHaveBeenCalled();
  });

  it('creates and strictly audits a same-company assignment in one transaction', async () => {
    const assignment = {
      id: 'assignment-a',
      employeeId: 'employee-a',
      companyId: 'company-a',
      isPrimary: false,
    };
    const tx = {
      employee: {
        findFirst: jest.fn().mockResolvedValue({ companyId: 'company-a', divisionId: null }),
      },
      employeeAssignment: {
        findFirst: jest.fn().mockResolvedValue(null),
        updateMany: jest.fn(),
        create: jest.fn().mockResolvedValue(assignment),
      },
    };
    const prisma = {
      $transaction: jest.fn(async (callback: (client: typeof tx) => unknown) => callback(tx)),
    };
    const audit = {
      log: jest.fn(),
      logStrictInTransaction: jest.fn().mockResolvedValue(undefined),
    };
    const service = new EmployeeAssignmentsService(
      prisma as unknown as PrismaService,
      audit as unknown as AuditLogsService,
    );
    const dto = {
      employeeId: 'employee-a',
      companyId: 'company-a',
      startDate: '2031-01-01T00:00:00.000Z',
      isPrimary: false,
    };

    await expect(service.create(dto, companyUser)).resolves.toEqual(assignment);

    expect(audit.logStrictInTransaction).toHaveBeenCalledWith(
      tx,
      expect.objectContaining({
        action: 'CREATE',
        entityType: 'EmployeeAssignment',
        entityId: 'assignment-a',
        companyId: 'company-a',
      }),
    );
    expect(audit.log).not.toHaveBeenCalled();
  });

  it('fails the create transaction when its mandatory audit append fails', async () => {
    const failure = new Error('audit append unavailable');
    const tx = {
      employee: {
        findFirst: jest.fn().mockResolvedValue({ companyId: 'company-a', divisionId: null }),
      },
      employeeAssignment: {
        findFirst: jest.fn().mockResolvedValue(null),
        updateMany: jest.fn(),
        create: jest.fn().mockResolvedValue({
          id: 'assignment-a',
          employeeId: 'employee-a',
          companyId: 'company-a',
          isPrimary: false,
        }),
      },
    };
    const prisma = {
      $transaction: jest.fn(async (callback: (client: typeof tx) => unknown) => callback(tx)),
    };
    const audit = {
      log: jest.fn(),
      logStrictInTransaction: jest.fn().mockRejectedValue(failure),
    };
    const service = new EmployeeAssignmentsService(
      prisma as unknown as PrismaService,
      audit as unknown as AuditLogsService,
    );

    await expect(
      service.create(
        {
          employeeId: 'employee-a',
          companyId: 'company-a',
          startDate: '2031-01-01T00:00:00.000Z',
          isPrimary: false,
        },
        companyUser,
      ),
    ).rejects.toBe(failure);
  });
});
