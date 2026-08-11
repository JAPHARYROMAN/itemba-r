import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { AccessLevel } from '@prisma/client';
import { AuthUser } from '../../../common/decorators/current-user.decorator';
import { applyCompanyScopeWhere, assertCanAccessCompanyFromUser } from '../../../common/services';
import { PrismaService } from '../../../prisma/prisma.service';
import { AuditLogsService } from '../../audit-logs/audit-logs.service';
import { EntityCodeGeneratorService } from '../../entity-code-generator/entity-code-generator.service';
import { CreateDisciplinaryActionDto } from './dto/create-disciplinary-action.dto';
import { UpdateDisciplinaryActionDto } from './dto/update-disciplinary-action.dto';

@Injectable()
export class DisciplinaryActionsService {
  private readonly logger = new Logger(DisciplinaryActionsService.name);
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditLogsService,
    private readonly codes: EntityCodeGeneratorService,
  ) {}

  private include() {
    return {
      employee: {
        select: { id: true, employeeCode: true, fullName: true, firstName: true, lastName: true },
      },
      issuedBy: { select: { id: true, fullName: true } },
      approvedBy: { select: { id: true, fullName: true } },
      dispute: { select: { id: true, disputeNumber: true, status: true } },
    };
  }

  private companyFilter(user: AuthUser): Record<string, string> {
    if (user.role?.scope === 'GROUP' || !user.companyId) return {};
    return { companyId: user.companyId };
  }

  async findAll(query: {
    user: AuthUser;
    page?: number;
    limit?: number;
    companyId?: string;
    employeeId?: string;
    status?: string;
    type?: string;
  }) {
    const page = Number(query.page) || 1;
    const limit = Number(query.limit) || 50;
    const where: Record<string, unknown> = { deletedAt: null, ...this.companyFilter(query.user) };
    applyCompanyScopeWhere(where, query.user, query.companyId);
    if (query.employeeId) where.employeeId = query.employeeId;
    if (query.status) where.status = query.status;
    if (query.type) where.type = query.type;
    const [data, total] = await Promise.all([
      this.prisma.disciplinaryAction.findMany({
        where,
        skip: (page - 1) * limit,
        take: limit,
        orderBy: { issuedAt: 'desc' },
        include: this.include(),
      }),
      this.prisma.disciplinaryAction.count({ where }),
    ]);
    return { data, total, page, limit, totalPages: Math.ceil(total / limit) };
  }

  async findOne(id: string, user: AuthUser) {
    const row = await this.prisma.disciplinaryAction.findFirst({
      where: { id, deletedAt: null, ...this.companyFilter(user) },
      include: this.include(),
    });
    if (!row) throw new NotFoundException('Disciplinary action not found');
    return row;
  }

  async create(dto: CreateDisciplinaryActionDto, user: AuthUser) {
    assertCanAccessCompanyFromUser(user, dto.companyId, AccessLevel.WRITE);
    const actionNumber = await this.codes.next({
      entityType: 'DisciplinaryAction',
      companyId: dto.companyId,
    });
    const status = requiresHrApproval(dto.type) ? 'PENDING_HR_APPROVAL' : 'ACTIVE';
    const row = await this.prisma.disciplinaryAction.create({
      data: {
        actionNumber,
        companyId: dto.companyId,
        employeeId: dto.employeeId,
        disputeId: dto.disputeId,
        type: dto.type,
        issuedAt: new Date(dto.issuedAt),
        effectiveFrom: dto.effectiveFrom ? new Date(dto.effectiveFrom) : null,
        effectiveTo: dto.effectiveTo ? new Date(dto.effectiveTo) : null,
        reason: dto.reason,
        evidence: dto.evidence,
        employeeResponse: dto.employeeResponse,
        notes: dto.notes,
        fineAmount: dto.fineAmount,
        issuedById: user.id,
        status,
      },
      include: this.include(),
    });
    await this.audit.log({
      userId: user.id,
      action: 'CREATE',
      entityType: 'DisciplinaryAction',
      entityId: row.id,
      newValue: row as unknown as Record<string, unknown>,
    });

    // Auto-create the deduction only once the action is active/approved.
    if (status === 'ACTIVE' && dto.fineAmount && dto.fineAmount > 0) {
      try {
        await this.applyFine(row.id, user.id);
      } catch (err) {
        this.logger.warn(
          `Auto-fine deduction failed for ${row.id}: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }
    return row;
  }

  /**
   * Single-approver sign-off (simplification decision 5: no dual HR+GM chain).
   * Accepts legacy PENDING_GM_APPROVAL rows so nothing already in flight gets
   * stuck. Maker-checker still applies: the issuer cannot approve.
   */
  async approve(actionId: string, user: AuthUser) {
    const action = await this.findOne(actionId, user);
    const userId = user.id;
    this.assertCanApprove(action, userId);
    if (action.status !== 'PENDING_HR_APPROVAL' && action.status !== 'PENDING_GM_APPROVAL') {
      throw new BadRequestException('Disciplinary action is not pending approval');
    }
    const now = new Date();
    const row = await this.prisma.disciplinaryAction.update({
      where: { id: actionId },
      data: {
        status: 'ACTIVE',
        hrApprovedById: (action as any).hrApprovedById ?? userId,
        hrApprovedAt: (action as any).hrApprovedAt ?? now,
        approvedById: userId,
        approvedAt: now,
      } as any,
      include: this.include(),
    });
    if (row.fineAmount && Number(row.fineAmount) > 0) {
      await this.applyFine(actionId, userId);
    }
    await this.audit.log({
      userId,
      action: 'DISCIPLINARY_APPROVE',
      entityType: 'DisciplinaryAction',
      entityId: actionId,
      newValue: { status: 'ACTIVE' },
    });
    return row;
  }

  /**
   * Apply (or re-apply) the disciplinary fine as an EmployeeDeduction.
   * Idempotent — keyed on `fineDeductionId`. No-ops if the fine is missing
   * or already deducted; throws if the company lacks the DISCIPLINARY
   * deduction type seed.
   */
  async applyFine(actionId: string, userId: string) {
    const action = await this.prisma.disciplinaryAction.findFirst({
      where: { id: actionId, deletedAt: null },
      select: {
        id: true,
        companyId: true,
        employeeId: true,
        actionNumber: true,
        fineAmount: true,
        fineDeductionId: true,
        effectiveFrom: true,
      },
    });
    if (!action) throw new NotFoundException('Disciplinary action not found');
    if (!action.fineAmount || Number(action.fineAmount) <= 0) return null;
    if (action.fineDeductionId) {
      // Already applied — return the existing deduction for traceability.
      return this.prisma.employeeDeduction.findUnique({
        where: { id: action.fineDeductionId },
      });
    }

    const deductionType = await this.prisma.deductionType.findFirst({
      where: { companyId: action.companyId, code: 'DISCIPLINARY', deletedAt: null },
      select: { id: true },
    });
    if (!deductionType) {
      throw new Error(
        `Company ${action.companyId} has no DeductionType with code='DISCIPLINARY'. Re-seed.`,
      );
    }

    const deduction = await this.prisma.employeeDeduction.create({
      data: {
        companyId: action.companyId,
        employeeId: action.employeeId,
        deductionTypeId: deductionType.id,
        amount: action.fineAmount,
        effectiveFrom: action.effectiveFrom ?? new Date(),
        // One-shot: a disciplinary fine is recovered in the next pay period.
        // Operators can extend the window via update if needed.
        status: 'ACTIVE',
        notes: `Disciplinary fine — ${action.actionNumber}`,
      },
    });

    await this.prisma.disciplinaryAction.update({
      where: { id: action.id },
      data: { fineDeductionId: deduction.id },
    });

    await this.audit.log({
      userId,
      action: 'APPLY_FINE',
      entityType: 'DisciplinaryAction',
      entityId: action.id,
      newValue: { fineAmount: action.fineAmount, deductionId: deduction.id },
    });

    return deduction;
  }

  async update(id: string, dto: UpdateDisciplinaryActionDto, user: AuthUser) {
    const existing = await this.findOne(id, user);
    const userId = user.id;
    const data: Record<string, unknown> = {};
    if (dto.type !== undefined) data.type = dto.type;
    if (dto.disputeId !== undefined) data.disputeId = dto.disputeId;
    if (dto.issuedAt !== undefined) data.issuedAt = new Date(dto.issuedAt);
    if (dto.effectiveFrom !== undefined)
      data.effectiveFrom = dto.effectiveFrom ? new Date(dto.effectiveFrom) : null;
    if (dto.effectiveTo !== undefined)
      data.effectiveTo = dto.effectiveTo ? new Date(dto.effectiveTo) : null;
    if (dto.reason !== undefined) data.reason = dto.reason;
    if (dto.evidence !== undefined) data.evidence = dto.evidence;
    if (dto.employeeResponse !== undefined) data.employeeResponse = dto.employeeResponse;
    if (dto.notes !== undefined) data.notes = dto.notes;
    if (dto.status !== undefined) {
      if (
        dto.status === 'ACTIVE' &&
        requiresHrApproval(existing.type) &&
        !(existing as any).hrApprovedById
      ) {
        throw new BadRequestException(
          'Group HR approval is required before activating this action',
        );
      }
      data.status = dto.status;
    }
    if (dto.fineAmount !== undefined) data.fineAmount = dto.fineAmount;
    const row = await this.prisma.disciplinaryAction.update({
      where: { id },
      data,
      include: this.include(),
    });
    await this.audit.log({
      userId,
      action: 'UPDATE',
      entityType: 'DisciplinaryAction',
      entityId: id,
      oldValue: existing as unknown as Record<string, unknown>,
      newValue: row as unknown as Record<string, unknown>,
    });

    // If a fine was newly added (or raised from null) and no deduction has been
    // booked yet, apply it now. Edits that *change* an already-applied fine
    // amount do not retroactively rewrite the prior deduction — operators must
    // void the original action and create a new one.
    const oldFine = Number((existing as { fineAmount?: unknown }).fineAmount ?? 0);
    const newFine = Number(row.fineAmount ?? 0);
    if (newFine > 0 && oldFine === 0 && !row.fineDeductionId) {
      try {
        await this.applyFine(id, userId);
      } catch (err) {
        this.logger.warn(
          `Auto-fine deduction failed on update for ${id}: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }
    return row;
  }

  async remove(id: string, user: AuthUser) {
    const existing = await this.findOne(id, user);
    const userId = user.id;
    await this.prisma.disciplinaryAction.update({ where: { id }, data: { deletedAt: new Date() } });
    await this.audit.log({
      userId,
      action: 'DELETE',
      entityType: 'DisciplinaryAction',
      entityId: id,
      oldValue: existing as unknown as Record<string, unknown>,
    });
    return { success: true };
  }

  private assertCanApprove(action: { issuedById: string }, userId: string) {
    if (action.issuedById === userId) {
      throw new BadRequestException('Maker-checker: issuer cannot approve the disciplinary action');
    }
  }
}

function requiresHrApproval(type: string): boolean {
  return type !== 'VERBAL_WARNING';
}
