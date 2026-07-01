import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { AccessLevel, Prisma } from '@prisma/client';
import { RfqsService } from './rfqs.service';

function makeService() {
  const prisma = {
    // Mirror the real $transaction contract: run the callback with a tx client.
    $transaction: jest.fn(async (fn: any) => fn(prisma)),
    requestForQuotation: {
      create: jest.fn(async ({ data }: any) => ({ id: 'rfq-1', ...data, rfqSuppliers: [] })),
      findFirst: jest.fn(),
      update: jest.fn(async ({ data }: any) => ({ id: 'rfq-1', ...data })),
    },
  } as any;
  const auditLogs = { log: jest.fn().mockResolvedValue(undefined) } as any;
  const codes = { next: jest.fn().mockResolvedValue('RFQ-2026-00001') } as any;
  const companyScope = {
    assertCanAccessCompany: jest.fn().mockResolvedValue(undefined),
  } as any;

  const service = new RfqsService(prisma, auditLogs, codes, companyScope);
  return { service, prisma, auditLogs, codes, companyScope };
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

  it('rejects a create when the user lacks WRITE access to the target company', async () => {
    const { service, prisma, companyScope } = makeService();
    companyScope.assertCanAccessCompany.mockRejectedValueOnce(
      new ForbiddenException('You do not have access to this company'),
    );

    await expect(service.create(createDto(), user)).rejects.toThrow(ForbiddenException);
    expect(companyScope.assertCanAccessCompany).toHaveBeenCalledWith(
      user,
      'company-1',
      AccessLevel.WRITE,
    );
    expect(prisma.requestForQuotation.create).not.toHaveBeenCalled();
  });
});

describe('RfqsService company scoping', () => {
  it('findOne enforces company access on the fetched record', async () => {
    const { service, prisma, companyScope } = makeService();
    prisma.requestForQuotation.findFirst.mockResolvedValueOnce({
      id: 'rfq-1',
      companyId: 'company-2',
      rfqSuppliers: [],
    });
    companyScope.assertCanAccessCompany.mockRejectedValueOnce(
      new ForbiddenException('You do not have access to this company'),
    );

    await expect(service.findOne('rfq-1', user)).rejects.toThrow(ForbiddenException);
    expect(companyScope.assertCanAccessCompany).toHaveBeenCalledWith(
      user,
      'company-2',
      AccessLevel.READ,
    );
  });

  it('findOne returns the record for an authorized user', async () => {
    const { service, prisma, companyScope } = makeService();
    const record = { id: 'rfq-1', companyId: 'company-1', rfqSuppliers: [] };
    prisma.requestForQuotation.findFirst.mockResolvedValueOnce(record);

    await expect(service.findOne('rfq-1', user)).resolves.toBe(record);
    expect(companyScope.assertCanAccessCompany).toHaveBeenCalledWith(
      user,
      'company-1',
      AccessLevel.READ,
    );
  });

  it('findOne throws NotFound (and skips the scope check) when no record exists', async () => {
    const { service, prisma, companyScope } = makeService();
    prisma.requestForQuotation.findFirst.mockResolvedValueOnce(null);

    await expect(service.findOne('missing', user)).rejects.toThrow(NotFoundException);
    expect(companyScope.assertCanAccessCompany).not.toHaveBeenCalled();
  });

  it('update requires WRITE access to the record company', async () => {
    const { service, prisma, companyScope } = makeService();
    prisma.requestForQuotation.findFirst.mockResolvedValueOnce({
      id: 'rfq-1',
      companyId: 'company-2',
      rfqSuppliers: [],
    });
    companyScope.assertCanAccessCompany.mockRejectedValueOnce(
      new ForbiddenException('You do not have access to this company'),
    );

    await expect(service.update('rfq-1', { title: 'x' }, user)).rejects.toThrow(
      ForbiddenException,
    );
    expect(companyScope.assertCanAccessCompany).toHaveBeenCalledWith(
      user,
      'company-2',
      AccessLevel.WRITE,
    );
    expect(prisma.requestForQuotation.update).not.toHaveBeenCalled();
  });

  it('update rejects a companyId change (cross-tenant reassignment)', async () => {
    const { service, prisma } = makeService();
    prisma.requestForQuotation.findFirst.mockResolvedValueOnce({
      id: 'rfq-1',
      companyId: 'company-1',
      rfqSuppliers: [],
    });

    await expect(
      service.update('rfq-1', { companyId: 'company-2', title: 'x' }, user),
    ).rejects.toThrow(BadRequestException);
    expect(prisma.requestForQuotation.update).not.toHaveBeenCalled();
  });

  it('update whitelists mutable columns and drops privileged/immutable fields', async () => {
    const { service, prisma } = makeService();
    prisma.requestForQuotation.findFirst.mockResolvedValueOnce({
      id: 'rfq-1',
      companyId: 'company-1',
      rfqSuppliers: [],
    });

    await service.update(
      'rfq-1',
      {
        // editable
        title: 'Updated title',
        notes: 'note',
        // matching companyId is allowed (no-op) and must not be persisted
        companyId: 'company-1',
        // privileged / immutable — must be stripped
        status: 'SENT',
        createdById: 'attacker',
        rfqNumber: 'RFQ-HACK',
        awardedSupplierId: 'sup-x',
        id: 'rfq-2',
      } as any,
      user,
    );

    expect(prisma.requestForQuotation.update).toHaveBeenCalledWith({
      where: { id: 'rfq-1' },
      data: { title: 'Updated title', notes: 'note' },
    });
  });

  it('send requires WRITE access to the record company', async () => {
    const { service, prisma, companyScope } = makeService();
    prisma.requestForQuotation.findFirst.mockResolvedValueOnce({
      id: 'rfq-1',
      companyId: 'company-2',
      status: 'DRAFT',
      rfqSuppliers: [],
    });
    companyScope.assertCanAccessCompany.mockRejectedValueOnce(
      new ForbiddenException('You do not have access to this company'),
    );

    await expect(service.send('rfq-1', {}, user)).rejects.toThrow(ForbiddenException);
    expect(companyScope.assertCanAccessCompany).toHaveBeenCalledWith(
      user,
      'company-2',
      AccessLevel.WRITE,
    );
    expect(prisma.requestForQuotation.update).not.toHaveBeenCalled();
  });
});
