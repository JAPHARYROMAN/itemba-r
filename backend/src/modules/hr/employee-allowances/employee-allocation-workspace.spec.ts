import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import {
  EmployeeAllowanceQueryDto,
  EmployeeDeductionQueryDto,
} from '../../../common/dto/resource-query.dto';
import { EmployeeAllowancesService } from './employee-allowances.service';
import { EmployeeDeductionsService } from '../employee-deductions/employee-deductions.service';
import { UpdateEmployeeAllowanceDto } from './dto/update-employee-allowance.dto';
import { UpdateEmployeeDeductionDto } from '../employee-deductions/dto/update-employee-deduction.dto';
const user = { id: 'operator', companyId: 'company', roleScopes: ['COMPANY'], companyAccess: [] };
describe.each(['allowance', 'deduction'])('Employee %s workspace', (kind) => {
  function setup() {
    const delegate = {
      findMany: jest.fn().mockResolvedValue([]),
      count: jest.fn().mockResolvedValue(0),
      findFirst: jest.fn().mockResolvedValue({ id: 'allocation', companyId: 'company' }),
      update: jest.fn().mockResolvedValue({ id: 'allocation' }),
    };
    const prisma = { [kind === 'allowance' ? 'employeeAllowance' : 'employeeDeduction']: delegate },
      audit = { log: jest.fn().mockResolvedValue(undefined) };
    const service =
      kind === 'allowance'
        ? new EmployeeAllowancesService(prisma as never, audit as never)
        : new EmployeeDeductionsService(prisma as never, audit as never);
    return { service, delegate };
  }
  it('searches employee and type fields without replacing company/type/status/employee constraints', async () => {
    const { service, delegate } = setup();
    const input = {
      page: '2',
      limit: '20',
      companyId: 'company',
      employeeId: 'employee',
      [kind + 'TypeId']: 'type',
      status: 'INACTIVE',
      search: ' Alex ',
    };
    const query =
      kind === 'allowance'
        ? plainToInstance(EmployeeAllowanceQueryDto, input)
        : plainToInstance(EmployeeDeductionQueryDto, input);
    expect(await validate(query, { whitelist: true, forbidNonWhitelisted: true })).toHaveLength(0);
    await service.findAll(user, query);
    const args = delegate.findMany.mock.calls[0][0];
    expect(args).toMatchObject({
      skip: 20,
      take: 20,
      where: {
        deletedAt: null,
        companyId: 'company',
        employeeId: 'employee',
        status: 'INACTIVE',
        [kind + 'TypeId']: 'type',
      },
    });
    expect(args.where.AND[0].OR).toEqual([
      { employee: { fullName: { contains: 'Alex', mode: 'insensitive' } } },
      { employee: { employeeCode: { contains: 'Alex', mode: 'insensitive' } } },
      { [kind + 'Type']: { name: { contains: 'Alex', mode: 'insensitive' } } },
      { [kind + 'Type']: { code: { contains: 'Alex', mode: 'insensitive' } } },
    ]);
    expect(delegate.count).toHaveBeenCalledWith({ where: args.where });
    await expect(service.findAll(user, { companyId: 'foreign', search: 'Alex' })).rejects.toThrow();
    expect(delegate.findMany).toHaveBeenCalledTimes(1);
  });
  it('clears an end date with null and leaves omitted dates untouched', async () => {
    const { service, delegate } = setup();
    const input = {
      effectiveTo: null,
      notes: null,
      ...(kind === 'deduction' ? { amount: null, percentage: null } : {}),
    };
    const dto =
      kind === 'allowance'
        ? plainToInstance(UpdateEmployeeAllowanceDto, input)
        : plainToInstance(UpdateEmployeeDeductionDto, input);
    expect(await validate(dto, { whitelist: true, forbidNonWhitelisted: true })).toHaveLength(0);
    await service.update('allocation', dto, user);
    expect(delegate.update).toHaveBeenLastCalledWith({
      where: { id: 'allocation' },
      data: { ...input, effectiveFrom: undefined },
    });
    await service.update('allocation', { status: 'INACTIVE' }, user);
    expect(delegate.update).toHaveBeenLastCalledWith({
      where: { id: 'allocation' },
      data: { status: 'INACTIVE', effectiveFrom: undefined, effectiveTo: undefined },
    });
  });
  it('converts supplied dates and rejects malformed dates at the DTO boundary', async () => {
    const { service, delegate } = setup();
    await service.update('allocation', { effectiveTo: '2026-10-31' }, user);
    expect(delegate.update.mock.calls[0][0].data.effectiveTo).toEqual(new Date('2026-10-31'));
    const dto =
      kind === 'allowance'
        ? plainToInstance(UpdateEmployeeAllowanceDto, { effectiveTo: 'not-a-date' })
        : plainToInstance(UpdateEmployeeDeductionDto, { effectiveTo: 'not-a-date' });
    expect(await validate(dto)).not.toHaveLength(0);
  });
});
