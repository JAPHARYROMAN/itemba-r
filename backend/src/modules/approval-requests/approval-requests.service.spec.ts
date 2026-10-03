import { ApprovalRequestsService } from './approval-requests.service';

function makePrisma(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    approvalWorkflow: {
      count: jest.fn().mockResolvedValueOnce(4).mockResolvedValueOnce(1).mockResolvedValueOnce(0),
    },
    approvalStep: { count: jest.fn().mockResolvedValue(8) },
    approvalRequest: {
      count: jest
        .fn()
        .mockResolvedValueOnce(20)
        .mockResolvedValueOnce(3)
        .mockResolvedValueOnce(0)
        .mockResolvedValueOnce(12)
        .mockResolvedValueOnce(1)
        .mockResolvedValueOnce(0),
      groupBy: jest.fn().mockResolvedValue([{ status: 'APPROVED', _count: { _all: 12 } }]),
    },
    approvalAction: { count: jest.fn().mockResolvedValue(30) },
    approvalAttachment: { count: jest.fn().mockResolvedValue(6) },
    approvalDelegation: { count: jest.fn().mockResolvedValue(2) },
    dataQualityIssue: {
      count: jest
        .fn()
        .mockResolvedValueOnce(4)
        .mockResolvedValueOnce(0)
        .mockResolvedValueOnce(0)
        .mockResolvedValueOnce(0)
        .mockResolvedValueOnce(2),
      groupBy: jest.fn().mockResolvedValue([{ status: 'RESOLVED', _count: { _all: 2 } }]),
    },
    ...overrides,
  } as any;
}

describe('ApprovalRequestsService readiness', () => {
  it('applies the selected company to checks, actions, attachments and status counts', async () => {
    const prisma = makePrisma();
    const service = new ApprovalRequestsService(
      prisma,
      { log: jest.fn() } as any,
      {} as any,
      { assertParty: jest.fn() } as any,
    );
    await service.getReadiness({ id: 'user', companyId: 'company-1' }, { companyId: 'company-1' });
    for (const model of [
      prisma.approvalWorkflow,
      prisma.approvalRequest,
      prisma.approvalDelegation,
      prisma.dataQualityIssue,
    ]) {
      for (const [args] of model.count.mock.calls) expect(args.where.companyId).toBe('company-1');
    }
    expect(prisma.approvalStep.count).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          workflow: expect.objectContaining({ companyId: 'company-1' }),
        }),
      }),
    );
    for (const model of [prisma.approvalAction, prisma.approvalAttachment])
      expect(model.count).toHaveBeenCalledWith({
        where: { approvalRequest: { deletedAt: null, companyId: 'company-1' } },
      });
    expect(prisma.approvalRequest.groupBy.mock.calls[0][0].where.companyId).toBe('company-1');
    expect(prisma.dataQualityIssue.groupBy.mock.calls[0][0].where.companyId).toBe('company-1');
  });

  it('denies an inaccessible selected company before any readiness read', async () => {
    const prisma = makePrisma();
    const service = new ApprovalRequestsService(
      prisma,
      { log: jest.fn() } as any,
      {} as any,
      { assertParty: jest.fn() } as any,
    );
    await expect(
      service.getReadiness({ id: 'user', companyId: 'company-1' }, { companyId: 'outside' }),
    ).rejects.toThrow('You do not have access');
    expect(prisma.approvalWorkflow.count).not.toHaveBeenCalled();
    expect(prisma.approvalRequest.count).not.toHaveBeenCalled();
    expect(prisma.dataQualityIssue.count).not.toHaveBeenCalled();
  });

  it('returns approvals/workflow/data-quality readiness above the 90% threshold', async () => {
    const prisma = makePrisma();
    const service = new ApprovalRequestsService(
      prisma,
      { log: jest.fn() } as any,
      { assertCanAccessCompany: jest.fn() } as any,
      { assertParty: jest.fn() } as any,
    );

    const readiness = await service.getReadiness(
      { id: 'user-1', companyId: 'company-1' },
      { companyId: 'company-1' },
    );

    expect(readiness.score).toBeGreaterThanOrEqual(90);
    expect(readiness.status).toBe('READY');
    expect(readiness.target).toBe(90);
    expect(readiness.checks).toHaveLength(6);
    expect(readiness.indicators.activeWorkflows).toBe(4);
    expect(readiness.indicators.openDataQualityIssues).toBe(4);
  });

  it('marks readiness critical when active workflows have no approver steps', async () => {
    const prisma = makePrisma({
      approvalWorkflow: {
        count: jest.fn().mockResolvedValueOnce(4).mockResolvedValueOnce(1).mockResolvedValueOnce(2),
      },
    });
    const service = new ApprovalRequestsService(
      prisma,
      { log: jest.fn() } as any,
      { assertCanAccessCompany: jest.fn() } as any,
      { assertParty: jest.fn() } as any,
    );

    const readiness = await service.getReadiness(
      { id: 'user-1', companyId: 'company-1' },
      { companyId: 'company-1' },
    );

    expect(readiness.status).toBe('CRITICAL');
    expect(readiness.checks.find((check) => check.key === 'workflow-coverage')?.status).toBe(
      'CRITICAL',
    );
  });
});

/** Party linkage, Phase 3 PR-5: approvals carry the party and every read includes it. */
describe('ApprovalRequestsService party', () => {
  const partyExists = {
    assertParty: jest.fn(),
    partyOfEntity: jest.fn(async () => ({
      partyType: 'SUPPLIER',
      supplierId: 'sup-1',
      customerId: null,
    })),
  };
  function partyService(prisma: any) {
    return new ApprovalRequestsService(
      prisma,
      { log: jest.fn() } as any,
      { assertCanAccessCompany: jest.fn() } as any,
      partyExists as any,
    );
  }

  it('stores the party derived from the document on create', async () => {
    const prisma: any = {
      approvalRequest: { create: jest.fn(async ({ data }: any) => ({ id: 'req-1', ...data })) },
    };
    const service = partyService(prisma);
    const created = await service.create(
      { entityType: 'Payable', entityId: 'pay-1', requestTitle: 'Pay it', companyId: 'c1' } as any,
      { id: 'u1' },
    );
    expect(partyExists.partyOfEntity).toHaveBeenCalledWith('Payable', 'pay-1');
    expect(prisma.approvalRequest.create.mock.calls[0][0].data).toMatchObject({
      entityType: 'Payable',
      entityId: 'pay-1',
      partyType: 'SUPPLIER',
      supplierId: 'sup-1',
      customerId: null,
    });
    expect(created).toMatchObject({ partyType: 'SUPPLIER', supplierId: 'sup-1' });
  });

  it('includes the supplier and customer on the detail read', async () => {
    const prisma: any = {
      approvalRequest: {
        findFirst: jest.fn(async () => ({
          id: 'req-1',
          companyId: 'c1',
          partyType: 'SUPPLIER',
          supplierId: 'sup-1',
          supplier: { id: 'sup-1', name: 'Mwanjalisi', supplierCode: 'SUP-1' },
          customer: null,
        })),
      },
    };
    const service = partyService(prisma);
    const record = await service.findOne('req-1', { id: 'u1' } as any);
    expect(prisma.approvalRequest.findFirst.mock.calls[0][0].include).toMatchObject({
      supplier: { select: { id: true, name: true, supplierCode: true } },
      customer: { select: { id: true, name: true, customerCode: true } },
    });
    expect(record.supplier).toEqual({ id: 'sup-1', name: 'Mwanjalisi', supplierCode: 'SUP-1' });
  });
});
