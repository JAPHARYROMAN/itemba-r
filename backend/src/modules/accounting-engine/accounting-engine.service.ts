import { Injectable } from '@nestjs/common';
import { AccountingLockStatus, PeriodCloseStatus, Prisma } from '@prisma/client';
import { AuthUser } from '../../common/decorators/current-user.decorator';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { companyWhereForUser } from '../../common/services';
import { AccountingEngineSummaryQueryDto } from './dto/accounting-engine-query.dto';

@Injectable()
export class AccountingEngineService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditLogs: AuditLogsService,
  ) {}

  async getSummary(query: AccountingEngineSummaryQueryDto, user?: AuthUser) {
    const { companyId } = query;
    const scope = companyWhereForUser(user, companyId);
    const closeWhere: Prisma.AccountingPeriodCloseWhereInput = { deletedAt: null, ...scope };
    const lockWhere: Prisma.AccountingLockWhereInput = { deletedAt: null, ...scope };
    const adjustmentWhere: Prisma.AuditAdjustmentWhereInput = { deletedAt: null, ...scope };
    const postingRunWhere: Prisma.PostingRunWhereInput = { deletedAt: null, ...scope };

    const [pendingCloses, openLocks, pendingAdjustments, pendingPostingRuns] = await Promise.all([
      this.prisma.accountingPeriodClose.count({
        where: { ...closeWhere, status: { in: [PeriodCloseStatus.DRAFT, PeriodCloseStatus.REVIEWING] } },
      }),
      this.prisma.accountingLock.count({ where: { ...lockWhere, status: AccountingLockStatus.ACTIVE } }),
      this.prisma.auditAdjustment.count({ where: { ...adjustmentWhere, status: { in: ['DRAFT', 'SUBMITTED'] } } }),
      this.prisma.postingRun.count({ where: { ...postingRunWhere, status: 'DRAFT' } }),
    ]);

    return { pendingCloses, openLocks, pendingAdjustments, pendingPostingRuns };
  }
}
