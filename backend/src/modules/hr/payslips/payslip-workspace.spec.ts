import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { PayslipsQueryDto, SalaryPaymentsQueryDto } from '../../../common/dto/resource-query.dto';
import { PayslipsService } from './payslips.service';
import { PayslipsController } from './payslips.controller';
import { SalaryPaymentsService } from '../salary-payments/salary-payments.service';
const user = { id: 'operator', companyId: 'company', roleScopes: ['COMPANY'] };
describe('Payslip and salary payment workspace reads', () => {
  it('keeps whole-run totals while paginating and searching within the user company scope', async () => {
    const entry = {
      findMany: jest.fn().mockResolvedValue([{ id: 'entry' }]),
      count: jest.fn().mockResolvedValue(23),
      aggregate: jest.fn().mockResolvedValue({
        _count: { _all: 40 },
        _sum: { grossPay: '40000', totalDeductions: '4000', netPay: '36000' },
      }),
    };
    const run = { findFirst: jest.fn().mockResolvedValue({ id: 'run', payrollRunNumber: 'PR-1' }) };
    const service = new PayslipsService({ payrollEntry: entry, payrollRun: run } as never);
    const query = plainToInstance(PayslipsQueryDto, { page: '2', limit: '20', search: ' Alex ' });
    expect(await validate(query, { whitelist: true, forbidNonWhitelisted: true })).toHaveLength(0);
    const result = await service.getWorkspace('run', user as never, query);
    expect(run.findFirst.mock.calls[0][0].where).toEqual({
      id: 'run',
      deletedAt: null,
      companyId: { in: ['company'] },
    });
    const args = entry.findMany.mock.calls[0][0];
    expect(args).toMatchObject({
      skip: 20,
      take: 20,
      where: {
        AND: [
          { payrollRunId: 'run', deletedAt: null, companyId: { in: ['company'] } },
          {
            OR: [
              { employee: { fullName: { contains: 'Alex', mode: 'insensitive' } } },
              { employee: { employeeCode: { contains: 'Alex', mode: 'insensitive' } } },
            ],
          },
        ],
      },
    });
    expect(entry.count).toHaveBeenCalledWith({ where: args.where });
    expect(entry.aggregate.mock.calls[0][0].where).toEqual(args.where.AND[0]);
    expect(result).toMatchObject({
      total: 23,
      page: 2,
      totals: { employees: 40, gross: 40000, deductions: 4000, net: 36000 },
    });
  });
  it('rejects an unavailable run before querying entries or totals', async () => {
    const findMany = jest.fn(),
      aggregate = jest.fn();
    const service = new PayslipsService({
      payrollRun: { findFirst: jest.fn().mockResolvedValue(null) },
      payrollEntry: { findMany, aggregate },
    } as never);
    await expect(service.getWorkspace('foreign', user as never, {})).rejects.toThrow(
      'Payroll run not found',
    );
    expect(findMany).not.toHaveBeenCalled();
    expect(aggregate).not.toHaveBeenCalled();
  });
  it('preserves the legacy array endpoint when pagination is omitted', async () => {
    const getPayslipsForRun = jest.fn().mockResolvedValue([]),
      getWorkspace = jest.fn().mockResolvedValue({ data: [] });
    const controller = new PayslipsController({ getPayslipsForRun, getWorkspace } as never);
    await controller.getForRun('run', user as never, {});
    expect(getPayslipsForRun).toHaveBeenCalledWith('run', user);
    await controller.getForRun('run', user as never, { page: 1 });
    expect(getWorkspace).toHaveBeenCalledWith('run', user, { page: 1 });
  });
  it('adds payment search without replacing company/status/employee constraints', async () => {
    const delegate = {
      findMany: jest.fn().mockResolvedValue([]),
      count: jest.fn().mockResolvedValue(0),
    };
    const companyWhereFor = jest
      .fn()
      .mockResolvedValue({ companyId: { in: ['company'] }, AND: { id: { not: 'excluded' } } });
    const service = new SalaryPaymentsService(
      { salaryPayment: delegate } as never,
      {} as never,
      { companyWhereFor } as never,
      {} as never,
    );
    const query = plainToInstance(SalaryPaymentsQueryDto, {
      page: 3,
      limit: 20,
      search: ' Ref ',
      companyId: 'company',
      employeeId: 'person',
      status: 'PAID',
    });
    expect(await validate(query, { whitelist: true, forbidNonWhitelisted: true })).toHaveLength(0);
    await service.findAll(user as never, query);
    const args = delegate.findMany.mock.calls[0][0];
    expect(args).toMatchObject({
      skip: 40,
      take: 20,
      where: {
        companyId: { in: ['company'] },
        deletedAt: null,
        employeeId: 'person',
        status: 'PAID',
      },
    });
    expect(args.where.AND[0]).toEqual({ id: { not: 'excluded' } });
    expect(args.where.AND[1].OR).toHaveLength(4);
    expect(args.where.AND[1].OR[1]).toEqual({
      reference: { contains: 'Ref', mode: 'insensitive' },
    });
    expect(delegate.count).toHaveBeenCalledWith({ where: args.where });
    companyWhereFor.mockRejectedValueOnce(new Error('No access'));
    await expect(service.findAll(user as never, query)).rejects.toThrow('No access');
    expect(delegate.findMany).toHaveBeenCalledTimes(1);
  });
});
