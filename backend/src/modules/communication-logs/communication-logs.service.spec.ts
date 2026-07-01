import { NotFoundException } from '@nestjs/common';
import { CommunicationLogsService } from './communication-logs.service';

const user = { id: 'user-1', companyId: 'company-1' } as any;

function makeService(opts: { existing?: any } = {}) {
  const createdRows: any[] = [];
  const updatedRows: any[] = [];

  const prisma = {
    communicationLog: {
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
    },
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
      expect(codes.next).toHaveBeenCalledWith({
        entityType: 'CommunicationLog',
        companyId: 'company-1',
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
