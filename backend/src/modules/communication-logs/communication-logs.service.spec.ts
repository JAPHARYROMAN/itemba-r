import { NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { CommunicationLogsService } from './communication-logs.service';

const user = { id: 'user-1', companyId: 'company-1' } as any;

function makeService(opts: { existing?: any } = {}) {
  const createdRows: any[] = [];
  const updatedRows: any[] = [];

  const communicationLog = {
    findMany: jest.fn().mockResolvedValue([{ id: 'log-1' }]),
    count: jest.fn().mockResolvedValue(1),
    findFirst: jest.fn().mockResolvedValue(opts.existing ?? null),
    create: jest.fn(async ({ data }: any) => {
      const row = { id: 'log-1', ...data };
      createdRows.push(row);
      return row;
    }),
    update: jest.fn(async ({ where, data }: any) => {
      const row = { id: where.id, ...data };
      updatedRows.push({ where, data });
      return row;
    }),
  };

  const prisma = {
    communicationLog,
    // create() runs inside a $transaction; run the callback against a tx client
    // that shares the same communicationLog mock.
    $transaction: jest.fn(async (fn: any) => fn({ communicationLog })),
  } as any;

  const auditLogs = { log: jest.fn().mockResolvedValue(undefined) } as any;
  const codes = { next: jest.fn().mockResolvedValue('COMMUN-2026-00001') } as any;

  const service = new CommunicationLogsService(prisma, auditLogs, codes);
  return { service, prisma, auditLogs, codes, createdRows, updatedRows };
}

describe('CommunicationLogsService', () => {
  describe('findAll', () => {
    it('returns the { data, total, page, limit } envelope (not { items })', async () => {
      const { service } = makeService();
      const result = await service.findAll({ companyId: 'company-1', page: 2, limit: 10 }, user);
      expect(result).toEqual({
        data: [{ id: 'log-1' }],
        total: 1,
        page: 2,
        limit: 10,
      });
      // Guard against a regression back to the `items` key the frontend can't read.
      expect((result as any).items).toBeUndefined();
    });
  });

  describe('create', () => {
    it('generates a communicationNumber server-side and persists it', async () => {
      const { service, prisma, codes } = makeService();
      await service.create(
        {
          companyId: 'company-1',
          entityType: 'CUSTOMER' as any,
          entityId: 'cust-1',
          communicationType: 'PHONE_CALL' as any,
          summary: 'Called about invoice',
        },
        user,
      );
      // Number is drawn from the GLOBAL counter (companyId omitted) because
      // communicationNumber is globally @unique — a per-company counter would
      // collide across tenants. A tx client is threaded through for atomicity.
      expect(codes.next).toHaveBeenCalledWith({
        entityType: 'CommunicationLog',
        tx: expect.anything(),
      });
      const data = prisma.communicationLog.create.mock.calls[0][0].data;
      expect(data.communicationNumber).toBe('COMMUN-2026-00001');
      expect(data.status).toBe('OPEN');
      expect(data.createdById).toBe('user-1');
      expect(data.companyId).toBe('company-1');
      expect(data.summary).toBe('Called about invoice');
    });

    it('does not let the client override communicationNumber/status/createdById via extra fields', async () => {
      const { service, prisma } = makeService();
      await service.create(
        {
          companyId: 'company-1',
          entityType: 'CUSTOMER' as any,
          entityId: 'cust-1',
          communicationType: 'EMAIL' as any,
          summary: 'x',
          // Fields not on the DTO would be stripped by ValidationPipe in prod;
          // the service also ignores them because it maps fields explicitly.
          communicationNumber: 'HACK',
          status: 'CLOSED',
          createdById: 'someone-else',
        } as any,
        user,
      );
      const data = prisma.communicationLog.create.mock.calls[0][0].data;
      expect(data.communicationNumber).toBe('COMMUN-2026-00001');
      expect(data.status).toBe('OPEN');
      expect(data.createdById).toBe('user-1');
    });

    it('gives two different companies distinct communicationNumbers (global uniqueness)', async () => {
      const { service, prisma, codes } = makeService();
      // A single GLOBAL counter serves every company, so consecutive creates —
      // even across companies — advance the same sequence and never collide on
      // the globally-@unique communicationNumber column.
      codes.next
        .mockResolvedValueOnce('COMMUN-2026-00001')
        .mockResolvedValueOnce('COMMUN-2026-00002');

      const base = {
        entityType: 'CUSTOMER' as any,
        entityId: 'cust-1',
        communicationType: 'PHONE_CALL' as any,
        summary: 's',
      };
      await service.create({ companyId: 'company-1', ...base }, user);
      await service.create({ companyId: 'company-2', ...base }, user);

      const first = prisma.communicationLog.create.mock.calls[0][0].data;
      const second = prisma.communicationLog.create.mock.calls[1][0].data;
      expect(first.companyId).toBe('company-1');
      expect(second.companyId).toBe('company-2');
      expect(first.communicationNumber).toBe('COMMUN-2026-00001');
      expect(second.communicationNumber).toBe('COMMUN-2026-00002');
      expect(first.communicationNumber).not.toBe(second.communicationNumber);
      // Never scoped by company: the counter is drawn globally.
      for (const call of codes.next.mock.calls) {
        expect(call[0].companyId).toBeUndefined();
      }
    });

    it('retries on a P2002 unique-collision and succeeds with a fresh number', async () => {
      const { service, prisma, codes } = makeService();
      codes.next
        .mockResolvedValueOnce('COMMUN-2026-00001')
        .mockResolvedValueOnce('COMMUN-2026-00002');
      const p2002 = new Prisma.PrismaClientKnownRequestError('dup', {
        code: 'P2002',
        clientVersion: 'test',
      });
      prisma.communicationLog.create
        .mockRejectedValueOnce(p2002)
        .mockImplementationOnce(async ({ data }: any) => ({ id: 'log-1', ...data }));

      const result = await service.create(
        {
          companyId: 'company-1',
          entityType: 'CUSTOMER' as any,
          entityId: 'cust-1',
          communicationType: 'EMAIL' as any,
          summary: 'x',
        },
        user,
      );

      expect(prisma.communicationLog.create).toHaveBeenCalledTimes(2);
      expect((result as any).communicationNumber).toBe('COMMUN-2026-00002');
    });
  });

  describe('update', () => {
    it('throws NotFound when the record is missing', async () => {
      const { service } = makeService({ existing: null });
      await expect(service.update('log-1', { summary: 'y' }, user)).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });

    it('only writes the fields provided and never companyId/entityType', async () => {
      const { service, prisma } = makeService({
        existing: { id: 'log-1', companyId: 'company-1', summary: 'old' },
      });
      await service.update('log-1', { summary: 'new', status: 'CLOSED' as any }, user);
      const data = prisma.communicationLog.update.mock.calls[0][0].data;
      expect(data).toEqual({ summary: 'new', status: 'CLOSED' });
      expect(data.companyId).toBeUndefined();
      expect(data.entityType).toBeUndefined();
    });
  });
});
