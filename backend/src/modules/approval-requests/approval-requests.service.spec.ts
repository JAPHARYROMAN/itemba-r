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
  it('returns approvals/workflow/data-quality readiness above the 90% threshold', async () => {
    const prisma = makePrisma();
    const service = new ApprovalRequestsService(prisma, { log: jest.fn() } as any);

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
    const service = new ApprovalRequestsService(prisma, { log: jest.fn() } as any);

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
