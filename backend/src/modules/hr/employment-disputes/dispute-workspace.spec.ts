import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { AuthUser } from '../../../common/decorators/current-user.decorator';
import { EmploymentDisputesQueryDto } from '../../../common/dto/resource-query.dto';
import { EmploymentDisputesService } from './employment-disputes.service';
import { ResolveDisputeDto, UpdateEmploymentDisputeDto } from './dto/update-employment-dispute.dto';
const user: AuthUser = {
  id: 'operator',
  email: 'test@example.invalid',
  roles: [],
  permissions: [],
  companyId: 'company',
  roleScopes: ['COMPANY'],
  companyAccess: [{ companyId: 'read-only', accessLevel: 'READ' }],
};
const record = {
  id: 'dispute',
  companyId: 'company',
  employeeId: 'employee',
  status: 'RAISED',
  raisedAt: new Date('2026-09-01T06:30:00Z'),
};
function setup() {
  const delegate = {
      findMany: jest.fn().mockResolvedValue([record]),
      count: jest.fn().mockResolvedValue(1),
      findFirst: jest.fn().mockResolvedValue(record),
      update: jest.fn().mockResolvedValue(record),
      create: jest.fn().mockResolvedValue(record),
    },
    audit = { log: jest.fn().mockResolvedValue(undefined) },
    codes = { next: jest.fn().mockResolvedValue('DIS-EXAMPLE') },
    employee = { findFirst: jest.fn().mockResolvedValue({ divisionId: null, branchId: null }) };
  const service = new EmploymentDisputesService(
    { employmentDispute: delegate, employee } as never,
    audit as never,
    codes as never,
    {} as never,
  );
  return { service, delegate, audit, codes, employee };
}
describe('Dispute workspace', () => {
  it('keeps company/hierarchy/status scope and matching counts when searching and paginating', async () => {
    const { service, delegate } = setup();
    const dto = plainToInstance(EmploymentDisputesQueryDto, {
      page: '2',
      limit: '20',
      companyId: 'company',
      divisionId: 'division',
      branchId: 'branch',
      employeeId: 'employee',
      status: 'RAISED',
      directToGroupHr: 'true',
      search: ' Alex ',
    });
    expect(await validate(dto, { whitelist: true, forbidNonWhitelisted: true })).toHaveLength(0);
    await service.findAll({ ...dto, page: 2, limit: 20, directToGroupHr: true }, user);
    const args = delegate.findMany.mock.calls[0][0];
    expect(args).toMatchObject({
      skip: 20,
      take: 20,
      where: {
        companyId: 'company',
        divisionId: 'division',
        branchId: 'branch',
        employeeId: 'employee',
        status: 'RAISED',
        directToGroupHr: true,
        deletedAt: null,
        OR: expect.arrayContaining([
          { employee: { fullName: { contains: 'Alex', mode: 'insensitive' } } },
          { summary: { contains: 'Alex', mode: 'insensitive' } },
        ]),
      },
    });
    expect(delegate.count).toHaveBeenCalledWith({ where: args.where });
    await expect(service.findAll({ companyId: 'foreign' }, user)).rejects.toThrow();
    expect(delegate.findMany).toHaveBeenCalledTimes(1);
  });
  it('preserves scoped direct reads and rejects every mutation with only Read access', async () => {
    const { service, delegate } = setup();
    await service.findOne('dispute', user);
    expect(delegate.findFirst.mock.calls[0][0].where).toEqual({
      id: 'dispute',
      deletedAt: null,
      companyId: { in: ['company', 'read-only'] },
    });
    delegate.findFirst.mockResolvedValue({ ...record, companyId: 'read-only' });
    await expect(service.update('dispute', { notes: 'test' }, user)).rejects.toThrow();
    await expect(service.startMediation('dispute', {}, user)).rejects.toThrow();
    await expect(service.referToCma('dispute', {}, user)).rejects.toThrow();
    await expect(service.resolve('dispute', { resolutionType: 'OTHER' }, user)).rejects.toThrow();
    await expect(service.withdraw('dispute', user)).rejects.toThrow();
    await expect(service.remove('dispute', user)).rejects.toThrow();
    expect(delegate.update).not.toHaveBeenCalled();
  });
  it('validates employee membership before creating the original Raised state', async () => {
    const { service, delegate, employee, codes } = setup();
    const dto = {
      companyId: 'company',
      employeeId: 'employee',
      type: 'GRIEVANCE' as const,
      raisedAt: '2026-09-01',
      summary: 'Synthetic case',
    };
    employee.findFirst.mockResolvedValueOnce(null);
    await expect(service.create(dto, user)).rejects.toThrow('does not belong');
    expect(codes.next).not.toHaveBeenCalled();
    await service.create(dto, user);
    expect(delegate.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: 'RAISED',
          raisedById: user.id,
          raisedAt: new Date(dto.raisedAt),
        }),
      }),
    );
  });
  it('clears optional text without rewriting dates and rejects identity/null-date changes', async () => {
    const { service, delegate } = setup();
    const dto = plainToInstance(UpdateEmploymentDisputeDto, { initialPosition: null, notes: null });
    expect(await validate(dto, { whitelist: true, forbidNonWhitelisted: true })).toHaveLength(0);
    await service.update('dispute', dto, user);
    expect(delegate.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { initialPosition: null, notes: null } }),
    );
    await expect(service.update('dispute', { employeeId: 'other' }, user)).rejects.toThrow(
      'cannot be changed',
    );
    await expect(
      service.update(
        'dispute',
        plainToInstance(UpdateEmploymentDisputeDto, { raisedAt: null }),
        user,
      ),
    ).rejects.toThrow('raised date');
  });
  it('keeps mediation/referral eligibility and records operators and supplied fields', async () => {
    const { service, delegate } = setup();
    await service.startMediation('dispute', { mediationOutcome: 'Synthetic outcome' }, user);
    expect(delegate.update).toHaveBeenLastCalledWith(
      expect.objectContaining({
        data: {
          status: 'INTERNAL_MEDIATION',
          mediatedById: user.id,
          mediatedAt: expect.any(Date),
          mediationOutcome: 'Synthetic outcome',
        },
      }),
    );
    delegate.findFirst.mockResolvedValue({ ...record, status: 'INTERNAL_MEDIATION' });
    await expect(service.startMediation('dispute', {}, user)).rejects.toThrow('Only RAISED');
    await service.referToCma(
      'dispute',
      { cmaReferenceNumber: 'CMA-EXAMPLE', cmaHearingDate: '2026-10-01', cmaArbitrator: 'Example' },
      user,
    );
    expect(delegate.update).toHaveBeenLastCalledWith(
      expect.objectContaining({
        data: {
          status: 'CMA_REFERRED',
          cmaReferredById: user.id,
          cmaReferredAt: expect.any(Date),
          cmaReferenceNumber: 'CMA-EXAMPLE',
          cmaHearingDate: new Date('2026-10-01'),
          cmaArbitrator: 'Example',
        },
      }),
    );
    delegate.findFirst.mockResolvedValue({ ...record, status: 'RESOLVED' });
    await expect(service.referToCma('dispute', {}, user)).rejects.toThrow('current status');
  });
  it('preserves zero resolution amounts and prevents repeated closed-state transitions', async () => {
    const { service, delegate } = setup();
    const dto = plainToInstance(ResolveDisputeDto, {
      resolutionType: 'SETTLED_INTERNALLY',
      resolutionAmount: 0,
      resolutionNotes: 'Synthetic outcome',
    });
    expect(await validate(dto)).toHaveLength(0);
    await service.resolve('dispute', dto, user);
    expect(delegate.update).toHaveBeenLastCalledWith(
      expect.objectContaining({
        data: { status: 'RESOLVED', resolvedById: user.id, resolvedAt: expect.any(Date), ...dto },
      }),
    );
    for (const status of ['RESOLVED', 'DISMISSED', 'WITHDRAWN']) {
      delegate.findFirst.mockResolvedValue({ ...record, status });
      await expect(service.resolve('dispute', dto, user)).rejects.toThrow('already closed');
      await expect(service.withdraw('dispute', user)).rejects.toThrow('already closed');
    }
    expect(delegate.update).toHaveBeenCalledTimes(1);
  });
  it('retains withdrawal and soft-delete audit semantics', async () => {
    const { service, delegate, audit } = setup();
    await service.withdraw('dispute', user);
    expect(delegate.update).toHaveBeenLastCalledWith(
      expect.objectContaining({
        data: { status: 'WITHDRAWN', resolvedById: user.id, resolvedAt: expect.any(Date) },
      }),
    );
    await service.remove('dispute', user);
    expect(delegate.update).toHaveBeenLastCalledWith({
      where: { id: 'dispute' },
      data: { deletedAt: expect.any(Date) },
    });
    expect(audit.log).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'DELETE', entityId: 'dispute', oldValue: record }),
    );
  });
});
