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
