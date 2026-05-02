import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { applyCompanyScopeWhere } from '../../common/services';

@Injectable()
export class FinancialStatementsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditLogs: AuditLogsService,
  ) {}

  async findAll(query: any, user?: any) {
    const { companyId, page = 1, limit = 20 } = query;
    const skip = (Number(page) - 1) * Number(limit);
    const where: any = {};
    applyCompanyScopeWhere(where, user, companyId);
    const [items, total] = await Promise.all([
      this.prisma.financialStatementRun.findMany({ where, skip, take: Number(limit), orderBy: { createdAt: 'desc' } }),
      this.prisma.financialStatementRun.count({ where }),
    ]);
    return { items, total, page: Number(page), limit: Number(limit) };
  }

  async findOne(id: string) {
    const item = await this.prisma.financialStatementRun.findFirst({ where: { id } });
    if (!item) throw new NotFoundException('Financial statement run not found');
    return item;
  }

  async generate(dto: any, user: any) {
    const { companyId, periodStart, periodEnd, statementType } = dto;

    // Build trial balance from journal entry lines
    const lines = await this.prisma.journalEntryLine.findMany({
      where: {
        journalEntry: {
          companyId,
          transactionDate: {
            gte: periodStart ? new Date(periodStart) : undefined,
            lte: periodEnd ? new Date(periodEnd) : undefined,
          },
          status: 'POSTED',
        },
      },
      include: { account: true },
    });

    const accountTotals: Record<string, { accountId: string; accountCode: string; accountName: string; debit: number; credit: number }> = {};
    for (const line of lines) {
      const key = line.accountId;
      if (!accountTotals[key]) {
        accountTotals[key] = { accountId: key, accountCode: line.account?.accountCode ?? '', accountName: line.account?.accountName ?? '', debit: 0, credit: 0 };
      }
      accountTotals[key].debit += Number(line.debit ?? 0);
      accountTotals[key].credit += Number(line.credit ?? 0);
    }

    const trialBalance = Object.values(accountTotals);

    const run = await this.prisma.financialStatementRun.create({
      data: {
        statementRunNumber: `FSR-${Date.now()}`,
        companyId: companyId ?? undefined,
        statementType: statementType ?? 'TRIAL_BALANCE',
        periodStart: new Date(periodStart),
        periodEnd: new Date(periodEnd),
        resultSummary: trialBalance as any,
        generatedById: user.id,
        generatedAt: new Date(),
        status: 'GENERATED',
      },
    });

    await this.auditLogs.log({ action: 'GENERATE', entityType: 'FinancialStatementRun', entityId: run.id, userId: user.id, companyId });
    return { run, trialBalance };
  }
}
