import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';
import { applyCompanyScopeWhere } from '../../../common/services';

@Injectable()
export class ComplianceCalendarService {
  constructor(private readonly prisma: PrismaService) {}

  private companyFilter(user: any) {
    if (user.role?.scope === 'GROUP') return {};
    return { companyId: user.companyId };
  }

  async findAll(user: any, query: any) {
    const { page = 1, limit = 20, companyId, status, priority } = query;
    const skip = (Number(page) - 1) * Number(limit);
    const where: any = { deletedAt: null, ...this.companyFilter(user) };
    applyCompanyScopeWhere(where, user, companyId);
    if (status) where.status = status;
    if (priority) where.priority = priority;
    const [data, total] = await Promise.all([
      this.prisma.complianceObligation.findMany({ where, skip, take: Number(limit), orderBy: { dueDate: 'asc' } }),
      this.prisma.complianceObligation.count({ where }),
    ]);
    return { data, total, page: Number(page), limit: Number(limit) };
  }

  async findOverdue(user: any, query: any) {
    const { page = 1, limit = 20, companyId } = query;
    const skip = (Number(page) - 1) * Number(limit);
    const today = new Date();
    const where: any = {
      deletedAt: null,
      dueDate: { lt: today },
      status: { notIn: ['COMPLETED', 'CANCELLED', 'WAIVED'] },
      ...this.companyFilter(user),
    };
    applyCompanyScopeWhere(where, user, companyId);
    const [data, total] = await Promise.all([
      this.prisma.complianceObligation.findMany({ where, skip, take: Number(limit), orderBy: { dueDate: 'asc' } }),
      this.prisma.complianceObligation.count({ where }),
    ]);
    return { data, total, page: Number(page), limit: Number(limit) };
  }

  async findUpcoming(user: any, query: any) {
    const { page = 1, limit = 20, companyId } = query;
    const skip = (Number(page) - 1) * Number(limit);
    const today = new Date();
    const in90Days = new Date(today.getTime() + 90 * 24 * 60 * 60 * 1000);
    const where: any = {
      deletedAt: null,
      dueDate: { gte: today, lte: in90Days },
      ...this.companyFilter(user),
    };
    applyCompanyScopeWhere(where, user, companyId);
    const [data, total] = await Promise.all([
      this.prisma.complianceObligation.findMany({ where, skip, take: Number(limit), orderBy: { dueDate: 'asc' } }),
      this.prisma.complianceObligation.count({ where }),
    ]);
    return { data, total, page: Number(page), limit: Number(limit) };
  }
}
