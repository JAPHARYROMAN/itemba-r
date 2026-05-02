import { SupportService } from './support.service';

function makePrisma() {
  const supportTicket = {
    count: jest.fn(async ({ where }: any) => {
      if (where.OR) return 1;
      if (where.assignedToId === null) return 2;
      if (where.status === 'OPEN') return 5;
      if (where.status === 'IN_PROGRESS') return 3;
      if (where.status === 'WAITING_USER') return 2;
      if (where.status === 'RESOLVED') return 4;
      if (where.status === 'CLOSED') return 1;
      if (where.priority === 'URGENT') return 2;
      return 20;
    }),
    groupBy: jest
      .fn()
      .mockResolvedValueOnce([
        { status: 'OPEN', _count: { _all: 5 } },
        { status: 'IN_PROGRESS', _count: { _all: 3 } },
      ])
      .mockResolvedValueOnce([
        { priority: 'URGENT', _count: { _all: 2 } },
        { priority: 'NORMAL', _count: { _all: 10 } },
      ])
      .mockResolvedValueOnce([{ ticketType: 'BUG', _count: { _all: 4 } }])
      .mockResolvedValueOnce([
        { moduleName: 'finance', _count: { _all: 7 } },
        { moduleName: null, _count: { _all: 2 } },
      ]),
    findMany: jest
      .fn()
      .mockResolvedValueOnce([{ id: 'recent-ticket', ticketNumber: 'ST-1' }])
      .mockResolvedValueOnce([{ id: 'old-ticket', ticketNumber: 'ST-2' }])
      .mockResolvedValueOnce([
        {
          createdAt: new Date('2026-05-01T00:00:00Z'),
          resolvedAt: new Date('2026-05-01T04:00:00Z'),
        },
        {
          createdAt: new Date('2026-05-01T00:00:00Z'),
          resolvedAt: new Date('2026-05-01T20:00:00Z'),
        },
      ]),
  };

  return { supportTicket } as any;
}

describe('SupportService feature breadth summary', () => {
  it('returns backlog, SLA, activity, and resolution metrics', async () => {
    const prisma = makePrisma();
    const companyScope = {
      companyWhereFor: jest.fn().mockResolvedValue({ companyId: 'company-1' }),
    };
    const service = new SupportService(prisma, companyScope as any);

    const result = await service.getSummary({ companyId: 'company-1' }, { id: 'user-1' } as any);

    expect(result).toEqual(
      expect.objectContaining({
        totalTickets: 20,
        openTickets: 5,
        inProgressTickets: 3,
        waitingUserTickets: 2,
        unresolvedTickets: 10,
        urgentTickets: 2,
        unassignedTickets: 2,
        overdueTickets: 1,
        averageResolutionHours: 12,
      }),
    );
    expect(result.serviceLevel).toEqual({ activeWithinSla: 9, overdueTickets: 1, overdueRate: 10 });
    expect(result.backlogByStatus).toEqual({ OPEN: 5, IN_PROGRESS: 3 });
    expect(result.backlogByModule).toEqual({ finance: 7, UNASSIGNED: 2 });
    expect(result.recentTickets).toEqual([{ id: 'recent-ticket', ticketNumber: 'ST-1' }]);
    expect(result.oldestActiveTickets).toEqual([{ id: 'old-ticket', ticketNumber: 'ST-2' }]);
    expect(prisma.supportTicket.groupBy).toHaveBeenCalledTimes(4);
    expect(companyScope.companyWhereFor).toHaveBeenCalledWith({ id: 'user-1' }, 'company-1');
  });
});
