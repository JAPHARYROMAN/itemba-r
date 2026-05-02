import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';
import { applyCompanyScopeWhere } from '../../../common/services';

@Injectable()
export class ComplianceReportsService {
  constructor(private readonly prisma: PrismaService) {}

  private companyFilter(user: any) {
    if (user.role?.scope === 'GROUP') return {};
    return { companyId: user.companyId };
  }

  async getObligationsSummary(user: any, query: any) {
    const { companyId, startDate, endDate } = query;
    const where: any = { deletedAt: null, ...this.companyFilter(user) };
    applyCompanyScopeWhere(where, user, companyId);
    if (startDate || endDate) {
      where.dueDate = {};
      if (startDate) where.dueDate.gte = new Date(startDate);
      if (endDate) where.dueDate.lte = new Date(endDate);
    }
    const obligations = await this.prisma.complianceObligation.groupBy({
      by: ['status'],
      where,
      _count: { id: true },
    });
    return obligations;
  }

  async getTaxTransactionsSummary(user: any, query: any) {
    const { companyId, startDate, endDate } = query;
    const where: any = { deletedAt: null, ...this.companyFilter(user) };
    applyCompanyScopeWhere(where, user, companyId);
    if (startDate || endDate) {
      where.transactionDate = {};
      if (startDate) where.transactionDate.gte = new Date(startDate);
      if (endDate) where.transactionDate.lte = new Date(endDate);
    }
    const transactions = await this.prisma.taxTransaction.groupBy({
      by: ['direction', 'status'],
      where,
      _sum: { taxAmount: true, taxableAmount: true },
      _count: { id: true },
    });
    return transactions;
  }

  async getDocumentStatusSummary(user: any, query: any) {
    const { companyId } = query;
    const where: any = {};
    applyCompanyScopeWhere(where, user, companyId);
    const statuses = await this.prisma.complianceDocumentStatus.groupBy({
      by: ['status', 'companyId'],
      where,
      _count: { id: true },
    });
    return statuses;
  }
}
