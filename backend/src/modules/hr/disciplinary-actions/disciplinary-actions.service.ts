import { Injectable, Logger, NotFoundException } from '@nestjs/common';
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
      employee: { select: { id: true, employeeCode: true, fullName: true, firstName: true, lastName: true } },
      issuedBy: { select: { id: true, fullName: true } },
      approvedBy: { select: { id: true, fullName: true } },
      dispute: { select: { id: true, disputeNumber: true, status: true } },
    };
  }

  async findAll(query: { page?: number; limit?: number; companyId?: string; employeeId?: string; status?: string; type?: string }) {
    const page = Number(query.page) || 1;
    const limit = Number(query.limit) || 50;
    const where: Record<string, unknown> = { deletedAt: null };
    if (query.companyId) where.companyId = query.companyId;
    if (query.employeeId) where.employeeId = query.employeeId;
    if (query.status) where.status = query.status;
    if (query.type) where.type = query.type;
    const [data, total] = await Promise.all([
      this.prisma.disciplinaryAction.findMany({
        where, skip: (page - 1) * limit, take: limit, orderBy: { issuedAt: 'desc' },
        include: this.include(),
      }),
      this.prisma.disciplinaryAction.count({ where }),
    ]);
    return { data, total, page, limit, totalPages: Math.ceil(total / limit) };
  }

  async findOne(id: string) {
    const row = await this.prisma.disciplinaryAction.findFirst({
      where: { id, deletedAt: null },
      include: this.include(),
    });
    if (!row) throw new NotFoundException('Disciplinary action not found');
    return row;
  }

  async create(dto: CreateDisciplinaryActionDto, userId: string) {
    const actionNumber = await this.codes.next({ entityType: 'DisciplinaryAction', companyId: dto.companyId });
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
        issuedById: userId,
      },
      include: this.include(),
    });
    await this.audit.log({
      userId, action: 'CREATE', entityType: 'DisciplinaryAction', entityId: row.id,
      newValue: row as unknown as Record<string, unknown>,
    });

    // Auto-create the deduction if a fine was specified at creation time.
    if (dto.fineAmount && dto.fineAmount > 0) {
      try {
        await this.applyFine(row.id, userId);
      } catch (err) {
        this.logger.warn(
          `Auto-fine deduction failed for ${row.id}: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }
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

  async update(id: string, dto: UpdateDisciplinaryActionDto, userId: string) {
    const existing = await this.findOne(id);
    const data: Record<string, unknown> = {};
    if (dto.type !== undefined) data.type = dto.type;
    if (dto.disputeId !== undefined) data.disputeId = dto.disputeId;
    if (dto.issuedAt !== undefined) data.issuedAt = new Date(dto.issuedAt);
    if (dto.effectiveFrom !== undefined) data.effectiveFrom = dto.effectiveFrom ? new Date(dto.effectiveFrom) : null;
    if (dto.effectiveTo !== undefined) data.effectiveTo = dto.effectiveTo ? new Date(dto.effectiveTo) : null;
    if (dto.reason !== undefined) data.reason = dto.reason;
    if (dto.evidence !== undefined) data.evidence = dto.evidence;
    if (dto.employeeResponse !== undefined) data.employeeResponse = dto.employeeResponse;
    if (dto.notes !== undefined) data.notes = dto.notes;
    if (dto.status !== undefined) data.status = dto.status;
    if (dto.fineAmount !== undefined) data.fineAmount = dto.fineAmount;
    const row = await this.prisma.disciplinaryAction.update({ where: { id }, data, include: this.include() });
    await this.audit.log({
      userId, action: 'UPDATE', entityType: 'DisciplinaryAction', entityId: id,
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

  async remove(id: string, userId: string) {
    const existing = await this.findOne(id);
    await this.prisma.disciplinaryAction.update({ where: { id }, data: { deletedAt: new Date() } });
    await this.audit.log({
      userId, action: 'DELETE', entityType: 'DisciplinaryAction', entityId: id,
      oldValue: existing as unknown as Record<string, unknown>,
    });
    return { success: true };
  }
}
