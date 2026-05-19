import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { AccessLevel, NotificationPriority, NotificationType } from '@prisma/client';
import { AuthUser } from '../../../common/decorators/current-user.decorator';
import { applyCompanyScopeWhere, assertCanAccessCompanyFromUser } from '../../../common/services';
import { PrismaService } from '../../../prisma/prisma.service';
import { AuditLogsService } from '../../audit-logs/audit-logs.service';
import { EntityCodeGeneratorService } from '../../entity-code-generator/entity-code-generator.service';
import { NotificationsService } from '../../notifications/notifications.service';
import {
  CreateDirectGrievanceDto,
  CreateEmploymentDisputeDto,
} from './dto/create-employment-dispute.dto';
import {
  MediateDisputeDto,
  ReferCmaDisputeDto,
  ResolveDisputeDto,
  UpdateEmploymentDisputeDto,
} from './dto/update-employment-dispute.dto';

@Injectable()
export class EmploymentDisputesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditLogsService,
    private readonly codes: EntityCodeGeneratorService,
    private readonly notifications: NotificationsService,
  ) {}

  private include() {
    return {
      employee: {
        select: {
          id: true,
          employeeCode: true,
          fullName: true,
          firstName: true,
          lastName: true,
          department: { select: { name: true } },
          position: { select: { title: true } },
        },
      },
      raisedBy: { select: { id: true, fullName: true } },
      division: { select: { id: true, name: true, code: true } },
      branch: { select: { id: true, name: true, code: true } },
      mediatedBy: { select: { id: true, fullName: true } },
      cmaReferredBy: { select: { id: true, fullName: true } },
      resolvedBy: { select: { id: true, fullName: true } },
      disciplinaryActions: { where: { deletedAt: null }, orderBy: { issuedAt: 'desc' as const } },
    };
  }

  async findAll(query: {
    page?: number;
    limit?: number;
    companyId?: string;
    divisionId?: string;
    branchId?: string;
    employeeId?: string;
    status?: string;
    directToGroupHr?: boolean;
  }, user: AuthUser) {
    const page = Number(query.page) || 1;
    const limit = Number(query.limit) || 50;
    const where: Record<string, unknown> = { deletedAt: null };
    applyCompanyScopeWhere(where, user, query.companyId);
    if (query.divisionId) where.divisionId = query.divisionId;
    if (query.branchId) where.branchId = query.branchId;
    if (query.employeeId) where.employeeId = query.employeeId;
    if (query.status) where.status = query.status;
    if (query.directToGroupHr !== undefined) where.directToGroupHr = query.directToGroupHr;
    const [data, total] = await Promise.all([
      this.prisma.employmentDispute.findMany({
        where,
        skip: (page - 1) * limit,
        take: limit,
        orderBy: { raisedAt: 'desc' },
        include: this.include(),
      }),
      this.prisma.employmentDispute.count({ where }),
    ]);
    return { data, total, page, limit, totalPages: Math.ceil(total / limit) };
  }

  async findOne(id: string, user: AuthUser) {
    const where: Record<string, unknown> = { id, deletedAt: null };
    applyCompanyScopeWhere(where, user);
    const row = await this.prisma.employmentDispute.findFirst({
      where,
      include: this.include(),
    });
    if (!row) throw new NotFoundException('Dispute not found');
    return row;
  }

  async create(dto: CreateEmploymentDisputeDto, user: AuthUser) {
    assertCanAccessCompanyFromUser(user, dto.companyId, AccessLevel.WRITE);
    const hierarchy = await this.resolveEmployeeHierarchy(
      dto.companyId,
      dto.employeeId,
      dto.divisionId,
      dto.branchId,
    );
    const disputeNumber = await this.codes.next({
      entityType: 'EmploymentDispute',
      companyId: dto.companyId,
    });
    const row = await this.prisma.employmentDispute.create({
      data: {
        disputeNumber,
        companyId: dto.companyId,
        divisionId: hierarchy.divisionId,
        branchId: hierarchy.branchId,
        employeeId: dto.employeeId,
        raisedById: user.id,
        type: dto.type,
        raisedAt: new Date(dto.raisedAt),
        summary: dto.summary,
        initialPosition: dto.initialPosition,
        notes: dto.notes,
        status: 'RAISED',
      },
      include: this.include(),
    });
    await this.audit.log({
      userId: user.id,
      action: 'CREATE',
      entityType: 'EmploymentDispute',
      entityId: row.id,
      newValue: row as unknown as Record<string, unknown>,
    });
    return row;
  }

  async createDirectGrievance(dto: CreateDirectGrievanceDto, user: AuthUser) {
    assertCanAccessCompanyFromUser(user, dto.companyId, AccessLevel.READ);
    const hierarchy = await this.resolveEmployeeHierarchy(dto.companyId, dto.employeeId);
    const disputeNumber = await this.codes.next({
      entityType: 'EmploymentDispute',
      companyId: dto.companyId,
    });
    const row = await this.prisma.employmentDispute.create({
      data: {
        disputeNumber,
        companyId: dto.companyId,
        divisionId: hierarchy.divisionId,
        branchId: hierarchy.branchId,
        employeeId: dto.employeeId,
        raisedById: user.id,
        type: 'GRIEVANCE',
        status: 'RAISED',
        directToGroupHr: true,
        raisedAt: new Date(),
        summary: dto.summary,
        initialPosition: dto.initialPosition,
        notes: dto.notes,
      },
      include: this.include(),
    });

    const groupHrRecipients = await this.findGroupHrRecipients();
    await Promise.allSettled(
      groupHrRecipients.map((recipient) =>
        this.notifications.sendNotification({
          recipientUserId: recipient.id,
          companyId: row.companyId,
          title: `Direct HR grievance ${row.disputeNumber}`,
          message: `${row.employee.fullName} submitted a direct grievance to Group HR.`,
          notificationType: NotificationType.HR_ALERT,
          priority: NotificationPriority.CRITICAL,
          linkedEntityType: 'EmploymentDispute',
          linkedEntityId: row.id,
          actionUrl: `/hr/employment-disputes/${row.id}`,
          emailAddress: recipient.email,
        }),
      ),
    );
    if (groupHrRecipients.length > 0) {
      const notifiedAt = new Date();
      await this.prisma.employmentDispute.update({
        where: { id: row.id },
        data: { groupHrNotifiedAt: notifiedAt },
      });
      row.groupHrNotifiedAt = notifiedAt;
    }

    await this.audit.log({
      userId: user.id,
      action: 'DIRECT_GRIEVANCE_CREATE',
      entityType: 'EmploymentDispute',
      entityId: row.id,
      companyId: row.companyId,
      newValue: {
        disputeNumber: row.disputeNumber,
        employeeId: row.employeeId,
        directToGroupHr: true,
        notifiedGroupHrUsers: groupHrRecipients.length,
      },
    });
    return row;
  }

  async update(id: string, dto: UpdateEmploymentDisputeDto, user: AuthUser) {
    const existing = await this.findOne(id, user);
    const data: Record<string, unknown> = {};
    if (dto.type !== undefined) data.type = dto.type;
    if (dto.summary !== undefined) data.summary = dto.summary;
    if (dto.initialPosition !== undefined) data.initialPosition = dto.initialPosition;
    if (dto.notes !== undefined) data.notes = dto.notes;
    if (dto.raisedAt !== undefined) data.raisedAt = new Date(dto.raisedAt);
    const row = await this.prisma.employmentDispute.update({
      where: { id },
      data,
      include: this.include(),
    });
    await this.audit.log({
      userId: user.id,
      action: 'UPDATE',
      entityType: 'EmploymentDispute',
      entityId: id,
      oldValue: existing as unknown as Record<string, unknown>,
      newValue: row as unknown as Record<string, unknown>,
    });
    return row;
  }

  async startMediation(id: string, dto: MediateDisputeDto, user: AuthUser) {
    const existing = await this.findOne(id, user);
    if (!['RAISED'].includes(existing.status)) {
      throw new BadRequestException('Only RAISED disputes can move to internal mediation');
    }
    const row = await this.prisma.employmentDispute.update({
      where: { id },
      data: {
        status: 'INTERNAL_MEDIATION',
        mediatedById: user.id,
        mediatedAt: new Date(),
        mediationOutcome: dto.mediationOutcome,
      },
      include: this.include(),
    });
    await this.audit.log({
      userId: user.id,
      action: 'UPDATE',
      entityType: 'EmploymentDispute',
      entityId: id,
      oldValue: { status: existing.status },
      newValue: { status: 'INTERNAL_MEDIATION' },
    });
    return row;
  }

  async referToCma(id: string, dto: ReferCmaDisputeDto, user: AuthUser) {
    const existing = await this.findOne(id, user);
    if (!['RAISED', 'INTERNAL_MEDIATION'].includes(existing.status)) {
      throw new BadRequestException('Dispute cannot be referred to CMA in its current status');
    }
    const row = await this.prisma.employmentDispute.update({
      where: { id },
      data: {
        status: 'CMA_REFERRED',
        cmaReferredById: user.id,
        cmaReferredAt: new Date(),
        cmaReferenceNumber: dto.cmaReferenceNumber,
        cmaHearingDate: dto.cmaHearingDate ? new Date(dto.cmaHearingDate) : undefined,
        cmaArbitrator: dto.cmaArbitrator,
      },
      include: this.include(),
    });
    await this.audit.log({
      userId: user.id,
      action: 'UPDATE',
      entityType: 'EmploymentDispute',
      entityId: id,
      oldValue: { status: existing.status },
      newValue: { status: 'CMA_REFERRED', ...dto },
    });
    return row;
  }

  async resolve(id: string, dto: ResolveDisputeDto, user: AuthUser) {
    const existing = await this.findOne(id, user);
    if (['RESOLVED', 'DISMISSED', 'WITHDRAWN'].includes(existing.status)) {
      throw new BadRequestException('Dispute is already closed');
    }
    const row = await this.prisma.employmentDispute.update({
      where: { id },
      data: {
        status: 'RESOLVED',
        resolvedById: user.id,
        resolvedAt: new Date(),
        resolutionType: dto.resolutionType,
        resolutionAmount: dto.resolutionAmount,
        resolutionNotes: dto.resolutionNotes,
      },
      include: this.include(),
    });
    await this.audit.log({
      userId: user.id,
      action: 'UPDATE',
      entityType: 'EmploymentDispute',
      entityId: id,
      oldValue: { status: existing.status },
      newValue: { status: 'RESOLVED', ...dto },
    });
    return row;
  }

  async withdraw(id: string, user: AuthUser) {
    const existing = await this.findOne(id, user);
    if (['RESOLVED', 'DISMISSED', 'WITHDRAWN'].includes(existing.status)) {
      throw new BadRequestException('Dispute is already closed');
    }
    const row = await this.prisma.employmentDispute.update({
      where: { id },
      data: { status: 'WITHDRAWN', resolvedById: user.id, resolvedAt: new Date() },
      include: this.include(),
    });
    await this.audit.log({
      userId: user.id,
      action: 'UPDATE',
      entityType: 'EmploymentDispute',
      entityId: id,
      oldValue: { status: existing.status },
      newValue: { status: 'WITHDRAWN' },
    });
    return row;
  }

  async remove(id: string, user: AuthUser) {
    const existing = await this.findOne(id, user);
    await this.prisma.employmentDispute.update({ where: { id }, data: { deletedAt: new Date() } });
    await this.audit.log({
      userId: user.id,
      action: 'DELETE',
      entityType: 'EmploymentDispute',
      entityId: id,
      oldValue: existing as unknown as Record<string, unknown>,
    });
    return { success: true };
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
    if (!employee) throw new BadRequestException('Employee does not belong to this company');

    const divisionId = requestedDivisionId ?? employee.divisionId;
    const branchId = requestedBranchId ?? employee.branchId;
    await this.assertHierarchyBelongsToCompany(companyId, divisionId, branchId);
    return { divisionId, branchId };
  }

  private async assertHierarchyBelongsToCompany(
    companyId: string,
    divisionId?: string | null,
    branchId?: string | null,
  ) {
    if (divisionId) {
      const division = await this.prisma.division.findFirst({
        where: { id: divisionId, companyId, deletedAt: null },
        select: { id: true },
      });
      if (!division) throw new BadRequestException('Division does not belong to this company');
    }
    if (branchId) {
      const branch = await this.prisma.branch.findFirst({
        where: {
          id: branchId,
          deletedAt: null,
          division: { companyId },
          ...(divisionId ? { divisionId } : {}),
        },
        select: { id: true },
      });
      if (!branch) throw new BadRequestException('Branch does not belong to this company/division');
    }
  }

  private async findGroupHrRecipients() {
    return this.prisma.user.findMany({
      where: {
        status: 'ACTIVE',
        deletedAt: null,
        userRoles: { some: { role: { name: 'GROUP_HR_DIRECTOR' } } },
      },
      select: { id: true, email: true },
    });
  }
}
