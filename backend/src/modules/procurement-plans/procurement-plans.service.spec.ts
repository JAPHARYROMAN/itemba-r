import { ProcurementPlansService } from './procurement-plans.service';

function makeService(overrides: { status?: string } = {}) {
  const plan = {
    id: 'plan-1',
    companyId: 'company-1',
    status: overrides.status ?? 'DRAFT',
    createdById: 'user-1',
    description: 'Original description',
    lines: [],
  };
  const prisma = {
    procurementPlan: {
      findFirst: jest.fn().mockResolvedValue(plan),
      update: jest.fn(async ({ data }: any) => ({ ...plan, ...data })),
    },
  } as any;
  const auditLogs = { log: jest.fn().mockResolvedValue(undefined) } as any;
  const service = new ProcurementPlansService(prisma, auditLogs);
  return { service, prisma, auditLogs, plan };
}

const user = { id: 'user-1' } as any;

describe('ProcurementPlansService update guard', () => {
  it('rejects updating a non-DRAFT plan', async () => {
    const { service, prisma } = makeService({ status: 'APPROVED' });

    await expect(
      service.update('plan-1', { description: 'Changed after approval' }, user),
    ).rejects.toThrow('Only DRAFT plans can be edited');
    expect(prisma.procurementPlan.update).not.toHaveBeenCalled();
  });

  it('allows updating a DRAFT plan', async () => {
    const { service, prisma } = makeService({ status: 'DRAFT' });

    const result = await service.update('plan-1', { description: 'Updated description' }, user);

    expect(prisma.procurementPlan.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'plan-1' },
        data: expect.objectContaining({ description: 'Updated description' }),
      }),
    );
    expect(result.description).toBe('Updated description');
  });
});
