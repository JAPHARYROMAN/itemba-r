import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { AccessLevel, RequisitionStatus } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { AuthUser } from '../../common/decorators/current-user.decorator';
import { CompanyScopeService } from '../../common/services';

// Fields a client is allowed to change via the generic update() endpoint. Status,
// approval/rejection metadata, companyId, requestedById and audit columns are
// deliberately excluded: those transitions belong to the dedicated
// submit/approve/reject methods and their status gates.
const UPDATABLE_FIELDS = [
  'divisionId',
  'branchId',
  'requestDate',
  'neededByDate',
  'purpose',
  'priority',
  'totalEstimatedAmount',
  'currency',
  'notes',
] as const;

// Only pre-approval requisitions may be edited via the generic update() endpoint.
const EDITABLE_STATUSES: RequisitionStatus[] = [
  RequisitionStatus.DRAFT,
  RequisitionStatus.SUBMITTED,
];

@Injectable()
export class PurchaseRequisitionsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditLogs: AuditLogsService,
    private readonly companyScope: CompanyScopeService,
  ) {}

  async findAll(query: any, user: AuthUser) {
    const { companyId, status, page = 1, limit = 20 } = query;
    const skip = (Number(page) - 1) * Number(limit);
    const where: any = {
      deletedAt: null,
      ...(await this.companyScope.companyWhereFor(user, companyId)),
    };
    if (status) where.status = status;
    const [items, total] = await Promise.all([
      this.prisma.purchaseRequisition.findMany({ where, skip, take: Number(limit), orderBy: { createdAt: 'desc' }, include: { lines: true } }),
      this.prisma.purchaseRequisition.count({ where }),
    ]);
    return { items, total, page: Number(page), limit: Number(limit) };
  }

  async findOne(id: string, user: AuthUser, minimum: AccessLevel = AccessLevel.READ) {
    const item = await this.prisma.purchaseRequisition.findFirst({ where: { id, deletedAt: null }, include: { lines: true } });
    if (!item) throw new NotFoundException('Purchase requisition not found');
    await this.companyScope.assertCanAccessCompany(user, item.companyId, minimum);
    return item;
  }

  async create(dto: any, user: AuthUser) {
    const { lines, ...rest } = dto;
    await this.companyScope.assertCanAccessCompany(user, rest.companyId, AccessLevel.WRITE);
    const item = await this.prisma.purchaseRequisition.create({
      data: {
        ...rest,
        status: 'DRAFT',
        requestedById: user.id,
        lines: lines ? { create: lines } : undefined,
      },
      include: { lines: true },
    });
    await this.auditLogs.log({ action: 'CREATE', entityType: 'PurchaseRequisition', entityId: item.id, userId: user.id, companyId: item.companyId });
    return item;
  }

  async update(id: string, dto: any, user: AuthUser) {
    const existing = await this.findOne(id, user, AccessLevel.WRITE);
    if (dto.companyId && dto.companyId !== existing.companyId) {
      throw new BadRequestException('Purchase requisition company cannot be changed');
    }
    if (!EDITABLE_STATUSES.includes(existing.status)) {
      throw new BadRequestException('Only DRAFT or SUBMITTED requisitions can be edited');
    }
    // Whitelist only user-editable fields; never let the client set status,
    // approval/rejection metadata, companyId or requestedById through here.
    const data: Record<string, unknown> = {};
    for (const field of UPDATABLE_FIELDS) {
      if (dto[field] !== undefined) data[field] = dto[field];
    }
    const updated = await this.prisma.purchaseRequisition.update({ where: { id }, data });
    await this.auditLogs.log({ action: 'UPDATE', entityType: 'PurchaseRequisition', entityId: id, userId: user.id, companyId: existing.companyId, oldValue: existing, newValue: updated });
    return updated;
  }

  async submit(id: string, user: AuthUser) {
    const existing = await this.findOne(id, user, AccessLevel.WRITE);
    if (existing.status !== 'DRAFT') throw new BadRequestException('Only DRAFT requisitions can be submitted');
    const updated = await this.prisma.purchaseRequisition.update({ where: { id }, data: { status: 'SUBMITTED' } });
    await this.auditLogs.log({ action: 'SUBMIT', entityType: 'PurchaseRequisition', entityId: id, userId: user.id, companyId: existing.companyId });
    return updated;
  }

  async approve(id: string, user: AuthUser) {
    const existing = await this.findOne(id, user, AccessLevel.WRITE);
    if (existing.status !== 'SUBMITTED') throw new BadRequestException('Only SUBMITTED requisitions can be approved');
    const updated = await this.prisma.purchaseRequisition.update({ where: { id }, data: { status: 'APPROVED', approvedAt: new Date(), approvedById: user.id } });
    await this.auditLogs.log({ action: 'APPROVE', entityType: 'PurchaseRequisition', entityId: id, userId: user.id, companyId: existing.companyId });
    return updated;
  }

  async reject(id: string, dto: any, user: AuthUser) {
    const existing = await this.findOne(id, user, AccessLevel.WRITE);
    if (!['SUBMITTED'].includes(existing.status)) throw new BadRequestException('Cannot reject in current status');
    const updated = await this.prisma.purchaseRequisition.update({ where: { id }, data: { status: 'REJECTED', rejectedAt: new Date(), rejectedById: user.id, rejectionReason: dto.reason } });
    await this.auditLogs.log({ action: 'REJECT', entityType: 'PurchaseRequisition', entityId: id, userId: user.id, companyId: existing.companyId });
    return updated;
  }
}
