import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';
import { AuditLogsService } from '../../audit-logs/audit-logs.service';
import { CreatePerformanceRecordDto } from './dto/create-performance.dto';
import { UpdatePerformanceRecordDto } from './dto/update-performance.dto';
import { applyCompanyScopeWhere } from '../../../common/services';

@Injectable()
export class PerformanceService {
  private readonly logger = new Logger(PerformanceService.name);
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditLogsService,
  ) {}

  private companyFilter(user: any) {
    if (user.role?.scope === 'GROUP') return {};
    return { companyId: user.companyId };
  }

  async findAll(user: any, query: any) {
    const { page = 1, limit = 20, employeeId, companyId, divisionId, branchId, status } = query;
    const skip = (Number(page) - 1) * Number(limit);
    const where: any = { deletedAt: null, ...this.companyFilter(user) };
    applyCompanyScopeWhere(where, user, companyId);
    if (divisionId) where.divisionId = divisionId;
    if (branchId) where.branchId = branchId;
    if (employeeId) where.employeeId = employeeId;
    if (status) where.status = status;
    const [data, total] = await Promise.all([
      this.prisma.performanceRecord.findMany({
        where,
        skip,
        take: Number(limit),
        orderBy: { createdAt: 'desc' },
        include: {
          employee: { select: { id: true, fullName: true, employeeCode: true } },
          reviewer: { select: { id: true, fullName: true } },
          company: { select: { id: true, name: true } },
          division: { select: { id: true, name: true, code: true } },
          branch: { select: { id: true, name: true, code: true } },
        },
      }),
      this.prisma.performanceRecord.count({ where }),
    ]);
    return { data, total, page: Number(page), limit: Number(limit) };
  }

  async findOne(id: string, user: any) {
    const record = await this.prisma.performanceRecord.findFirst({
      where: { id, deletedAt: null, ...this.companyFilter(user) },
      include: {
        employee: { select: { id: true, fullName: true, employeeCode: true } },
        reviewer: { select: { id: true, fullName: true } },
        company: { select: { id: true, name: true } },
        division: { select: { id: true, name: true, code: true } },
        branch: { select: { id: true, name: true, code: true } },
      },
    });
    if (!record) throw new NotFoundException('Performance record not found');
    return record;
  }

  async create(dto: CreatePerformanceRecordDto, user: any) {
    const hierarchy = await this.resolveEmployeeHierarchy(
      dto.companyId,
      dto.employeeId,
      dto.divisionId,
      dto.branchId,
    );
    const record = await this.prisma.performanceRecord.create({
      data: {
        ...dto,
        divisionId: hierarchy.divisionId,
        branchId: hierarchy.branchId,
        reviewDate: new Date(dto.reviewDate),
        reviewPeriodStart: dto.reviewPeriodStart ? new Date(dto.reviewPeriodStart) : undefined,
        reviewPeriodEnd: dto.reviewPeriodEnd ? new Date(dto.reviewPeriodEnd) : undefined,
      } as any,
    });
    await this.audit.log({
      userId: user.id,
      action: 'CREATE',
      entityType: 'PerformanceRecord',
      entityId: record.id,
      newValue: dto as unknown as Record<string, unknown>,
    });
    return record;
  }

  async update(id: string, dto: UpdatePerformanceRecordDto, user: any) {
    const existing = await this.findOne(id, user);
    const hierarchy =
      (dto as any).companyId !== undefined ||
      dto.employeeId !== undefined ||
      dto.divisionId !== undefined ||
      dto.branchId !== undefined
        ? await this.resolveEmployeeHierarchy(
            (dto as any).companyId ?? existing.companyId,
            dto.employeeId ?? existing.employeeId,
            dto.divisionId ?? existing.divisionId,
            dto.branchId ?? existing.branchId,
          )
        : { divisionId: existing.divisionId, branchId: existing.branchId };
    const record = await this.prisma.performanceRecord.update({
      where: { id },
      data: {
        ...dto,
        divisionId: hierarchy.divisionId,
        branchId: hierarchy.branchId,
        reviewDate: dto.reviewDate ? new Date(dto.reviewDate) : undefined,
        reviewPeriodStart: dto.reviewPeriodStart ? new Date(dto.reviewPeriodStart) : undefined,
        reviewPeriodEnd: dto.reviewPeriodEnd ? new Date(dto.reviewPeriodEnd) : undefined,
      } as any,
    });
    await this.audit.log({
      userId: user.id,
      action: 'UPDATE',
      entityType: 'PerformanceRecord',
      entityId: id,
      newValue: dto as unknown as Record<string, unknown>,
    });

    // Auto-grant bonus when the record transitions to APPROVED with a bonus
    // set and not yet booked. Edits to bonusAmount on already-APPROVED rows
    // do not retroactively rewrite the prior allowance — operators must
    // delete and recreate the record to revise.
    const becameApproved = existing.status !== 'APPROVED' && record.status === 'APPROVED';
    const hasBonus = Number(record.bonusAmount ?? 0) > 0;
    if (becameApproved && hasBonus && !record.bonusAllowanceId) {
      try {
        await this.applyBonus(id, user.id);
      } catch (err) {
        this.logger.warn(
          `Auto-bonus allowance failed for ${id}: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }
    return record;
  }

  /**
   * Grant the performance bonus as an EmployeeAllowance. Idempotent — keyed
   * on `bonusAllowanceId`. Throws if PERFORMANCE_BONUS allowance type is
   * missing from the company seed.
   */
  async applyBonus(recordId: string, userId: string) {
    const record = await this.prisma.performanceRecord.findFirst({
      where: { id: recordId, deletedAt: null },
      select: {
        id: true,
        companyId: true,
        employeeId: true,
        performanceNumber: true,
        bonusAmount: true,
        bonusAllowanceId: true,
        reviewDate: true,
      },
    });
    if (!record) throw new NotFoundException('Performance record not found');
    if (!record.bonusAmount || Number(record.bonusAmount) <= 0) return null;
    if (record.bonusAllowanceId) {
      return this.prisma.employeeAllowance.findUnique({
        where: { id: record.bonusAllowanceId },
      });
    }

    const allowanceType = await this.prisma.allowanceType.findFirst({
      where: { companyId: record.companyId, code: 'PERFORMANCE_BONUS', deletedAt: null },
      select: { id: true },
    });
    if (!allowanceType) {
      throw new Error(
        `Company ${record.companyId} has no AllowanceType with code='PERFORMANCE_BONUS'. Re-seed.`,
      );
    }

    const allowance = await this.prisma.employeeAllowance.create({
      data: {
        companyId: record.companyId,
        employeeId: record.employeeId,
        allowanceTypeId: allowanceType.id,
        amount: record.bonusAmount,
        effectiveFrom: record.reviewDate ?? new Date(),
        status: 'ACTIVE',
        notes: `Performance bonus — ${record.performanceNumber}`,
      },
    });

    await this.prisma.performanceRecord.update({
      where: { id: record.id },
      data: { bonusAllowanceId: allowance.id },
    });

    await this.audit.log({
      userId,
      action: 'APPLY_BONUS',
      entityType: 'PerformanceRecord',
      entityId: record.id,
      newValue: { bonusAmount: record.bonusAmount, allowanceId: allowance.id },
    });

    return allowance;
  }

  async remove(id: string, user: any) {
    await this.findOne(id, user);
    await this.prisma.performanceRecord.update({ where: { id }, data: { deletedAt: new Date() } });
    await this.audit.log({
      userId: user.id,
      action: 'DELETE',
      entityType: 'PerformanceRecord',
      entityId: id,
      newValue: {},
    });
    return { message: 'Performance record deleted' };
  }

  private async resolveEmployeeHierarchy(
    companyId: string,
    employeeId: string,
    requestedDivisionId?: string | null,
    requestedBranchId?: string | null,
  ) {
    const employee = await this.prisma.employee.findFirst({
      where: { id: employeeId, companyId, deletedAt: null },
      select: { divisionId: true, branchId: true },
    });
    if (!employee) throw new NotFoundException('Employee not found in this company');

    const divisionId = requestedDivisionId ?? employee.divisionId;
    const branchId = requestedBranchId ?? employee.branchId;
    await assertHierarchyBelongsToCompany(this.prisma, companyId, divisionId, branchId);
    return { divisionId, branchId };
  }
}

async function assertHierarchyBelongsToCompany(
  prisma: PrismaService,
  companyId: string,
  divisionId?: string | null,
  branchId?: string | null,
) {
  if (divisionId) {
    const division = await prisma.division.findFirst({
      where: { id: divisionId, companyId, deletedAt: null },
      select: { id: true },
    });
    if (!division) throw new NotFoundException('Division not found in this company');
  }
  if (branchId) {
    const branch = await prisma.branch.findFirst({
      where: {
        id: branchId,
        deletedAt: null,
        division: { companyId },
        ...(divisionId ? { divisionId } : {}),
      },
      select: { id: true },
    });
    if (!branch) throw new NotFoundException('Branch not found in this company/division');
  }
}
