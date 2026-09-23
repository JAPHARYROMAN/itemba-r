import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { MobileMoneyProvider } from '@prisma/client';
import { MobileMoneyAccountsService } from './mobile-money-accounts.service';
import { MobileMoneyAccountsController } from './mobile-money-accounts.controller';
import { CompanyScopeService } from '../../../common/services';
import type { PrismaService } from '../../../prisma/prisma.service';
import type { AuditLogsService } from '../../audit-logs/audit-logs.service';
import type { AuthUser } from '../../../common/decorators/current-user.decorator';
import type { CreateMobileMoneyAccountDto } from './dto/create-mobile-money-account.dto';

type EmployeeWhere = {
  AND?: EmployeeWhere[];
  id?: string | { in: string[] };
  companyId?: string | { in: string[] };
  deletedAt?: null;
};
const employees = [
  { id: 'own', companyId: 'home', deletedAt: null },
  { id: 'shared', companyId: 'second', deletedAt: null },
  { id: 'foreign', companyId: 'outside', deletedAt: null },
  { id: 'removed', companyId: 'home', deletedAt: new Date() },
];
const accounts = employees
  .map((employee) => ({
    id: employee.id + '-account',
    employeeId: employee.id,
    provider: 'M_PESA',
    msisdn: '+255712345678',
    isPrimary: false,
    status: 'ACTIVE',
    deletedAt: null as Date | null,
  }))
  .concat({
    id: 'deleted-account',
    employeeId: 'own',
    provider: 'M_PESA',
    msisdn: '+255700000001',
    isPrimary: false,
    status: 'CLOSED',
    deletedAt: new Date(),
  });
function matches(row: (typeof employees)[number], where: EmployeeWhere): boolean {
  return (
    (!where.AND || where.AND.every((clause) => matches(row, clause))) &&
    (where.deletedAt === undefined || row.deletedAt === where.deletedAt) &&
    (['id', 'companyId'] as const).every((key) => {
      const value = where[key];
      return (
        value === undefined ||
        (typeof value === 'string' ? row[key] === value : value.in.includes(row[key]))
      );
    })
  );
}
const actor: AuthUser = {
  id: 'operator',
  email: 'operator@example.test',
  permissions: ['employees.update'],
  roles: [],
  companyId: 'home',
  companyAccess: [{ companyId: 'second', accessLevel: 'READ' }],
};
function setup() {
  const findEmployee = jest.fn(
    async ({ where }: { where: EmployeeWhere }) =>
      employees.find((row) => matches(row, where)) ?? null,
  );
  const findAccount = jest.fn(
    async ({ where }: { where: { id: string; deletedAt: null; employee: EmployeeWhere } }) => {
      const account = accounts.find(
        (row) => row.id === where.id && row.deletedAt === where.deletedAt,
      );
      const employee =
        account &&
        employees.find((row) => row.id === account.employeeId && matches(row, where.employee));
      return account && employee
        ? { ...account, employee: { companyId: employee.companyId } }
        : null;
    },
  );
  const create = jest.fn(async ({ data }: { data: object }) => ({ id: 'created', ...data }));
  const update = jest.fn(async ({ where, data }: { where: { id: string }; data: object }) => ({
    id: where.id,
    ...data,
  }));
  const demote = jest.fn().mockResolvedValue({ count: 1 });
  const findMany = jest.fn().mockResolvedValue([]);
  const tx = { mobileMoneyAccount: { create, update, updateMany: demote } };
  const transaction = jest.fn(async (work: (value: typeof tx) => Promise<unknown>) => work(tx));
  const prisma = {
    employee: { findFirst: findEmployee },
    mobileMoneyAccount: { findFirst: findAccount, findMany, update },
    $transaction: transaction,
  } as unknown as PrismaService;
  const log = jest.fn().mockResolvedValue(undefined);
  const service = new MobileMoneyAccountsService(
    prisma,
    { log } as unknown as AuditLogsService,
    new CompanyScopeService(prisma),
  );
  return { service, create, update, demote, transaction, log, findEmployee, findAccount, findMany };
}
const input: CreateMobileMoneyAccountDto = {
  employeeId: 'own',
  provider: MobileMoneyProvider.M_PESA,
  msisdn: '0712345678',
  isPrimary: true,
};

