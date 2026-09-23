import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { LeaveRequestsService } from './leave-requests.service';
import { LeaveBalancesService } from '../leave-balances/leave-balances.service';
import { LeaveTypesService } from '../leave-types/leave-types.service';
import { UpdateLeaveTypeDto } from '../leave-types/dto/update-leave-type.dto';
import {
  LeaveBalancesQueryDto,
  LeaveRequestsQueryDto,
} from '../../../common/dto/resource-query.dto';

const user = { id: 'line-manager', companyId: 'company-a', role: { scope: 'COMPANY' } };
describe('Leave workspaces', () => {
  it('preserves request scope, status, type and pagination while searching', async () => {
    const delegate = {
      findMany: jest.fn().mockResolvedValue([]),
      count: jest.fn().mockResolvedValue(0),
    };
    const service = new LeaveRequestsService(
      { leaveRequest: delegate } as never,
      {} as never,
      {} as never,
    );
    const query = plainToInstance(LeaveRequestsQueryDto, {
      page: 2,
      limit: 20,
      companyId: 'company-a',
      employeeId: 'employee',
      leaveTypeId: 'type',
      status: 'SUBMITTED',
      search: ' Alex ',
    });
    expect(await validate(query, { whitelist: true, forbidNonWhitelisted: true })).toHaveLength(0);
    await service.findAll(user, query);
    const args = delegate.findMany.mock.calls[0][0];
    expect(args).toMatchObject({
      skip: 20,
      take: 20,
      where: {
        deletedAt: null,
        companyId: 'company-a',
        employeeId: 'employee',
        leaveTypeId: 'type',
        status: 'SUBMITTED',
      },
    });
    expect(args.where.AND[0].OR).toContainEqual({
      employee: { fullName: { contains: 'Alex', mode: 'insensitive' } },
    });
    expect(delegate.count).toHaveBeenCalledWith({ where: args.where });
    await expect(service.findAll(user, { companyId: 'foreign', search: 'Alex' })).rejects.toThrow();
  });
  it('combines balance search with the company access boundary and year', async () => {
    const delegate = {
      findMany: jest.fn().mockResolvedValue([]),
      count: jest.fn().mockResolvedValue(0),
    };
    const companyWhereFor = jest
      .fn()
      .mockResolvedValue({ companyId: { in: ['company-a'] }, AND: { year: { gte: 2020 } } });
    const service = new LeaveBalancesService(
      { leaveBalance: delegate } as never,
      {} as never,
      { companyWhereFor } as never,
    );
    const query = plainToInstance(LeaveBalancesQueryDto, {
      page: 2,
      limit: 20,
      year: 2026,
      employeeId: 'employee',
      leaveTypeId: 'type',
      search: ' Annual ',
    });
    expect(await validate(query, { whitelist: true, forbidNonWhitelisted: true })).toHaveLength(0);
    await service.findAll(user as never, query);
    const args = delegate.findMany.mock.calls[0][0];
    expect(args).toMatchObject({
      skip: 20,
      take: 20,
      where: {
        companyId: { in: ['company-a'] },
        year: 2026,
        employeeId: 'employee',
        leaveTypeId: 'type',
      },
    });
    expect(args.where.AND[0]).toEqual({ year: { gte: 2020 } });
    expect(args.where.AND[1].OR).toContainEqual({
      leaveType: { name: { contains: 'Annual', mode: 'insensitive' } },
    });
    expect(delegate.count).toHaveBeenCalledWith({ where: args.where });
  });
  it('accepts explicit clearing of the annual allowance', async () => {
    const dto = plainToInstance(UpdateLeaveTypeDto, { annualAllowanceDays: null });
    expect(await validate(dto)).toHaveLength(0);
    const delegate = {
      findFirst: jest.fn().mockResolvedValue({ id: 'type', annualAllowanceDays: 21 }),
      update: jest.fn().mockResolvedValue({ id: 'type', annualAllowanceDays: null }),
    };
    const service = new LeaveTypesService(
      { leaveType: delegate } as never,
      { log: jest.fn() } as never,
    );
    await service.update('type', dto, user);
    expect(delegate.update).toHaveBeenCalledWith({
      where: { id: 'type' },
      data: { annualAllowanceDays: null },
    });
  });
  it('leaves long leave submitted after line approval until a different HR approver completes it', async () => {
    let record: any = {
      id: 'request',
      status: 'SUBMITTED',
      totalDays: 6,
      lineApprovedById: null,
      groupHrApprovedById: null,
      approvalNotes: null,
    };
    const delegate = {
      findFirst: jest.fn(async () => record),
      update: jest.fn(async ({ data }) => {
        record = { ...record, ...data };
        return record;
      }),
      findUnique: jest.fn(async () => ({
        ...record,
        leaveType: { paid: false, annualAllowanceDays: null },
      })),
    };
    const tx = { leaveRequest: delegate };
    const service = new LeaveRequestsService(
      { leaveRequest: delegate, $transaction: async (fn: any) => fn(tx) } as never,
      { log: jest.fn() } as never,
      {} as never,
    );
    expect(await service.approve('request', 'Line checked', user)).toMatchObject({
      status: 'SUBMITTED',
      lineApprovedById: user.id,
    });
    await expect(service.approveHr('request', 'HR checked', user)).rejects.toThrow('must differ');
    expect(
      await service.approveHr('request', 'HR checked', { ...user, id: 'hr-manager' }),
    ).toMatchObject({
      status: 'APPROVED',
      groupHrApprovedById: 'hr-manager',
      approvalNotes: 'Line checked\nHR checked',
    });
  });
});
