import { CustomerPriceAgreementsService } from './customer-price-agreements.service';

function makeService(overrides: { approvedAt?: Date | null } = {}) {
  const agreement = {
    id: 'agreement-1',
    companyId: 'company-1',
    customerId: 'customer-1',
    status: 'ACTIVE',
    approvedAt: overrides.approvedAt ?? null,
    approvedById: overrides.approvedAt ? 'approver-1' : null,
    notes: 'Original notes',
    deletedAt: null,
  };
  const prisma = {
    customerPriceAgreement: {
      findFirst: jest.fn().mockResolvedValue(agreement),
      update: jest.fn(async ({ data }: any) => ({ ...agreement, ...data })),
    },
  } as any;
  const auditLogs = { log: jest.fn().mockResolvedValue(undefined) } as any;
  const service = new CustomerPriceAgreementsService(prisma, auditLogs);
  return { service, prisma, auditLogs, agreement };
}

const userId = 'user-1';

describe('CustomerPriceAgreementsService post-approval guard', () => {
  it('rejects updating an approved agreement', async () => {
    const { service, prisma } = makeService({ approvedAt: new Date() });

    await expect(
      service.update('agreement-1', { notes: 'Changed after approval' } as any, userId),
    ).rejects.toThrow('Approved customer price agreements cannot be edited');
    expect(prisma.customerPriceAgreement.update).not.toHaveBeenCalled();
  });

  it('allows updating an unapproved agreement', async () => {
    const { service, prisma } = makeService({ approvedAt: null });

    const result = await service.update('agreement-1', { notes: 'Updated notes' } as any, userId);

    expect(prisma.customerPriceAgreement.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'agreement-1' },
        data: expect.objectContaining({ notes: 'Updated notes' }),
      }),
    );
    expect(result.notes).toBe('Updated notes');
  });

  it('rejects deleting an approved agreement', async () => {
    const { service, prisma } = makeService({ approvedAt: new Date() });

    await expect(service.remove('agreement-1', userId)).rejects.toThrow(
      'Approved customer price agreements cannot be deleted',
    );
    expect(prisma.customerPriceAgreement.update).not.toHaveBeenCalled();
  });

  it('allows deleting an unapproved agreement', async () => {
    const { service, prisma } = makeService({ approvedAt: null });

    const result = await service.remove('agreement-1', userId);

    expect(prisma.customerPriceAgreement.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'agreement-1' },
        data: expect.objectContaining({ deletedAt: expect.any(Date) }),
      }),
    );
    expect(result).toEqual({ success: true });
  });
});
