import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { ApprovalDelegationsService } from './approval-delegations.service';
import {
  CreateApprovalDelegationDto,
  UpdateApprovalDelegationDto,
} from './dto/create-approval-delegation.dto';
import { ApprovalDelegationsQueryDto } from '../../common/dto/resource-query.dto';
import { AuthUser } from '../../common/decorators/current-user.decorator';
const user: AuthUser = {
  id: 'actor',
  email: 'example@example.test',
  companyId: 'company',
  roles: [],
  permissions: [],
};
const record = {
  id: 'delegation',
  companyId: 'company' as string | null,
  delegatorUserId: 'first',
  delegateUserId: 'second',
  startDate: new Date('2026-09-01T08:15:23.500Z'),
  endDate: new Date('2026-09-30T17:30:45.100Z'),
  status: 'ACTIVE',
};
function setup(overrides = {}) {
  const model = {
    findMany: jest.fn().mockResolvedValue([record]),
    findFirst: jest.fn().mockResolvedValue({ ...record, ...overrides }),
    count: jest.fn().mockResolvedValue(21),
    create: jest.fn().mockResolvedValue(record),
    update: jest.fn().mockResolvedValue(record),
  };
  const people = { findMany: jest.fn().mockResolvedValue([{ id: 'first' }, { id: 'second' }]) };
  const audit = { log: jest.fn() };
  return {
    model,
    people,
    audit,
    service: new ApprovalDelegationsService(
      { approvalDelegation: model, user: people } as any,
      audit as any,
    ),
  };
}
const input: CreateApprovalDelegationDto = {
  companyId: 'company',
  delegatorUserId: 'first',
  delegateUserId: 'second',
  startDate: '2026-09-01T08:00:00Z',
  endDate: '2026-09-30T17:00:00Z',
};
describe('Delegation workspace contracts', () => {
  it('combines scoped text search, status, pagination and matching count', async () => {
    const { service, model } = setup();
    await service.findAll(user, {
      companyId: 'company',
      status: 'ACTIVE',
      search: ' Alex ',
      page: 2,
      limit: 20,
    });
    const args = model.findMany.mock.calls[0][0];
    expect(args).toMatchObject({
      skip: 20,
      take: 20,
      where: {
        deletedAt: null,
        AND: [{ companyId: 'company' }],
        status: 'ACTIVE',
        OR: expect.arrayContaining([
          { delegator: { fullName: { contains: 'Alex', mode: 'insensitive' } } },
          { delegate: { email: { contains: 'Alex', mode: 'insensitive' } } },
        ]),
      },
      include: { company: { select: { id: true, name: true } } },
    });
    expect(model.count).toHaveBeenCalledWith({ where: args.where });
  });
  it('limits global records to group scope and keeps requested companies exact', async () => {
    const { service, model } = setup();
    await service.findAll(user, {});
    expect(model.findMany.mock.calls[0][0].where.AND).toEqual([{ companyId: { in: ['company'] } }]);
    await service.findAll({ ...user, roleScopes: ['GROUP'] }, {});
    expect(model.findMany.mock.calls[1][0].where.AND).toEqual([
      { OR: [{ companyId: { in: ['company'] } }, { companyId: null }] },
    ]);
    await service.findAll({ ...user, roleScopes: ['GROUP'] }, { companyId: 'company' });
    expect(model.findMany.mock.calls[2][0].where.AND).toEqual([{ companyId: 'company' }]);
    await expect(service.findAll(user, { companyId: 'outside' })).rejects.toThrow(
      'You do not have access',
    );
  });
  it.each(['update', 'cancel', 'remove'] as const)(
    'denies %s without company write access and protects direct reads',
    async (method) => {
      const { service, model, audit } = setup({ companyId: 'outside' });
      await expect(service.findOne('delegation', user)).rejects.toThrow('You do not have access');
      const reader = { ...user, companyAccess: [{ companyId: 'outside', accessLevel: 'READ' }] };
      await expect(
        method === 'update'
          ? service.update('delegation', { reason: 'changed' }, reader)
          : service[method]('delegation', reader),
      ).rejects.toThrow();
      expect(model.update).not.toHaveBeenCalled();
      expect(audit.log).not.toHaveBeenCalled();
    },
  );
  it('requires write access to old and new company when moving or broadening scope', async () => {
    const { service, model } = setup();
    await expect(service.update('delegation', { companyId: 'outside' }, user)).rejects.toThrow();
    await expect(service.update('delegation', { companyId: null }, user)).rejects.toThrow(
      'Group-scoped',
    );
    await expect(service.create({ ...input, companyId: null }, user)).rejects.toThrow(
      'Group-scoped',
    );
    expect(model.update).not.toHaveBeenCalled();
    expect(model.create).not.toHaveBeenCalled();
  });
  it('validates distinct scoped people and merged date windows before mutations', async () => {
    const { service, model, people } = setup();
    await expect(service.create({ ...input, delegateUserId: 'first' }, user)).rejects.toThrow(
      'two different',
    );
    await expect(
      service.update('delegation', { endDate: '2026-08-01T00:00:00Z' }, user),
    ).rejects.toThrow('end must be');
    await expect(service.create({ ...input, startDate: 'invalid' }, user)).rejects.toThrow(
      'end must be',
    );
    people.findMany.mockResolvedValueOnce([{ id: 'first' }]);
    await expect(service.create(input, user)).rejects.toThrow('Both people');
    expect(model.create).not.toHaveBeenCalled();
    expect(model.update).not.toHaveBeenCalled();
    expect(people.findMany).toHaveBeenLastCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          deletedAt: null,
          OR: expect.arrayContaining([
            { companyId: 'company' },
            { companyAccess: { some: { companyId: 'company' } } },
          ]),
        }),
      }),
    );
  });
  it('preserves defaults, nullable clears, exact untouched dates and audited cancellation/deletion', async () => {
    const { service, model, people, audit } = setup();
    await service.create({ ...input, entityType: ' PurchaseOrder ' }, user);
    expect(model.create).toHaveBeenLastCalledWith({
      data: expect.objectContaining({
        companyId: 'company',
        entityType: 'PurchaseOrder',
        status: 'ACTIVE',
        startDate: new Date(input.startDate),
        endDate: new Date(input.endDate),
      }),
    });
    await service.update('delegation', { reason: null, entityType: null }, user);
    expect(model.update).toHaveBeenLastCalledWith({
      where: { id: 'delegation' },
      data: { reason: null, entityType: null },
    });
    expect(people.findMany).toHaveBeenCalledTimes(1);
    await service.cancel('delegation', user);
    expect(model.update).toHaveBeenLastCalledWith({
      where: { id: 'delegation' },
      data: { status: 'CANCELLED' },
    });
    await service.remove('delegation', user);
    expect(model.update).toHaveBeenLastCalledWith({
      where: { id: 'delegation' },
      data: { deletedAt: expect.any(Date) },
    });
    expect(audit.log).toHaveBeenCalledTimes(4);
  });
  it('rejects nonnullable null fields and invalid statuses while accepting optional clears', async () => {
    expect(
      await validate(
        plainToInstance(UpdateApprovalDelegationDto, {
          reason: null,
          companyId: null,
          entityType: null,
        }),
      ),
    ).toHaveLength(0);
    for (const key of ['delegatorUserId', 'delegateUserId', 'startDate', 'endDate', 'status'])
      expect(
        (await validate(plainToInstance(UpdateApprovalDelegationDto, { [key]: null }))).length,
      ).toBeGreaterThan(0);
    expect(
      (await validate(plainToInstance(ApprovalDelegationsQueryDto, { status: 'BAD' }))).length,
    ).toBeGreaterThan(0);
    const query = plainToInstance(ApprovalDelegationsQueryDto, {
      page: '2',
      limit: '20',
      search: 'Alex',
      status: 'ACTIVE',
    });
    expect(await validate(query)).toHaveLength(0);
    expect(query.page).toBe(2);
  });
});
