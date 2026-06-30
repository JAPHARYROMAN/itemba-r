import { Prisma } from '@prisma/client';
import { ExternalPaymentsService } from './external-payments.service';

function makeService() {
  const prisma = {
    externalPayment: {
      findFirst: jest.fn(),
      create: jest.fn(),
    },
  } as any;
  const auditLogs = { log: jest.fn().mockResolvedValue(undefined) } as any;
  const companyScope = {
    assertCanAccessCompany: jest.fn().mockResolvedValue(undefined),
  } as any;
  const service = new ExternalPaymentsService(prisma, auditLogs, companyScope);
  return { service, prisma, auditLogs };
}

const baseDto = {
  companyId: 'company-1',
  amount: 1000,
  idempotencyKey: 'idem-1',
} as any;

function p2002() {
  return new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
    code: 'P2002',
    clientVersion: 'test',
  });
}

describe('ExternalPaymentsService idempotency (ITMB-AUDIT-31)', () => {
  it('returns the existing row when the idempotency key already resolves (replay)', async () => {
    const { service, prisma } = makeService();
    const existing = { id: 'pay-1', companyId: 'company-1' };
    prisma.externalPayment.findFirst.mockResolvedValueOnce(existing);

    const result = await service.createForCompany(baseDto, 'actor-1', 'company-1');

    expect(result).toBe(existing);
    expect(prisma.externalPayment.create).not.toHaveBeenCalled();
  });

  it('replays the winning row when create loses the unique-index race (P2002 fallback)', async () => {
    const { service, prisma } = makeService();
    const winner = { id: 'pay-winner', companyId: 'company-1' };
    // 1st replay: nothing committed yet → null. create() then throws P2002.
    // 2nd replay (post-P2002): the winner row is now visible.
    prisma.externalPayment.findFirst
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(winner);
    prisma.externalPayment.create.mockRejectedValueOnce(p2002());

    const result = await service.createForCompany(baseDto, 'actor-1', 'company-1');

    expect(result).toBe(winner);
    expect(prisma.externalPayment.create).toHaveBeenCalledTimes(1);
    expect(prisma.externalPayment.findFirst).toHaveBeenCalledTimes(2);
  });

  it('rethrows a P2002 that has no replayable winner', async () => {
    const { service, prisma } = makeService();
    prisma.externalPayment.findFirst.mockResolvedValue(null);
    prisma.externalPayment.create.mockRejectedValueOnce(p2002());

    await expect(
      service.createForCompany(baseDto, 'actor-1', 'company-1'),
    ).rejects.toBeInstanceOf(Prisma.PrismaClientKnownRequestError);
  });

  it('does not run the P2002 replay when no idempotency key was supplied', async () => {
    const { service, prisma } = makeService();
    prisma.externalPayment.create.mockRejectedValueOnce(p2002());

    await expect(
      service.createForCompany({ companyId: 'company-1', amount: 5 } as any, 'actor-1', 'company-1'),
    ).rejects.toBeInstanceOf(Prisma.PrismaClientKnownRequestError);
    // no idempotencyKey → no pre-check and no post-failure replay lookups
    expect(prisma.externalPayment.findFirst).not.toHaveBeenCalled();
  });

  it('creates and audits a fresh payment on the happy path', async () => {
    const { service, prisma, auditLogs } = makeService();
    const created = { id: 'pay-new', companyId: 'company-1' };
    prisma.externalPayment.findFirst.mockResolvedValueOnce(null);
    prisma.externalPayment.create.mockResolvedValueOnce(created);

    const result = await service.createForCompany(baseDto, 'actor-1', 'company-1');

    expect(result).toBe(created);
    expect(prisma.externalPayment.create).toHaveBeenCalledTimes(1);
    expect(auditLogs.log).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'EXTERNAL_PAYMENT_CREATED' }),
    );
  });
});
