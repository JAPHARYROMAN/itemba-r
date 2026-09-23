import { validate } from 'class-validator';
import { plainToInstance } from 'class-transformer';
import { ApprovalWorkflowsService } from './approval-workflows.service';
import { CreateApprovalWorkflowDto } from './dto/create-approval-workflow.dto';
import { UpdateApprovalWorkflowDto } from './dto/update-approval-workflow.dto';
import { ApprovalWorkflowsQueryDto } from '../../common/dto/resource-query.dto';
import { AuthUser } from '../../common/decorators/current-user.decorator';
const user: AuthUser = {
  id: 'user',
  email: 'example@example.test',
  roles: [],
  permissions: [],
  companyId: 'company',
};
function setup(companyId: string | null = 'company') {
  const record = {
    id: 'workflow',
    companyId,
    name: 'Purchases',
    workflowCode: 'WF-1',
    isActive: true,
  };
  const model = {
    findMany: jest.fn().mockResolvedValue([record]),
    count: jest.fn().mockResolvedValue(21),
    findFirst: jest.fn().mockResolvedValue(record),
    create: jest.fn().mockResolvedValue(record),
    update: jest.fn().mockResolvedValue(record),
  };
  const audit = { log: jest.fn() };
  return {
    model,
    audit,
    service: new ApprovalWorkflowsService({ approvalWorkflow: model } as any, audit as any),
  };
}
describe('Approval workflow workspace contracts', () => {
  it('combines company boundaries, search, exact filters and server pagination', async () => {
    const { model, service } = setup();
    const result = await service.findAll(user, {
      page: 2,
      limit: 20,
      companyId: 'company',
      entityType: 'PurchaseOrder',
      isActive: 'false',
      search: ' WF ',
    });
    const args = model.findMany.mock.calls[0][0];
    expect(args).toMatchObject({
      skip: 20,
      take: 20,
      where: {
        deletedAt: null,
        AND: [{ companyId: 'company' }],
        entityType: 'PurchaseOrder',
        isActive: false,
        OR: [
          { name: { contains: 'WF', mode: 'insensitive' } },
          { workflowCode: { contains: 'WF', mode: 'insensitive' } },
        ],
      },
      include: {
        company: { select: { id: true, name: true, code: true } },
        steps: { where: { deletedAt: null }, orderBy: { stepOrder: 'asc' } },
      },
    });
    expect(model.count).toHaveBeenCalledWith({ where: args.where });
    expect(result.total).toBe(21);
  });
  it('keeps global workflows limited to group users and only the unfiltered scope', async () => {
    const { model, service } = setup();
    await service.findAll(user, {});
    expect(model.findMany.mock.calls[0][0].where.AND).toEqual([{ companyId: { in: ['company'] } }]);
    await service.findAll({ ...user, roleScopes: ['GROUP'] }, {});
    expect(model.findMany.mock.calls[1][0].where.AND).toEqual([
      { OR: [{ companyId: { in: ['company'] } }, { companyId: null }] },
    ]);
    await service.findAll({ ...user, roleScopes: ['GROUP'] }, { companyId: 'company' });
    expect(model.findMany.mock.calls[2][0].where.AND).toEqual([{ companyId: 'company' }]);
  });
  it('rejects inaccessible filters and direct detail reads', async () => {
    const { model, service } = setup('outside');
    await expect(service.findAll(user, { companyId: 'outside' })).rejects.toThrow(
      'You do not have access',
    );
    expect(model.findMany).not.toHaveBeenCalled();
    await expect(service.findOne('workflow', user)).rejects.toThrow('You do not have access');
  });
  it.each(['update', 'activate', 'deactivate', 'remove'] as const)(
    'denies %s with read-only company access',
    async (method) => {
      const { model, service, audit } = setup('read-only');
      const reader = { ...user, companyAccess: [{ companyId: 'read-only', accessLevel: 'READ' }] };
      const promise =
        method === 'update'
          ? service.update('workflow', { name: 'Changed' }, reader)
          : service[method]('workflow', reader);
      await expect(promise).rejects.toThrow();
      expect(model.update).not.toHaveBeenCalled();
      expect(audit.log).not.toHaveBeenCalled();
    },
  );
  it('checks create scope, preserves defaults and permits global creation only for group users', async () => {
    const { model, service } = setup();
    await expect(
      service.create(
        { name: 'Purchases', entityType: 'PurchaseOrder', companyId: 'outside' },
        user,
      ),
    ).rejects.toThrow();
    await expect(
      service.create({ name: 'Purchases', entityType: 'PurchaseOrder' }, user),
    ).rejects.toThrow('Group-scoped role');
    expect(model.create).not.toHaveBeenCalled();
    await service.create(
      { name: 'Purchases', entityType: 'PurchaseOrder', companyId: 'company' },
      user,
    );
    expect(model.create).toHaveBeenLastCalledWith({
      data: expect.objectContaining({
        workflowCode: expect.stringMatching(/^WF-/),
        companyId: 'company',
        priority: 0,
        isActive: true,
        createdById: 'user',
      }),
    });
    await service.create(
      { name: 'Group workflow', entityType: 'PurchaseOrder' },
      { ...user, roleScopes: ['GROUP'] },
    );
    expect(model.create).toHaveBeenCalledTimes(2);
  });
  it('clears description without overwriting other fields and keeps soft deletion and audit', async () => {
    const { model, service, audit } = setup();
    await service.update('workflow', { description: null }, user);
    expect(model.update).toHaveBeenLastCalledWith({
      where: { id: 'workflow' },
      data: { description: null },
    });
    await service.activate('workflow', user);
    expect(model.update).toHaveBeenLastCalledWith({
      where: { id: 'workflow' },
      data: { isActive: true },
    });
    await service.deactivate('workflow', user);
    expect(model.update).toHaveBeenLastCalledWith({
      where: { id: 'workflow' },
      data: { isActive: false },
    });
    await service.remove('workflow', user);
    expect(model.update).toHaveBeenLastCalledWith({
      where: { id: 'workflow' },
      data: { deletedAt: expect.any(Date) },
    });
    expect(audit.log).toHaveBeenCalledTimes(4);
  });
  it('rejects missing records before mutation', async () => {
    const { model, service } = setup();
    model.findFirst.mockResolvedValue(null);
    await expect(service.remove('missing', user)).rejects.toThrow('Approval workflow not found');
    expect(model.update).not.toHaveBeenCalled();
  });
  it('accepts supported query fields and rejects invalid workflow values', async () => {
    for (const field of [
      'name',
      'entityType',
      'workflowScope',
      'triggerAction',
      'isActive',
      'priority',
    ]) {
      expect(
        (await validate(plainToInstance(UpdateApprovalWorkflowDto, { [field]: null }))).some(
          (e) => e.property === field,
        ),
      ).toBe(true);
    }
    for (const field of ['workflowScope', 'triggerAction']) {
      expect(
        (
          await validate(
            plainToInstance(CreateApprovalWorkflowDto, {
              name: 'Purchases',
              entityType: 'PurchaseOrder',
              [field]: null,
            }),
          )
        ).some((e) => e.property === field),
      ).toBe(true);
    }
    expect(
      await validate(
        plainToInstance(ApprovalWorkflowsQueryDto, {
          search: 'WF',
          page: '2',
          limit: '20',
          isActive: 'false',
        }),
      ),
    ).toHaveLength(0);
    for (const priority of [1.5, Infinity, 2147483648])
      expect(
        (
          await validate(
            plainToInstance(CreateApprovalWorkflowDto, {
              name: 'Purchases',
              entityType: 'PurchaseOrder',
              priority,
            }),
          )
        ).some((e) => e.property === 'priority'),
      ).toBe(true);
    expect(
      (
        await validate(plainToInstance(CreateApprovalWorkflowDto, { name: ' ', entityType: '' }))
      ).map((e) => e.property),
    ).toEqual(expect.arrayContaining(['name', 'entityType']));
    expect(
      await validate(plainToInstance(UpdateApprovalWorkflowDto, { description: null })),
    ).toHaveLength(0);
  });
});
