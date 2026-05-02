import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { AuditSeverity } from '@prisma/client';

@Injectable()
export class FinanceService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditLogs: AuditLogsService,
  ) {}

  async getDashboard(companyId?: string, userId?: string) {
    const baseWhere = (cId?: string) => ({
      deletedAt: null,
      ...(cId ? { companyId: cId } : {}),
    });

    const jePostedWhere = (cId?: string) => ({
      deletedAt: null,
      status: 'POSTED' as const,
      ...(cId ? { companyId: cId } : {}),
    });

    const now = new Date();

    const [
      incomeLines,
      expenseLines,
      cashBalance,
      receivablesOpen,
      receivablesOverdue,
      payablesOpen,
      payablesOverdue,
      openExpenses,
      pendingApprovals,
      icFrom,
      icTo,
    ] = await Promise.all([
      this.prisma.journalEntryLine.findMany({
        where: {
          ...(companyId ? { companyId } : {}),
          journalEntry: jePostedWhere(companyId),
          account: { accountType: 'INCOME' },
        },
        select: { credit: true, debit: true },
      }),
      this.prisma.journalEntryLine.findMany({
        where: {
          ...(companyId ? { companyId } : {}),
          journalEntry: jePostedWhere(companyId),
          account: { accountType: { in: ['EXPENSE', 'COST_OF_GOODS_SOLD'] } },
        },
        select: { credit: true, debit: true },
      }),
      this.prisma.cashAccount.aggregate({
        where: { ...baseWhere(companyId), isActive: true },
        _sum: { currentBalance: true },
      }),
      this.prisma.receivable.aggregate({
        where: { ...baseWhere(companyId), status: { in: ['OPEN', 'PARTIALLY_PAID'] } },
        _sum: { outstandingAmount: true },
        _count: true,
      }),
      this.prisma.receivable.count({
        where: {
          ...baseWhere(companyId),
          status: { in: ['OPEN', 'PARTIALLY_PAID'] },
          dueDate: { lt: now },
        },
      }),
      this.prisma.payable.aggregate({
        where: { ...baseWhere(companyId), status: { in: ['OPEN', 'PARTIALLY_PAID'] } },
        _sum: { outstandingAmount: true },
        _count: true,
      }),
      this.prisma.payable.count({
        where: {
          ...baseWhere(companyId),
          status: { in: ['OPEN', 'PARTIALLY_PAID'] },
          dueDate: { lt: now },
        },
      }),
      this.prisma.expense.count({
        where: { ...baseWhere(companyId), status: 'APPROVED' },
      }),
      this.prisma.expense.count({
        where: { ...baseWhere(companyId), status: 'PENDING_APPROVAL' },
      }),
      this.prisma.interCompanyTransaction.aggregate({
        where: {
          deletedAt: null,
          status: 'POSTED',
          ...(companyId ? { fromCompanyId: companyId } : {}),
        },
        _sum: { amount: true },
      }),
      this.prisma.interCompanyTransaction.aggregate({
        where: {
          deletedAt: null,
          status: 'POSTED',
          ...(companyId ? { toCompanyId: companyId } : {}),
        },
        _sum: { amount: true },
      }),
    ]);

    const totalIncome = incomeLines.reduce((s, l) => s + Number(l.credit) - Number(l.debit), 0);
    const totalExpenses = expenseLines.reduce((s, l) => s + Number(l.debit) - Number(l.credit), 0);

    if (userId) {
      await this.auditLogs.log({
        action: 'FINANCE_DASHBOARD_VIEW',
        entityType: 'Finance',
        userId,
        companyId,
        severity: AuditSeverity.LOW,
      });
    }

    return {
      totalIncome,
      totalExpenses,
      netPosition: totalIncome - totalExpenses,
      cashBalance: Number(cashBalance._sum.currentBalance ?? 0),
      receivables: {
        total: Number(receivablesOpen._sum.outstandingAmount ?? 0),
        open: receivablesOpen._count,
        overdue: receivablesOverdue,
      },
      payables: {
        total: Number(payablesOpen._sum.outstandingAmount ?? 0),
        open: payablesOpen._count,
        overdue: payablesOverdue,
      },
      openExpenses,
      pendingApprovals,
      intercompany: {
        fromTotal: Number(icFrom._sum.amount ?? 0),
        toTotal: Number(icTo._sum.amount ?? 0),
      },
    };
  }
}
