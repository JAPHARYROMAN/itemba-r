import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { CompanyScopeService } from '../../common/services';
import { AuthUser } from '../../common/decorators/current-user.decorator';

@Injectable()
export class GroupControlService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly companyScope: CompanyScopeService,
  ) {}

  async getSummary(user: AuthUser, companyId?: string) {
    if (companyId) {
      // Caller is asking for a specific company's slice — verify they have access.
      await this.companyScope.assertCanAccessCompany(user, companyId);
    } else {
      // Group-wide consolidated summary requires GROUP-scoped role.
      this.companyScope.assertGroupScoped(user, 'view group-wide control summary');
    }

    const accessibleIds = await this.companyScope.accessibleCompanyIds(user);
    const scopeFilter: any = companyId
      ? { companyId }
      : accessibleIds === null
      ? {}
      : { companyId: { in: accessibleIds } };
    const baseWhere = { ...scopeFilter, deletedAt: null };

    const thirtyDaysFromNow = new Date();
    thirtyDaysFromNow.setDate(thirtyDaysFromNow.getDate() + 30);

    const [
      bankAccountCount,
      activeLoanCount,
      activeLoanBalance,
      outstandingDebtCount,
      outstandingDebtTotal,
      activeContractCount,
      expiringContractCount,
      fixedAssetCount,
      fixedAssetBookValue,
      recentAuditLogs,
      companies,
    ] = await Promise.all([
      this.prisma.bankAccount.count({ where: { ...baseWhere, isActive: true } }),

      this.prisma.loan.count({ where: { ...baseWhere, status: 'ACTIVE' } }),

      this.prisma.loan.aggregate({
        where: { ...baseWhere, status: 'ACTIVE' },
        _sum: { outstandingBalance: true },
      }),

      this.prisma.debt.count({ where: { ...baseWhere, status: 'OUTSTANDING' } }),

      this.prisma.debt.aggregate({
        where: { ...baseWhere, status: 'OUTSTANDING' },
        _sum: { amount: true },
      }),

      this.prisma.contract.count({ where: { ...baseWhere, status: 'ACTIVE' } }),

      this.prisma.contract.count({
        where: {
          ...baseWhere,
          status: 'ACTIVE',
          endDate: { lte: thirtyDaysFromNow, gte: new Date() },
        },
      }),

      this.prisma.fixedAsset.count({ where: { ...baseWhere, status: 'ACTIVE' } }),

      this.prisma.fixedAsset.aggregate({
        where: { ...baseWhere, status: 'ACTIVE' },
        _sum: { currentBookValue: true },
      }),

      this.prisma.auditLog.findMany({
        where: {
          action: 'VIEW_SENSITIVE',
          ...scopeFilter,
        },
        include: { user: { select: { id: true, fullName: true, email: true } } },
        orderBy: { createdAt: 'desc' },
        take: 10,
      }),

      // Only return companies the caller can see.
      this.prisma.company.findMany({
        where: {
          deletedAt: null,
          ...(accessibleIds === null ? {} : { id: { in: accessibleIds } }),
        },
        select: { id: true, name: true, code: true, status: true },
        orderBy: { name: 'asc' },
      }),
    ]);

    return {
      bankAccounts: {
        total: bankAccountCount,
      },
      loans: {
        activeCount: activeLoanCount,
        totalOutstandingBalance: activeLoanBalance._sum?.outstandingBalance ?? 0,
      },
      debts: {
        outstandingCount: outstandingDebtCount,
        totalOutstandingAmount: outstandingDebtTotal._sum.amount ?? 0,
      },
      contracts: {
        activeCount: activeContractCount,
        expiringIn30Days: expiringContractCount,
      },
      fixedAssets: {
        activeCount: fixedAssetCount,
        totalBookValue: fixedAssetBookValue._sum.currentBookValue ?? 0,
      },
      recentSensitiveActivity: recentAuditLogs,
      companies,
    };
  }

  async getAuditTrail(
    user: AuthUser,
    query: { page?: number; limit?: number; companyId?: string },
  ) {
    const { page = 1, limit = 20, companyId } = query;
    const skip = (page - 1) * limit;

    if (companyId) {
      await this.companyScope.assertCanAccessCompany(user, companyId);
    } else {
      this.companyScope.assertGroupScoped(user, 'view group-wide audit trail');
    }
    const accessibleIds = await this.companyScope.accessibleCompanyIds(user);

    const where: any = {
      action: { in: ['VIEW_SENSITIVE', 'LOGIN', 'LOGOUT', 'CREATE', 'UPDATE', 'DELETE', 'APPROVE'] },
    };
    if (companyId) {
      where.companyId = companyId;
    } else if (accessibleIds !== null) {
      where.companyId = { in: accessibleIds };
    }

    const [data, total] = await Promise.all([
      this.prisma.auditLog.findMany({
        where,
        include: {
          user: { select: { id: true, fullName: true, email: true } },
          company: { select: { id: true, name: true, code: true } },
        },
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
      }),
      this.prisma.auditLog.count({ where }),
    ]);

    return { data, total, page, limit, totalPages: Math.ceil(total / limit) };
  }
}
