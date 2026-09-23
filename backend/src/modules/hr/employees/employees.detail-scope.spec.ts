import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { EmployeesService } from './employees.service';
import { PrismaService } from '../../../prisma/prisma.service';
import { AuditLogsService } from '../../audit-logs/audit-logs.service';
import type { AuthUser } from '../../../common/decorators/current-user.decorator';

type Where = {
  AND?: Where[];
  id?: string | { in: string[] };
  companyId?: string | { in: string[] };
  deletedAt?: null;
};
const employee = {
  fullName: 'Alex Example',
  baseSalary: '150000',
  bankName: 'Example Bank',
  bankAccountNumber: 'TEST',
  bankBranch: 'Town',
  tin: 'TEST-TIN',
  nssfNumber: 'TEST-NSSF',
  nhifNumber: 'TEST-NHIF',
  employmentStatus: 'ACTIVE',
  terminationRequestedAt: new Date('2026-09-19'),
  terminationRequestedById: 'requester',
  pendingTerminationDate: new Date('2026-09-30'),
};
const records = [
  { ...employee, id: 'own', companyId: 'home', deletedAt: null },
  { ...employee, id: 'shared', companyId: 'second', deletedAt: null },
  { ...employee, id: 'foreign', companyId: 'outside', deletedAt: null },
  { ...employee, id: 'deleted', companyId: 'home', deletedAt: new Date() },
];
function matches(
  row: Pick<(typeof records)[number], 'id' | 'companyId' | 'deletedAt'>,
  where: Where,
): boolean {
  return (
    (!where.AND || where.AND.every((clause) => matches(row, clause))) &&
    (where.deletedAt === undefined || row.deletedAt === where.deletedAt) &&
    (['id', 'companyId'] as const).every((field) => {
      const filter = where[field];
      return (
        filter === undefined ||
        (typeof filter === 'string' ? row[field] === filter : filter.in.includes(row[field]))
      );
    })
  );
}
const principal: AuthUser = {
  id: 'operator',
  email: 'operator@example.test',
  roles: [],
  permissions: [],
  companyId: 'home',
  companyAccess: [{ companyId: 'second', accessLevel: 'READ' }],
};
function setup(pending = true) {
  const rows = records.map((row) => ({
    ...row,
    terminationRequestedAt: pending ? row.terminationRequestedAt : null,
  }));
  const findFirst = jest.fn(
    async ({ where }: { where: Where }) => rows.find((row) => matches(row, where)) ?? null,
  );
  const update = jest.fn(async ({ where, data }: { where: { id: string }; data: object }) => ({
    ...rows.find((row) => row.id === where.id),
    ...data,
  }));
  const updateMany = jest.fn(
    async ({
      where,
      data,
    }: {
      where: {
        id: string;
        companyId: string;
        deletedAt: null;
        terminationRequestedAt: Date | null;
        terminationRequestedById?: string;
        employmentStatus: { not: string };
      };
      data: object;
    }) => {
      const row = rows.find(
        (candidate) =>
          candidate.id === where.id &&
          candidate.companyId === where.companyId &&
          candidate.deletedAt === where.deletedAt &&
          candidate.terminationRequestedAt === where.terminationRequestedAt &&
          (where.terminationRequestedById === undefined ||
            candidate.terminationRequestedById === where.terminationRequestedById) &&
          candidate.employmentStatus !== where.employmentStatus.not,
      );
      if (!row) return { count: 0 };
      Object.assign(row, data);
      return { count: 1 };
    },
  );
  const log = jest.fn().mockResolvedValue(undefined);
  const service = new EmployeesService(
    { employee: { findFirst, update, updateMany } } as unknown as PrismaService,
    { log } as unknown as AuditLogsService,
  );
  return { service, findFirst, update, updateMany, log, rows };
}

