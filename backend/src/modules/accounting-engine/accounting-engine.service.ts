import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { applyCompanyScopeWhere } from '../../common/services';

@Injectable()
export class AccountingEngineService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditLogs: AuditLogsService,
  ) {}

  async getSummary(query: any, user?: any) {
    const { companyId } = query;
    const where: any = { deletedAt: null };
    applyCompanyScopeWhere(where, user, companyId);

    const [pendingCloses, openLocks, pendingAdjustments, pendingPostingRuns] = await Promise.all([
      this.prisma.accountingPeriodClose.count({ where: { ...where, status: 'PENDING' } }),
      this.prisma.accountingLock.count({ where: { ...where, isReleased: false } }),
      this.prisma.auditAdjustment.count({ where: { ...where, status: { in: ['DRAFT', 'SUBMITTED'] } } }),
      this.prisma.postingRun.count({ where: { ...where, status: 'DRAFT' } }),
    ]);

    return { pendingCloses, openLocks, pendingAdjustments, pendingPostingRuns };
  }
}
