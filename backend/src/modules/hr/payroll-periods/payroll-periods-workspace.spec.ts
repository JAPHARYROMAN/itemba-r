import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { PayrollPeriodsQueryDto } from '../../../common/dto/resource-query.dto';
import { PayrollPeriodsService } from './payroll-periods.service';
const user = { id: 'operator', companyId: 'company-a', role: { scope: 'COMPANY' } };
describe('Payroll period workspace search', () => {
  it('accepts search and retains company/status, pagination and matching count', async () => {
    const delegate = {
      findMany: jest.fn().mockResolvedValue([]),
      count: jest.fn().mockResolvedValue(0),
    };
    const service = new PayrollPeriodsService(
      { payrollPeriod: delegate } as never,
      {} as never,
      {} as never,
    );
    const query = plainToInstance(PayrollPeriodsQueryDto, {
      page: 2,
      limit: 20,
      companyId: 'company-a',
      status: 'OPEN',
      search: ' September ',
    });
    expect(await validate(query, { whitelist: true, forbidNonWhitelisted: true })).toHaveLength(0);
    await service.findAll(user, query);
    const args = delegate.findMany.mock.calls[0][0];
    expect(args).toMatchObject({
      skip: 20,
      take: 20,
      where: { deletedAt: null, companyId: 'company-a', status: 'OPEN' },
    });
    expect(args.where.AND).toEqual([
      {
        OR: [
          { name: { contains: 'September', mode: 'insensitive' } },
          { payrollPeriodCode: { contains: 'September', mode: 'insensitive' } },
        ],
      },
    ]);
    expect(delegate.count).toHaveBeenCalledWith({ where: args.where });
    await expect(
      service.findAll(user, { companyId: 'foreign', search: 'September' }),
    ).rejects.toThrow();
    expect(delegate.findMany).toHaveBeenCalledTimes(1);
  });
  it('ignores whitespace search and keeps scoped queries constrained', async () => {
    const delegate = {
      findMany: jest.fn().mockResolvedValue([]),
      count: jest.fn().mockResolvedValue(0),
    };
    const service = new PayrollPeriodsService(
      { payrollPeriod: delegate } as never,
      {} as never,
      {} as never,
    );
    await service.findAll(user, { search: '  ' });
    expect(delegate.findMany.mock.calls[0][0].where).toEqual({
      deletedAt: null,
      companyId: { in: ['company-a'] },
    });
  });
});
