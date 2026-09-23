import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { ApprovalRequestsService } from './approval-requests.service';
import { ApprovalRequestsController } from './approval-requests.controller';
import { CompanyScopeService } from '../../common/services';
import { AuthUser } from '../../common/decorators/current-user.decorator';
import {
  ApprovalRequestsQueryDto,
  ApprovalPendingQueryDto,
} from '../../common/dto/resource-query.dto';
const user: AuthUser = {
  id: 'reviewer',
  email: 'reviewer@example.test',
  companyId: 'company',
  companyAccess: [],
  permissions: [
    'approval_requests.view',
    'approval_requests.approve',
    'approval_requests.reject',
    'approval_requests.cancel',
  ],
  roles: [],
};
const request = {
  id: 'request',
  companyId: 'company',
  entityType: 'PurchaseOrder',
  requestedById: 'maker',
  status: 'PENDING',
  currentStepOrder: 1,
  workflow: {
    name: 'Review',
    steps: [
      { stepOrder: 1, approverType: 'USER', approverUserId: 'reviewer', allowSelfApproval: false },
    ],
  },
};
function setup() {
  const prisma = {
    approvalRequest: {
      findMany: jest.fn().mockResolvedValue([request]),
      findFirst: jest.fn().mockResolvedValue(request),
      count: jest.fn().mockResolvedValue(31),
    },
    userRole: { findMany: jest.fn().mockResolvedValue([]) },
    approvalDelegation: { findMany: jest.fn().mockResolvedValue([]) },
  };
  const service = new ApprovalRequestsService(
    prisma as any,
    { log: jest.fn() } as any,
    new CompanyScopeService(prisma as any),
  );
  return { service, prisma };
}
describe('Approval request workspace', () => {
  it('combines search with company boundaries and exact filters on rows and counts', async () => {
    const { service, prisma } = setup();
    const result = await service.findAll(user, {
      page: 2,
      limit: 15,
      companyId: 'company',
      entityType: 'PurchaseOrder',
      status: 'DRAFT',
      requestedById: 'maker',
      search: ' PAY ',
    });
    const args = prisma.approvalRequest.findMany.mock.calls[0][0];
    expect(args).toMatchObject({
      skip: 15,
      take: 15,
      where: {
        deletedAt: null,
        AND: [{ companyId: 'company' }],
        entityType: 'PurchaseOrder',
        status: 'DRAFT',
        requestedById: 'maker',
        OR: expect.arrayContaining([
          { requestTitle: { contains: 'PAY', mode: 'insensitive' } },
          { approvalRequestNumber: { contains: 'PAY', mode: 'insensitive' } },
        ]),
      },
      include: { company: { select: { id: true, name: true } } },
    });
    expect(prisma.approvalRequest.count).toHaveBeenCalledWith({ where: args.where });
    expect(result.total).toBe(31);
  });
  it('includes global requests only for unfiltered group views and rejects foreign company filters', async () => {
    const { service, prisma } = setup();
    await service.findAll(user, {});
    expect(prisma.approvalRequest.findMany.mock.calls[0][0].where.AND).toEqual([
      { companyId: { in: ['company'] } },
    ]);
    await service.findAll({ ...user, roleScopes: ['GROUP'] }, {});
    expect(prisma.approvalRequest.findMany.mock.calls[1][0].where.AND).toEqual([
      { OR: [{ companyId: { in: ['company'] } }, { companyId: null }] },
    ]);
    await expect(service.findAll(user, { companyId: 'outside' })).rejects.toThrow();
    await expect(service.findPendingForMe(user, { companyId: 'outside' })).rejects.toThrow();
    expect(prisma.approvalRequest.findMany).toHaveBeenCalledTimes(2);
  });
  it('applies search and scope before eligibility, then paginates the eligible pending set', async () => {
    const { service, prisma } = setup();
    prisma.approvalRequest.findMany.mockResolvedValue([
      ...Array.from({ length: 17 }, (_, index) => ({ ...request, id: `r${index}` })),
      {
        ...request,
        id: 'not-eligible',
        workflow: {
          name: 'Other',
          steps: [{ ...request.workflow.steps[0], approverUserId: 'someone-else' }],
        },
      },
    ]);
    const result = await service.findPendingForMe(user, {
      page: 2,
      limit: 15,
      search: 'purchase',
      entityType: 'PurchaseOrder',
      companyId: 'company',
    });
    expect(result.total).toBe(17);
    expect(result.data.map((r) => r.id)).toEqual(['r15', 'r16']);
    expect(prisma.approvalRequest.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          status: 'PENDING',
          requestedById: { not: 'reviewer' },
          AND: [{ companyId: 'company' }],
          entityType: 'PurchaseOrder',
          OR: expect.any(Array),
        }),
      }),
    );
  });
  it('returns permitted current-step actions from the detail endpoint', async () => {
    const { service } = setup();
    const controller = new ApprovalRequestsController(service);
    const details = await controller.findOne('request', user);
    expect(details.availableActions).toEqual({ approve: true, reject: true, cancel: true });
  });
  it.each(['DRAFT', 'APPROVED', 'REJECTED', 'CANCELLED', 'ESCALATED', 'EXPIRED'])(
    'advertises only existing backend actions for %s',
    async (status) => {
      const { service, prisma } = setup();
      prisma.approvalRequest.findFirst.mockResolvedValue({ ...request, status });
      expect((await service.getDetails('request', user)).availableActions).toEqual({
        approve: false,
        reject: false,
        cancel: status === 'DRAFT',
      });
      expect(prisma.userRole.findMany).not.toHaveBeenCalled();
    },
  );
  it('combines independent action permissions with requester and approver eligibility', async () => {
    const { service, prisma } = setup();
    expect(
      (
        await service.getDetails('request', {
          ...user,
          permissions: ['approval_requests.view', 'approval_requests.reject'],
        })
      ).availableActions,
    ).toEqual({ approve: false, reject: true, cancel: false });
    expect(
      (await service.getDetails('request', { ...user, id: 'maker' })).availableActions,
    ).toEqual({ approve: false, reject: false, cancel: true });
    expect(
      (await service.getDetails('request', { ...user, id: 'other' })).availableActions,
    ).toEqual({ approve: false, reject: false, cancel: true });
    prisma.userRole.findMany.mockClear();
    expect(
      (await service.getDetails('request', { ...user, permissions: ['approval_requests.view'] }))
        .availableActions,
    ).toEqual({ approve: false, reject: false, cancel: false });
    expect(prisma.userRole.findMany).not.toHaveBeenCalled();
  });
  it('does not return details or resolve eligibility for inaccessible requests', async () => {
    const { service, prisma } = setup();
    prisma.approvalRequest.findFirst.mockResolvedValue({ ...request, companyId: 'outside' });
    await expect(service.getDetails('request', user)).rejects.toThrow('Approval request not found');
    expect(prisma.userRole.findMany).not.toHaveBeenCalled();
    expect(prisma.approvalDelegation.findMany).not.toHaveBeenCalled();
  });
  it('validates both search contracts and rejects invalid request statuses', async () => {
    for (const type of [ApprovalPendingQueryDto, ApprovalRequestsQueryDto]) {
      const value = plainToInstance(type, {
        page: '2',
        limit: '15',
        search: 'PAY',
        companyId: 'company',
        entityType: 'PurchaseOrder',
      });
      expect(await validate(value)).toHaveLength(0);
      expect(value.page).toBe(2);
    }
    expect(
      (await validate(plainToInstance(ApprovalRequestsQueryDto, { status: 'UNKNOWN' }))).length,
    ).toBeGreaterThan(0);
  });
});
