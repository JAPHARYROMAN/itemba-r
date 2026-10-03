import { BadRequestException } from '@nestjs/common';
import { ApprovalEngineService } from './approval-engine.service';

/**
 * Verifies F-015: a user cannot approve or reject a request they themselves
 * submitted. The engine must reject with BadRequestException before any state
 * change is made.
 */
describe('ApprovalEngineService — maker-checker', () => {
  function makeService(request: any) {
    const prisma = {
      approvalRequest: {
        findFirst: async () => request,
        update: async () => ({ ...request, status: 'APPROVED' }),
      },
      approvalAction: { create: async () => ({ id: 'act-1' }) },
    } as any;
    const audit = { log: async () => undefined } as any;
    const notifications = { sendNotification: async () => undefined } as any;
    return new ApprovalEngineService(prisma, audit, notifications);
  }

  it('rejects a self-approval attempt', async () => {
    const svc = makeService({
      id: 'req-1',
      requestedById: 'user-1',
      status: 'PENDING',
      currentStepOrder: 1,
      requestTitle: 'X',
      companyId: null,
    });
    await expect(svc.approveRequest('req-1', 'user-1')).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects a self-rejection attempt', async () => {
    const svc = makeService({
      id: 'req-1',
      requestedById: 'user-1',
      status: 'PENDING',
      currentStepOrder: 1,
      requestTitle: 'X',
      companyId: null,
    });
    await expect(svc.rejectRequest('req-1', 'user-1')).rejects.toBeInstanceOf(BadRequestException);
  });

  it('allows another user to approve', async () => {
    const svc = makeService({
      id: 'req-1',
      requestedById: 'user-1',
      status: 'PENDING',
      currentStepOrder: 1,
      requestTitle: 'X',
      companyId: null,
    });
    await expect(svc.approveRequest('req-1', 'user-2')).resolves.toBeDefined();
  });

  it('rejects approve when status is not PENDING', async () => {
    const svc = makeService({
      id: 'req-1',
      requestedById: 'user-1',
      status: 'APPROVED',
      currentStepOrder: 1,
      requestTitle: 'X',
      companyId: null,
    });
    await expect(svc.approveRequest('req-1', 'user-2')).rejects.toThrow(/PENDING/);
  });
});

/** Party linkage, Phase 3 PR-5: engine-created requests carry the party when the resolver is wired. */
describe('ApprovalEngineService — party on creation', () => {
  function enginePrisma() {
    return {
      approvalRequest: { create: jest.fn(async ({ data }: any) => ({ id: 'req-9', ...data })) },
      approvalAction: { create: jest.fn(async () => ({ id: 'act-9' })) },
    } as any;
  }
  const audit = { log: async () => undefined } as any;
  const notifications = { sendNotification: async () => undefined } as any;
  const input = {
    entityType: 'SalesOrder',
    entityId: 'so-1',
    actionType: 'SUBMIT',
    requestedById: 'u1',
    requestTitle: 'Confirm order',
  };

  it('stores the derived party when a PartyExistsService is provided', async () => {
    const prisma = enginePrisma();
    const partyExists = {
      partyOfEntity: jest.fn(async () => ({
        partyType: 'CUSTOMER',
        supplierId: null,
        customerId: 'cus-1',
      })),
    } as any;
    const svc = new ApprovalEngineService(prisma, audit, notifications, partyExists);
    const request = await svc.createApprovalRequest(input);
    expect(partyExists.partyOfEntity).toHaveBeenCalledWith('SalesOrder', 'so-1');
    expect(prisma.approvalRequest.create.mock.calls[0][0].data).toMatchObject({
      partyType: 'CUSTOMER',
      supplierId: null,
      customerId: 'cus-1',
      status: 'PENDING',
    });
    expect(request).toMatchObject({ id: 'req-9', customerId: 'cus-1' });
  });

  it('leaves the party columns to their defaults without the resolver', async () => {
    const prisma = enginePrisma();
    const svc = new ApprovalEngineService(prisma, audit, notifications);
    await svc.createApprovalRequest(input);
    expect(prisma.approvalRequest.create.mock.calls[0][0].data).not.toHaveProperty('partyType');
  });
});