describe('Employee detail reads and termination company grants', () => {
  it('reads both the home company and an explicitly granted company', async () => {
    const { service } = setup();
    await expect(service.findOne('own', principal)).resolves.toMatchObject({ id: 'own' });
    await expect(service.findOne('shared', principal)).resolves.toMatchObject({ id: 'shared' });
  });
  it.each(['foreign', 'deleted', 'missing'])('does not reveal %s employees', async (id) => {
    await expect(setup().service.findOne(id, principal)).rejects.toThrow(NotFoundException);
  });
  it.each([{ roleScopes: [] }, { roleScopes: ['GROUP'] }])(
    'fails closed with no company grants for scope %j',
    async ({ roleScopes }) => {
      const { service, findFirst } = setup();
      await expect(
        service.findOne('own', { ...principal, companyId: null, companyAccess: [], roleScopes }),
      ).rejects.toThrow(NotFoundException);
      expect(findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { AND: [{ id: 'own', deletedAt: null }, { id: { in: [] } }] },
        }),
      );
    },
  );
  it('keeps group reads within explicit grants', async () => {
    const { service } = setup();
    const group = { ...principal, roleScopes: ['GROUP'], companyId: null };
    await expect(service.findOne('shared', group)).resolves.toMatchObject({ id: 'shared' });
    await expect(service.findOne('foreign', group)).rejects.toThrow(NotFoundException);
  });
  it('removes sensitive values without changing the source record', async () => {
    const record = await setup().service.findOne('own', principal);
    for (const field of [
      'baseSalary',
      'bankName',
      'bankAccountNumber',
      'bankBranch',
      'tin',
      'nssfNumber',
      'nhifNumber',
    ])
      expect(record).not.toHaveProperty(field);
    expect(records[0].bankAccountNumber).toBe('TEST');
  });
  it.each(['employees.sensitive.view', 'payroll.sensitive.view'])(
    'honours %s on an authorised detail read',
    async (permission) => {
      await expect(
        setup().service.findOne('shared', { ...principal, permissions: [permission] }),
      ).resolves.toMatchObject({ bankAccountNumber: 'TEST', baseSalary: '150000' });
    },
  );
  it.each(['request', 'approve'])(
    'rejects a termination %s for a read-only company grant',
    async (action) => {
      const { service, update, updateMany, log } = setup();
      const command =
        action === 'request'
          ? service.requestTermination('shared', { reason: 'Test reason' }, principal)
          : service.approveTermination('shared', principal);
      await expect(command).rejects.toThrow(ForbiddenException);
      expect(update).not.toHaveBeenCalled();
      expect(updateMany).not.toHaveBeenCalled();
      expect(log).not.toHaveBeenCalled();
    },
  );
  it('allows termination requests and approvals with a write grant', async () => {
    const { service, update, updateMany, log } = setup(false);
    const writer: AuthUser = {
      ...principal,
      companyAccess: [{ companyId: 'second', accessLevel: 'WRITE' }],
    };
    await service.requestTermination(
      'shared',
      { reason: 'Test reason', terminationDate: '2026-09-30' },
      writer,
    );
    await service.approveTermination('shared', { ...writer, id: 'other-approver' });
    expect(updateMany).toHaveBeenCalledTimes(2);
    expect(update).not.toHaveBeenCalled();
    expect(updateMany).toHaveBeenLastCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ employmentStatus: 'TERMINATED' }),
      }),
    );
    expect(log).toHaveBeenCalledTimes(2);
  });
  it('still rejects approving your own termination request', async () => {
    const { service, update } = setup();
    await expect(
      service.approveTermination('own', { ...principal, id: 'requester' }),
    ).rejects.toThrow(BadRequestException);
    expect(update).not.toHaveBeenCalled();
  });
  it('does not replace an existing pending request', async () => {
    const { service, updateMany, log } = setup();
    await expect(
      service.requestTermination('own', { reason: 'Replacement' }, principal),
    ).rejects.toThrow(ConflictException);
    expect(updateMany).not.toHaveBeenCalled();
    expect(log).not.toHaveBeenCalled();
  });
  it('keeps only one request when two submissions race', async () => {
    const { service, rows, log } = setup(false);
    const results = await Promise.allSettled([
      service.requestTermination('own', { reason: 'First request' }, principal),
      service.requestTermination(
        'own',
        { reason: 'Second request' },
        { ...principal, id: 'second-requester' },
      ),
    ]);
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    expect(results.find((result) => result.status === 'rejected')).toMatchObject({
      reason: expect.any(ConflictException),
    });
    expect(rows.find((row) => row.id === 'own')?.terminationRequestedById).toBe(principal.id);
    expect(log).toHaveBeenCalledTimes(1);
  });
  it('refuses a request if its employee changes before the conditional write', async () => {
    const { service, updateMany, log } = setup(false);
    updateMany.mockResolvedValueOnce({ count: 0 });
    await expect(service.requestTermination('own', { reason: 'Test' }, principal)).rejects.toThrow(
      ConflictException,
    );
    expect(log).not.toHaveBeenCalled();
  });
  it('allows only one approval when two authorised approvers act together', async () => {
    const { service, rows, log } = setup();
    const results = await Promise.allSettled([
      service.approveTermination('own', principal),
      service.approveTermination('own', { ...principal, id: 'other-approver' }),
    ]);
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    expect(results.find((result) => result.status === 'rejected')).toMatchObject({
      reason: expect.any(ConflictException),
    });
    expect(rows.find((row) => row.id === 'own')?.employmentStatus).toBe('TERMINATED');
    expect(log).toHaveBeenCalledTimes(1);
  });
});
