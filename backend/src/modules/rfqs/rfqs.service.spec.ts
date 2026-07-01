import { BadRequestException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { RfqsService } from './rfqs.service';

function makeService() {
  const prisma = {
    // Mirror the real $transaction contract: run the callback with a tx client.
    $transaction: jest.fn(async (fn: any) => fn(prisma)),
    requestForQuotation: {
      create: jest.fn(async ({ data }: any) => ({ id: 'rfq-1', ...data, rfqSuppliers: [] })),
    },
  } as any;
  const auditLogs = { log: jest.fn().mockResolvedValue(undefined) } as any;
  const codes = { next: jest.fn().mockResolvedValue('RFQ-2026-00001') } as any;

  const service = new RfqsService(prisma, auditLogs, codes);
  return { service, prisma, auditLogs, codes };
}

const user = { id: 'user-1' } as any;

function createDto(extra: Record<string, unknown> = {}) {
  return {
    companyId: 'company-1',
    title: 'Cement supply RFQ',
    ...extra,
  } as any;
}

function p2002() {
  return new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
    code: 'P2002',
    clientVersion: 'test',
  });
}

describe('RfqsService.create rfqNumber generation', () => {
  it('server-generates a company-scoped rfqNumber inside a transaction', async () => {
    const { service, prisma, codes } = makeService();

    const item = await service.create(createDto(), user);

    expect(codes.next).toHaveBeenCalledWith(
      expect.objectContaining({ entityType: 'RFQ', companyId: 'company-1' }),
    );
    // The generation shares the surrounding transaction (tx passed through).
    expect(codes.next.mock.calls[0][0]).toHaveProperty('tx');
    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    expect(prisma.requestForQuotation.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          rfqNumber: 'RFQ-2026-00001',
          companyId: 'company-1',
          status: 'DRAFT',
          createdById: 'user-1',
        }),
      }),
    );
    expect(item.rfqNumber).toBe('RFQ-2026-00001');
  });

  it('prefers a caller-provided rfqNumber and does not generate one (backward-compat)', async () => {
    const { service, prisma, codes } = makeService();

    await service.create(createDto({ rfqNumber: 'RFQ-CUSTOM-1' }), user);

    expect(codes.next).not.toHaveBeenCalled();
    expect(prisma.requestForQuotation.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ rfqNumber: 'RFQ-CUSTOM-1' }),
      }),
    );
  });

  it('nests supplier rows from rfqSuppliers or the suppliers alias', async () => {
    const { service, prisma } = makeService();

    await service.create(
      createDto({ suppliers: [{ supplierId: 'sup-1' }] }),
      user,
    );

    expect(prisma.requestForQuotation.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          rfqSuppliers: { create: [{ supplierId: 'sup-1' }] },
        }),
      }),
    );
  });

  it('retries with a fresh generated number on a unique collision', async () => {
    const { service, prisma, codes } = makeService();
    codes.next
      .mockResolvedValueOnce('RFQ-2026-00001')
      .mockResolvedValueOnce('RFQ-2026-00002');
    prisma.requestForQuotation.create
      .mockRejectedValueOnce(p2002())
      .mockImplementationOnce(async ({ data }: any) => ({ id: 'rfq-1', ...data, rfqSuppliers: [] }));

    const item = await service.create(createDto(), user);

    expect(codes.next).toHaveBeenCalledTimes(2);
    expect(item.rfqNumber).toBe('RFQ-2026-00002');
  });

  it('surfaces a 400 when a caller-provided rfqNumber collides (no retry)', async () => {
    const { service, prisma, codes } = makeService();
    prisma.requestForQuotation.create.mockRejectedValueOnce(p2002());

    await expect(
      service.create(createDto({ rfqNumber: 'RFQ-DUP' }), user),
    ).rejects.toThrow(BadRequestException);
    // A supplied number is never retried.
    expect(prisma.requestForQuotation.create).toHaveBeenCalledTimes(1);
    expect(codes.next).not.toHaveBeenCalled();
  });

  it('rejects a create without companyId', async () => {
    const { service, prisma } = makeService();

    await expect(service.create({ title: 'no company' } as any, user)).rejects.toThrow(
      'companyId is required',
    );
    expect(prisma.requestForQuotation.create).not.toHaveBeenCalled();
  });
});
