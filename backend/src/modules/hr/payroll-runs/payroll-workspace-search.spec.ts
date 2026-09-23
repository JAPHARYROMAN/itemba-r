import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import {
  PayrollRunsQueryDto,
  PayrollEntriesQueryDto,
} from '../../../common/dto/resource-query.dto';
import { PayrollRunsService } from './payroll-runs.service';
import { PayrollEntriesService } from '../payroll-entries/payroll-entries.service';
const user = { id: 'operator', companyId: 'company', roleScopes: ['COMPANY'] };
describe('Payroll workspace search', () => {
  it('preserves scoped run visibility, status, period, pagination and count with run/period search', async () => {
    const delegate = {
      findMany: jest.fn().mockResolvedValue([]),
      count: jest.fn().mockResolvedValue(0),
    };
    const companyWhereFor = jest
      .fn()
      .mockResolvedValue({ companyId: { in: ['company'] }, AND: { status: { not: 'CANCELLED' } } });
    const service = new PayrollRunsService(
      { payrollRun: delegate } as never,
      {} as never,
      {} as never,
      {} as never,
      { companyWhereFor } as never,
      {} as never,
      {} as never,
    );
    const query = plainToInstance(PayrollRunsQueryDto, {
      page: 2,
      limit: 20,
      companyId: 'company',
      status: 'SUBMITTED',
      payrollPeriodId: 'period',
      search: ' Sept ',
    });
    expect(await validate(query, { whitelist: true, forbidNonWhitelisted: true })).toHaveLength(0);
    await service.findAll(user as never, query);
    const args = delegate.findMany.mock.calls[0][0];
    expect(companyWhereFor).toHaveBeenCalledWith(user, 'company');
    expect(args).toMatchObject({
      skip: 20,
      take: 20,
      where: {
        companyId: { in: ['company'] },
        deletedAt: null,
        status: 'SUBMITTED',
        payrollPeriodId: 'period',
      },
    });
    expect(args.where.AND).toEqual([
      { status: { not: 'CANCELLED' } },
      {
        OR: [
          { payrollRunNumber: { contains: 'Sept', mode: 'insensitive' } },
          { payrollPeriod: { name: { contains: 'Sept', mode: 'insensitive' } } },
        ],
      },
    ]);
    expect(delegate.count).toHaveBeenCalledWith({ where: args.where });
    companyWhereFor.mockRejectedValueOnce(new Error('No company access'));
    await expect(
      service.findAll(user as never, { companyId: 'foreign', search: 'Sept' }),
    ).rejects.toThrow('No company access');
    expect(delegate.findMany).toHaveBeenCalledTimes(1);
  });
  it('combines employee and run search with existing entry access constraints and employee filter', async () => {
    const delegate = {
      findMany: jest.fn().mockResolvedValue([]),
      count: jest.fn().mockResolvedValue(0),
    };
    const companyWhereFor = jest.fn().mockResolvedValue({
      companyId: { in: ['company'] },
      AND: [{ employeeId: { not: 'restricted' } }],
    });
    const service = new PayrollEntriesService(
      { payrollEntry: delegate } as never,
      {} as never,
      { companyWhereFor } as never,
    );
    const query = plainToInstance(PayrollEntriesQueryDto, {
      page: 3,
      limit: 20,
      companyId: 'company',
      employeeId: 'employee',
      payrollRunId: 'run',
      search: ' Alex ',
    });
    expect(await validate(query, { whitelist: true, forbidNonWhitelisted: true })).toHaveLength(0);
    await service.findAll(user as never, query);
    const args = delegate.findMany.mock.calls[0][0];
    expect(args).toMatchObject({
      skip: 40,
      take: 20,
      where: {
        deletedAt: null,
        companyId: { in: ['company'] },
        employeeId: 'employee',
        payrollRunId: 'run',
      },
    });
    expect(args.where.AND[0]).toEqual({ employeeId: { not: 'restricted' } });
    expect(args.where.AND[1].OR).toEqual([
      { employee: { fullName: { contains: 'Alex', mode: 'insensitive' } } },
      { employee: { employeeCode: { contains: 'Alex', mode: 'insensitive' } } },
      { payrollRun: { payrollRunNumber: { contains: 'Alex', mode: 'insensitive' } } },
    ]);
    expect(delegate.count).toHaveBeenCalledWith({ where: args.where });
  });
});
