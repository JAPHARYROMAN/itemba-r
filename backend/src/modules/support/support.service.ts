import { Injectable } from '@nestjs/common';
import { SupportTicketPriority, SupportTicketStatus } from '@prisma/client';
import { AuthUser } from '../../common/decorators/current-user.decorator';
import { CompanyScopeService } from '../../common/services';
import { PrismaService } from '../../prisma/prisma.service';

type GroupCount = { _count: { _all: number } } & Record<string, unknown>;

const ACTIVE_STATUSES = [
  SupportTicketStatus.OPEN,
  SupportTicketStatus.IN_PROGRESS,
  SupportTicketStatus.WAITING_USER,
];

@Injectable()
export class SupportService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly companyScope: CompanyScopeService,
  ) {}

  async getSummary(query: any = {}, user: AuthUser) {
    const { companyId } = query;
    const todayStart = startOfDay(new Date());
    const slaCutoffs = prioritySlaCutoffs(new Date());
    const baseWhere: any = {
      deletedAt: null,
      ...((await this.companyScope.companyWhereFor(user, companyId)) as any),
    };

    const [
      totalTickets,
      openTickets,
      inProgressTickets,
      waitingUserTickets,
      urgentTickets,
      resolvedToday,
      closedToday,
      unassignedTickets,
      overdueTickets,
      statusRows,
      priorityRows,
      typeRows,
      moduleRows,
      recentTickets,
      oldestActiveTickets,
      recentResolvedTickets,
    ] = await Promise.all([
      this.prisma.supportTicket.count({ where: baseWhere }),
      this.prisma.supportTicket.count({
        where: { ...baseWhere, status: SupportTicketStatus.OPEN },
      }),
      this.prisma.supportTicket.count({
        where: { ...baseWhere, status: SupportTicketStatus.IN_PROGRESS },
      }),
      this.prisma.supportTicket.count({
        where: { ...baseWhere, status: SupportTicketStatus.WAITING_USER },
      }),
      this.prisma.supportTicket.count({
        where: {
          ...baseWhere,
          status: { in: ACTIVE_STATUSES },
          priority: SupportTicketPriority.URGENT,
        },
      }),
      this.prisma.supportTicket.count({
        where: {
          ...baseWhere,
          status: SupportTicketStatus.RESOLVED,
          resolvedAt: { gte: todayStart },
        },
      }),
      this.prisma.supportTicket.count({
        where: {
          ...baseWhere,
          status: SupportTicketStatus.CLOSED,
          closedAt: { gte: todayStart },
        },
      }),
      this.prisma.supportTicket.count({
        where: {
          ...baseWhere,
          status: { in: ACTIVE_STATUSES },
          assignedToId: null,
        },
      }),
      this.prisma.supportTicket.count({
        where: {
          ...baseWhere,
          status: { in: ACTIVE_STATUSES },
          OR: [
            {
              priority: SupportTicketPriority.URGENT,
              createdAt: { lt: slaCutoffs.urgent },
            },
            {
              priority: SupportTicketPriority.HIGH,
              createdAt: { lt: slaCutoffs.high },
            },
            {
              priority: SupportTicketPriority.NORMAL,
              createdAt: { lt: slaCutoffs.normal },
            },
            {
              priority: SupportTicketPriority.LOW,
              createdAt: { lt: slaCutoffs.low },
            },
          ],
        },
      }),
      this.prisma.supportTicket.groupBy({
        by: ['status'],
        where: baseWhere,
        _count: { _all: true },
      }),
      this.prisma.supportTicket.groupBy({
        by: ['priority'],
        where: baseWhere,
        _count: { _all: true },
      }),
      this.prisma.supportTicket.groupBy({
        by: ['ticketType'],
        where: baseWhere,
        _count: { _all: true },
      }),
      this.prisma.supportTicket.groupBy({
        by: ['moduleName'],
        where: baseWhere,
        _count: { _all: true },
      }),
      this.prisma.supportTicket.findMany({
        where: baseWhere,
        select: {
          id: true,
          ticketNumber: true,
          title: true,
          status: true,
          priority: true,
          ticketType: true,
          moduleName: true,
          createdAt: true,
          updatedAt: true,
        },
        orderBy: { updatedAt: 'desc' },
        take: 8,
      }),
      this.prisma.supportTicket.findMany({
        where: { ...baseWhere, status: { in: ACTIVE_STATUSES } },
        select: {
          id: true,
          ticketNumber: true,
          title: true,
          status: true,
          priority: true,
          moduleName: true,
          createdAt: true,
          assignedToId: true,
        },
        orderBy: { createdAt: 'asc' },
        take: 8,
      }),
      this.prisma.supportTicket.findMany({
        where: { ...baseWhere, status: SupportTicketStatus.RESOLVED, resolvedAt: { not: null } },
        select: { createdAt: true, resolvedAt: true },
        orderBy: { resolvedAt: 'desc' },
        take: 100,
      }),
    ]);

    const unresolvedTickets = openTickets + inProgressTickets + waitingUserTickets;
    const resolutionHours = recentResolvedTickets
      .filter((ticket) => ticket.resolvedAt)
      .map((ticket) => hoursBetween(ticket.createdAt, ticket.resolvedAt as Date));
    const averageResolutionHours =
      resolutionHours.length > 0
        ? round1(resolutionHours.reduce((sum, hours) => sum + hours, 0) / resolutionHours.length)
        : 0;

    return {
      openTickets,
      inProgressTickets,
      urgentTickets,
      resolvedToday,
      totalTickets,
      waitingUserTickets,
      closedToday,
      unresolvedTickets,
      unassignedTickets,
      overdueTickets,
      averageResolutionHours,
      serviceLevel: {
        activeWithinSla: Math.max(unresolvedTickets - overdueTickets, 0),
        overdueTickets,
        overdueRate: percentage(overdueTickets, unresolvedTickets),
      },
      backlogByStatus: countBy(statusRows as GroupCount[], 'status'),
      backlogByPriority: countBy(priorityRows as GroupCount[], 'priority'),
      backlogByType: countBy(typeRows as GroupCount[], 'ticketType'),
      backlogByModule: countBy(moduleRows as GroupCount[], 'moduleName', 'UNASSIGNED'),
      recentTickets,
      oldestActiveTickets,
    };
  }
}

function startOfDay(date: Date) {
  const value = new Date(date);
  value.setHours(0, 0, 0, 0);
  return value;
}

function prioritySlaCutoffs(now: Date) {
  return {
    urgent: hoursBefore(now, 4),
    high: hoursBefore(now, 24),
    normal: hoursBefore(now, 72),
    low: hoursBefore(now, 168),
  };
}

function hoursBefore(date: Date, hours: number) {
  return new Date(date.getTime() - hours * 60 * 60 * 1000);
}

function hoursBetween(start: Date, end: Date) {
  return Math.max(0, (end.getTime() - start.getTime()) / (60 * 60 * 1000));
}

function percentage(part: number, total: number) {
  return total > 0 ? Math.round((part / total) * 100) : 0;
}

function round1(value: number) {
  return Math.round(value * 10) / 10;
}

function countBy(rows: GroupCount[], key: string, emptyLabel = 'UNKNOWN') {
  return rows.reduce<Record<string, number>>((acc, row) => {
    const value = row[key];
    const label =
      value === null || value === undefined || value === '' ? emptyLabel : String(value);
    acc[label] = row._count._all;
    return acc;
  }, {});
}
