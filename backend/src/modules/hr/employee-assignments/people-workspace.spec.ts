import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { EmployeeAssignmentsService } from './employee-assignments.service';
import { EmploymentContractsService } from '../employment-contracts/employment-contracts.service';
import { UpdateEmployeeAssignmentDto } from './dto/update-employee-assignment.dto';
import {
  EmployeeAssignmentQueryDto,
  EmploymentContractsQueryDto,
} from '../../../common/dto/resource-query.dto';

const user = { id: 'manager', companyId: 'company-a', role: { scope: 'COMPANY' } };
describe('People agreement workspaces', () => {
  it.each(['assignments', 'contracts'])(
    '%s search preserves employee/company scope and pagination',
    async (kind) => {
      const delegate = {
        findMany: jest.fn().mockResolvedValue([]),
        count: jest.fn().mockResolvedValue(0),
      };
      const prisma = { employeeAssignment: delegate, employmentContract: delegate };
      const service =
        kind === 'assignments'
          ? new EmployeeAssignmentsService(prisma as never, {} as never)
          : new EmploymentContractsService(prisma as never, {} as never, {} as never);
      const Dto = kind === 'assignments' ? EmployeeAssignmentQueryDto : EmploymentContractsQueryDto;
      const query = plainToInstance(Dto, {
        employeeId: 'employee',
        companyId: 'company-a',
        search: ' Alex ',
        page: 2,
        limit: 20,
      });
      expect(await validate(query, { whitelist: true, forbidNonWhitelisted: true })).toHaveLength(
        0,
      );
      await service.findAll(user, query);
      const args = delegate.findMany.mock.calls[0][0];
      expect(args).toMatchObject({
        skip: 20,
        take: 20,
        where: { employeeId: 'employee', companyId: 'company-a', deletedAt: null },
      });
      expect(args.where.AND[0].OR).toContainEqual({
        employee: { fullName: { contains: 'Alex', mode: 'insensitive' } },
      });
      expect(delegate.count).toHaveBeenCalledWith({ where: args.where });
      await expect(
        service.findAll(user, { companyId: 'company-b', search: 'Alex' }),
      ).rejects.toThrow();
    },
  );
  function setup() {
    const current = {
      id: 'assignment',
      employeeId: 'employee',
      companyId: 'company-a',
      divisionId: 'division',
      branchId: 'branch',
      startDate: new Date('2026-01-01'),
      endDate: new Date('2026-02-01'),
      status: 'INACTIVE',
      isPrimary: false,
      approvalStatus: 'APPROVED',
    };
    const delegate = {
      findFirst: jest.fn().mockResolvedValue(current),
      update: jest.fn().mockResolvedValue(current),
    };
    const prisma = {
      employeeAssignment: delegate,
      $transaction: jest.fn(async (fn) => fn({ employeeAssignment: delegate })),
    };
    return {
      service: new EmployeeAssignmentsService(prisma as never, { log: jest.fn() } as never),
      delegate,
      current,
    };
  }
  it('accepts explicit end date and branch clearing and validates the resulting interval', async () => {
    const { service, delegate } = setup();
    const dto = plainToInstance(UpdateEmployeeAssignmentDto, {
      startDate: '2026-03-01',
      endDate: null,
      branchId: null,
    });
    expect(await validate(dto)).toHaveLength(0);
    await service.update('assignment', dto, user);
    expect(delegate.update).toHaveBeenCalledWith({
      where: { id: 'assignment' },
      data: { startDate: new Date('2026-03-01'), endDate: null, branchId: null },
    });
  });
  it('retains the existing end date when omitted and rejects an invalid resulting interval', async () => {
    const { service, delegate } = setup();
    await expect(service.update('assignment', { startDate: '2026-03-01' }, user)).rejects.toThrow(
      'end date cannot be before',
    );
    expect(delegate.update).not.toHaveBeenCalled();
  });
  it('keeps company and division changes in the transfer workflow', async () => {
    const { service, delegate } = setup();
    await expect(service.update('assignment', { divisionId: 'other' }, user)).rejects.toThrow(
      'new assignment',
    );
    expect(delegate.update).not.toHaveBeenCalled();
  });
});