describe('Mobile account authorisation and scoped draft sources', () => {
  it('normalises an authorised creation and attributes its audit to the employee company', async () => {
    const { service, create, demote, log } = setup();
    const controller = new MobileMoneyAccountsController(service);
    await expect(controller.create(input, actor)).resolves.toMatchObject({
      id: 'created',
      msisdn: '+255712345678',
    });
    expect(create).toHaveBeenCalledTimes(1);
    expect(demote).toHaveBeenCalledWith({
      where: { employeeId: 'own', isPrimary: true, deletedAt: null },
      data: { isPrimary: false },
    });
    expect(log).toHaveBeenCalledWith(
      expect.objectContaining({ userId: actor.id, companyId: 'home', action: 'CREATE' }),
    );
  });
  it.each(['foreign', 'removed', 'missing'])(
    'denies creating an account for %s employees before a transaction',
    async (employeeId) => {
      const { service, transaction, log } = setup();
      await expect(service.create({ ...input, employeeId }, actor)).rejects.toThrow(
        NotFoundException,
      );
      expect(transaction).not.toHaveBeenCalled();
      expect(log).not.toHaveBeenCalled();
    },
  );
  it('requires an employee ID rather than selecting an arbitrary accessible employee', async () => {
    const { service, findEmployee, findMany } = setup();
    await expect(service.findByEmployee('', actor)).rejects.toThrow(BadRequestException);
    expect(findEmployee).not.toHaveBeenCalled();
    expect(findMany).not.toHaveBeenCalled();
  });
  it('allows scoped second-company reads but rejects creation and update with only READ access', async () => {
    const { service, transaction } = setup();
    await expect(service.findOne('shared-account', actor)).resolves.toMatchObject({
      employeeId: 'shared',
    });
    await expect(service.create({ ...input, employeeId: 'shared' }, actor)).rejects.toThrow(
      ForbiddenException,
    );
    await expect(service.update('shared-account', { notes: 'Test' }, actor)).rejects.toThrow(
      ForbiddenException,
    );
    expect(transaction).not.toHaveBeenCalled();
  });
  it('allows an explicit company writer to update and promote the account through the controller', async () => {
    const { service, update, demote, log } = setup();
    const writer: AuthUser = {
      ...actor,
      companyAccess: [{ companyId: 'second', accessLevel: 'WRITE' }],
    };
    await new MobileMoneyAccountsController(service).update(
      'shared-account',
      { msisdn: '0787654321', isPrimary: true },
      writer,
    );
    expect(update).toHaveBeenCalledWith({
      where: { id: 'shared-account' },
      data: { msisdn: '+255787654321', isPrimary: true },
    });
    expect(demote).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ employeeId: 'shared', NOT: { id: 'shared-account' } }),
      }),
    );
    expect(log).toHaveBeenCalledWith(
      expect.objectContaining({ userId: actor.id, companyId: 'second', action: 'UPDATE' }),
    );
  });
  it.each(['foreign-account', 'removed-account', 'deleted-account', 'missing-account'])(
    'cannot edit an unavailable source %s',
    async (id) => {
      const { service, transaction, log } = setup();
      await expect(service.update(id, { notes: 'Test' }, actor)).rejects.toThrow(NotFoundException);
      expect(transaction).not.toHaveBeenCalled();
      expect(log).not.toHaveBeenCalled();
    },
  );
  it('fails closed for missing grants and preserves the requested employee ID', async () => {
    const { service, findEmployee, transaction } = setup();
    const unassigned = { ...actor, companyId: null, companyAccess: [] };
    await expect(service.create(input, unassigned)).rejects.toThrow(NotFoundException);
    await expect(service.findOne('own-account', unassigned)).rejects.toThrow(NotFoundException);
    expect(findEmployee).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { AND: [{ id: 'own', deletedAt: null }, { id: { in: [] } }] },
      }),
    );
    expect(transaction).not.toHaveBeenCalled();
  });
  it('does not grant group readers company-write access', async () => {
    const { service, transaction } = setup();
    const group = { ...actor, companyId: null, roleScopes: ['GROUP'] };
    await expect(service.update('shared-account', { notes: 'Test' }, group)).rejects.toThrow(
      ForbiddenException,
    );
    expect(transaction).not.toHaveBeenCalled();
  });
  it('rejects changing the employee attached to an existing account', async () => {
    const { service, transaction } = setup();
    await expect(service.update('own-account', { employeeId: 'shared' }, actor)).rejects.toThrow(
      BadRequestException,
    );
    expect(transaction).not.toHaveBeenCalled();
  });
});
