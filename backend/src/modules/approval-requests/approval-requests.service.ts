import { Injectable, NotFoundException, ForbiddenException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { CreateApprovalRequestDto } from './dto/create-approval-request.dto';
import { ApprovalActionDto } from './dto/approval-action.dto';

@Injectable()
export class ApprovalRequestsService {
  constructor(private readonly prisma: PrismaService, private readonly audit: AuditLogsService) {}

  async findAll(user: any, query: any) {
    const { page = 1, limit = 20, companyId, entityType, status, requestedById } = query;
    const skip = (Number(page) - 1) * Number(limit);
    const where: any = { deletedAt: null };
    if (companyId) where.companyId = companyId;
    else if (user.companyId) where.companyId = user.companyId;
    if (entityType) where.entityType = entityType;
    if (status) where.status = status;
    if (requestedById) where.requestedById = requestedById;
    const [data, total] = await Promise.all([
      this.prisma.approvalRequest.findMany({
        where,
        skip,
        take: Number(limit),
        orderBy: { createdAt: 'desc' },
        include: {
          requestedBy: { select: { id: true, fullName: true, email: true } },
          workflow: { select: { id: true, name: true } },
        },
      }),
      this.prisma.approvalRequest.count({ where }),
    ]);
    return { data, total, page: Number(page), limit: Number(limit) };
  }

  async findOne(id: string, user: any) {
    const record = await this.prisma.approvalRequest.findFirst({
      where: { id, deletedAt: null },
      include: {
        requestedBy: { select: { id: true, fullName: true, email: true } },
        workflow: { include: { steps: { where: { deletedAt: null }, orderBy: { stepOrder: 'asc' } } } },
        actions: { orderBy: { createdAt: 'asc' }, include: { actionBy: { select: { id: true, fullName: true, email: true } } } },
      },
    });
    if (!record) throw new NotFoundException('Approval request not found');
    return record;
  }

  async findPendingForMe(user: any, query: any) {
    const { page = 1, limit = 20 } = query;
    const skip = (Number(page) - 1) * Number(limit);
    const where: any = { status: 'PENDING', deletedAt: null };
    const [data, total] = await Promise.all([
      this.prisma.approvalRequest.findMany({
        where,
        skip,
        take: Number(limit),
        orderBy: { createdAt: 'desc' },
        include: { requestedBy: { select: { id: true, fullName: true, email: true } }, workflow: { select: { id: true, name: true } } },
      }),
      this.prisma.approvalRequest.count({ where }),
    ]);
    return { data, total, page: Number(page), limit: Number(limit) };
  }

  async findSubmittedByMe(user: any, query: any) {
    const { page = 1, limit = 20, status } = query;
    const skip = (Number(page) - 1) * Number(limit);
    const where: any = { requestedById: user.id, deletedAt: null };
    if (status) where.status = status;
    const [data, total] = await Promise.all([
      this.prisma.approvalRequest.findMany({
        where,
        skip,
        take: Number(limit),
        orderBy: { createdAt: 'desc' },
        include: { workflow: { select: { id: true, name: true } } },
      }),
      this.prisma.approvalRequest.count({ where }),
    ]);
    return { data, total, page: Number(page), limit: Number(limit) };
  }

  async create(dto: CreateApprovalRequestDto, user: any) {
    const approvalRequestNumber = `REQ-${Date.now()}`;
    const record = await this.prisma.approvalRequest.create({
      data: {
        approvalRequestNumber,
        workflowId: dto.workflowId,
        companyId: dto.companyId,
        entityType: dto.entityType,
        entityId: dto.entityId,
        requestTitle: dto.requestTitle,
        requestSummary: dto.requestSummary,
        actionType: dto.actionType,
        notes: dto.notes,
        status: 'DRAFT',
        requestedById: user.id,
      },
    });
    await this.audit.log({ userId: user.id, action: 'CREATE', entityType: 'ApprovalRequest', entityId: record.id, newValue: dto as any });
    return record;
  }

  async submit(id: string, user: any) {
    const record = await this.findOne(id, user);
    if (record.status !== 'DRAFT') throw new BadRequestException('Only DRAFT requests can be submitted');
    if (record.requestedById !== user.id) throw new ForbiddenException('Only the requester can submit this request');
    const updated = await this.prisma.approvalRequest.update({
      where: { id },
      data: { status: 'PENDING', submittedAt: new Date() },
    });
    await this.prisma.approvalAction.create({
      data: { approvalRequestId: id, action: 'SUBMITTED', actionById: user.id, stepOrder: 0, comment: 'Request submitted for approval' },
    });
    await this.audit.log({ userId: user.id, action: 'UPDATE', entityType: 'ApprovalRequest', entityId: id, newValue: { status: 'PENDING' } });
    return updated;
  }

  async approve(id: string, dto: ApprovalActionDto, user: any) {
    const record = await this.findOne(id, user);
    if (record.status !== 'PENDING') throw new BadRequestException('Only PENDING requests can be approved');
    if (record.requestedById === user.id) {
      throw new BadRequestException(
        'Maker-checker: you cannot approve a request you submitted. Another approver must act.',
      );
    }
    const updated = await this.prisma.approvalRequest.update({
      where: { id },
      data: { status: 'APPROVED', approvedAt: new Date() },
    });
    await this.prisma.approvalAction.create({
      data: { approvalRequestId: id, action: 'APPROVED', actionById: user.id, stepOrder: record.currentStepOrder, comment: dto.comment },
    });
    await this.audit.log({ userId: user.id, action: 'UPDATE', entityType: 'ApprovalRequest', entityId: id, newValue: { status: 'APPROVED' } });
    return updated;
  }

  async reject(id: string, dto: ApprovalActionDto, user: any) {
    const record = await this.findOne(id, user);
    if (record.status !== 'PENDING') throw new BadRequestException('Only PENDING requests can be rejected');
    if (record.requestedById === user.id) {
      throw new BadRequestException(
        'Maker-checker: you cannot reject a request you submitted. Another approver must act.',
      );
    }
    const updated = await this.prisma.approvalRequest.update({
      where: { id },
      data: { status: 'REJECTED', rejectedAt: new Date() },
    });
    await this.prisma.approvalAction.create({
      data: { approvalRequestId: id, action: 'REJECTED', actionById: user.id, stepOrder: record.currentStepOrder, reason: dto.reason, comment: dto.comment },
    });
    await this.audit.log({ userId: user.id, action: 'UPDATE', entityType: 'ApprovalRequest', entityId: id, newValue: { status: 'REJECTED' } });
    return updated;
  }

  async cancel(id: string, dto: ApprovalActionDto, user: any) {
    const record = await this.findOne(id, user);
    if (!['DRAFT', 'PENDING'].includes(record.status as string)) throw new BadRequestException('Cannot cancel this request');
    const updated = await this.prisma.approvalRequest.update({
      where: { id },
      data: { status: 'CANCELLED', cancelledAt: new Date() },
    });
    await this.prisma.approvalAction.create({
      data: { approvalRequestId: id, action: 'CANCELLED', actionById: user.id, stepOrder: record.currentStepOrder, reason: dto.reason, comment: dto.comment },
    });
    await this.audit.log({ userId: user.id, action: 'UPDATE', entityType: 'ApprovalRequest', entityId: id, newValue: { status: 'CANCELLED' } });
    return updated;
  }

  async addComment(id: string, dto: ApprovalActionDto, user: any) {
    const record = await this.findOne(id, user);
    const action = await this.prisma.approvalAction.create({
      data: { approvalRequestId: id, action: 'COMMENTED', actionById: user.id, stepOrder: record.currentStepOrder, comment: dto.comment },
    });
    await this.audit.log({ userId: user.id, action: 'UPDATE', entityType: 'ApprovalRequest', entityId: id, newValue: { comment: dto.comment } });
    return action;
  }
}
