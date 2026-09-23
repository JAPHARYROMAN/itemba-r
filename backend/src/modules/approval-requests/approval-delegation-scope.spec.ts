import { ApprovalRequestsService } from './approval-requests.service';
import { AuthUser } from '../../common/decorators/current-user.decorator';
import { CompanyScopeService } from '../../common/services';
const user: AuthUser = {
  id: 'delegate',
  email: 'example@example.test',
  companyId: 'company',
  companyAccess: [{ companyId: 'other', accessLevel: 'WRITE' }],
  roles: [],
  permissions: ['approval_requests.approve'],
};
const grant = {
  delegatorUserId: 'designated',
  companyId: 'company' as string | null,
  entityType: 'PurchaseOrder' as string | null,
};
const request = {
  id: 'request',
  requestedById: 'maker',
  companyId: 'company',
  entityType: 'PurchaseOrder',
  status: 'PENDING',
  currentStepOrder: 1,
  workflow: {
    name: 'Review',
    steps: [
      {
        stepOrder: 1,
        approverType: 'USER',
        approverUserId: 'designated',
        allowSelfApproval: false,
      },
    ],
  },
};
function setup(delegation = grant) {
  const prisma = {
    userRole: { findMany: jest.fn().mockResolvedValue([]) },
    approvalDelegation: { findMany: jest.fn().mockResolvedValue([delegation]) },
    approvalRequest: {
      findMany: jest
        .fn()
        .mockResolvedValue([
          request,
          { ...request, id: 'other-company', companyId: 'other' },
          { ...request, id: 'other-type', entityType: 'SalesOrder' },
        ]),
      findFirst: jest.fn().mockResolvedValue(request),
      update: jest.fn().mockResolvedValue({ ...request, status: 'APPROVED' }),
    },
    approvalAction: { create: jest.fn() },
  };
  const audit = { log: jest.fn() };
  return {
    prisma,
    audit,
    service: new ApprovalRequestsService(
      prisma as any,
      audit as any,
      new CompanyScopeService(prisma as any),
    ),
  };
}
describe('Delegated approval scope', () => {
  it('filters pending eligibility by company and entity within active date windows', async () => {
    const { service, prisma } = setup();
    const result = await service.findPendingForMe(user, {});
    expect(result.total).toBe(1);
    expect(result.data[0].id).toBe('request');
    expect(prisma.approvalDelegation.findMany).toHaveBeenCalledWith({
      where: {
        delegateUserId: user.id,
        status: 'ACTIVE',
        startDate: { lte: expect.any(Date) },
        endDate: { gte: expect.any(Date) },
        deletedAt: null,
      },
      select: { delegatorUserId: true, companyId: true, entityType: true },
    });
  });
  it('honors explicitly unrestricted company/entity scopes', async () => {
    const { service } = setup({ ...grant, companyId: null, entityType: null });
    const result = await service.findPendingForMe(user, {});
    expect(result.total).toBe(3);
  });
  it.each([
    { companyId: 'other', entityType: 'PurchaseOrder' },
    { companyId: 'company', entityType: 'SalesOrder' },
  ])('denies an approval outside the delegation scope %j', async (scope) => {
    const { service, prisma, audit } = setup({ ...grant, ...scope });
    await expect(service.approve('request', {}, user)).rejects.toThrow('not a designated approver');
    expect(prisma.approvalRequest.update).not.toHaveBeenCalled();
    expect(prisma.approvalAction.create).not.toHaveBeenCalled();
    expect(audit.log).not.toHaveBeenCalled();
  });
  it('permits a matching grant but preserves maker-checker protection', async () => {
    const { service, prisma } = setup();
    await service.approve('request', {}, user);
    expect(prisma.approvalRequest.update).toHaveBeenCalledTimes(1);
    prisma.approvalRequest.findFirst.mockResolvedValueOnce({ ...request, requestedById: user.id });
    await expect(service.approve('request', {}, user)).rejects.toThrow('Maker-checker');
    expect(prisma.approvalRequest.update).toHaveBeenCalledTimes(1);
  });
});
