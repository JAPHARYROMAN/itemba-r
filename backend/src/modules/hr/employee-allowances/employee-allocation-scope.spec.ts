import { NotFoundException } from '@nestjs/common';
import { EmployeeAllowancesService } from './employee-allowances.service';
import { EmployeeDeductionsService } from '../employee-deductions/employee-deductions.service';
import { PrismaService } from '../../../prisma/prisma.service';
import { AuditLogsService } from '../../audit-logs/audit-logs.service';
import type { AuthUser } from '../../../common/decorators/current-user.decorator';

type Where = {
  AND?: Where[];
  id?: string | { in: string[] };
  companyId?: string | { in: string[] };
  deletedAt?: null;
};
const records = [
  { id: 'own', companyId: 'home', deletedAt: null },
  { id: 'shared', companyId: 'second', deletedAt: null },
  { id: 'foreign', companyId: 'outside', deletedAt: null },
  { id: 'deleted', companyId: 'home', deletedAt: new Date() },
];
function matches(row: (typeof records)[number], where: Where): boolean {
  return (
    (!where.AND || where.AND.every((clause) => matches(row, clause))) &&
    (where.deletedAt === undefined || row.deletedAt === where.deletedAt) &&
    (['id', 'companyId'] as const).every((key) => {
      const filter = where[key];
      return (
        filter === undefined ||
        (typeof filter === 'string' ? row[key] === filter : filter.in.includes(row[key]))
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

describe.each([
  ['allowance', EmployeeAllowancesService],
  ['deduction', EmployeeDeductionsService],
] as const)('Employee %s detail scope', (_name, Service) => {
  function setup() {
    const findFirst = jest.fn(
      async ({ where }: { where: Where }) => records.find((row) => matches(row, where)) ?? null,
    );
    const prisma = { employeeAllowance: { findFirst }, employeeDeduction: { findFirst } };
    const service = new Service(prisma as unknown as PrismaService, {} as AuditLogsService);
    return { service, findFirst };
  }
  it('reads a home-company record and an explicitly granted second company', async () => {
    const { service } = setup();
    await expect(service.findOne('own', principal)).resolves.toMatchObject({ id: 'own' });
    await expect(service.findOne('shared', principal)).resolves.toMatchObject({ id: 'shared' });
  });
  it('does not reveal another company or a deleted record', async () => {
    const { service } = setup();
    await expect(service.findOne('foreign', principal)).rejects.toThrow(NotFoundException);
    await expect(service.findOne('deleted', principal)).rejects.toThrow(NotFoundException);
  });
  it('keeps the requested ID and fails closed when there are no company grants', async () => {
    const { service, findFirst } = setup();
    await expect(
      service.findOne('own', { ...principal, companyId: null, companyAccess: [] }),
    ).rejects.toThrow(NotFoundException);
    expect(findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { AND: [{ id: 'own', deletedAt: null }, { id: { in: [] } }] },
      }),
    );
  });
  it('uses the same explicit-grant scope for group principals', async () => {
    const { service } = setup();
    const group = { ...principal, roleScopes: ['GROUP'], companyId: null };
    await expect(service.findOne('shared', group)).resolves.toMatchObject({ id: 'shared' });
    await expect(service.findOne('foreign', group)).rejects.toThrow(NotFoundException);
  });
});
