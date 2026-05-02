import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { NotificationsService } from '../notifications/notifications.service';

@Injectable()
export class ApprovalEngineService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditLogsService,
    private readonly notifications: NotificationsService,
  ) {}

  async findApplicableWorkflow(entityType: string, actionType: string, companyId?: string) {
    return this.prisma.approvalWorkflow.findFirst({
      where: {
        entityType,
        isActive: true,
        triggerAction: actionType as any,
        deletedAt: null,
        ...(companyId ? { companyId } : {}),
      },
      include: { steps: { where: { deletedAt: null }, orderBy: { stepOrder: 'asc' } } },
    });
  }

  async createApprovalRequest(data: {
    workflowId?: string;
    entityType: string;
    entityId: string;
    actionType: string;
    companyId?: string;
    requestedById: string;
    requestTitle: string;
    requestSummary?: string;
  }) {
    const approvalRequestNumber = `REQ-${Date.now()}-${Math.random().toString(36).substr(2, 5)}`;
    const request = await this.prisma.approvalRequest.create({
      data: {
        approvalRequestNumber,
        workflowId: data.workflowId,
        entityType: data.entityType,
        entityId: data.entityId,
        actionType: data.actionType as any,
        companyId: data.companyId,
        requestedById: data.requestedById,
        requestTitle: data.requestTitle,
        requestSummary: data.requestSummary,
        status: 'PENDING',
        submittedAt: new Date(),
      },
    });

    await this.prisma.approvalAction.create({
      data: { approvalRequestId: request.id, action: 'SUBMITTED', actionById: data.requestedById, stepOrder: 0 },
    });

    await this.audit.log({
      userId: data.requestedById,
      action: 'CREATE',
      entityType: 'ApprovalRequest',
      entityId: request.id,
      newValue: { status: 'PENDING', entityType: data.entityType, entityId: data.entityId },
    });

    return request;
  }

  async approveRequest(requestId: string, userId: string, comment?: string) {
    const request = await this.prisma.approvalRequest.findFirst({ where: { id: requestId } });
    if (!request) throw new NotFoundException('Approval request not found');
    if (request.status !== 'PENDING') throw new BadRequestException('Request is not in PENDING status');
    // Maker-checker: a user cannot approve a request they themselves submitted.
    if (request.requestedById === userId) {
      throw new BadRequestException(
        'Maker-checker: you cannot approve a request you submitted. Another approver must act.',
      );
    }

    const updated = await this.prisma.approvalRequest.update({
      where: { id: requestId },
      data: { status: 'APPROVED', approvedAt: new Date() },
    });

    await this.prisma.approvalAction.create({
      data: { approvalRequestId: requestId, action: 'APPROVED', actionById: userId, stepOrder: request.currentStepOrder, comment },
    });

    await this.notifications.sendNotification({
      recipientUserId: request.requestedById,
      companyId: request.companyId ?? undefined,
      title: 'Request Approved',
      message: `Your approval request "${request.requestTitle}" has been approved.`,
      notificationType: 'APPROVAL_APPROVED',
      priority: 'NORMAL',
      linkedEntityType: 'ApprovalRequest',
      linkedEntityId: requestId,
    });

    await this.audit.log({ userId, action: 'UPDATE', entityType: 'ApprovalRequest', entityId: requestId, newValue: { status: 'APPROVED' } });
    return updated;
  }

  async rejectRequest(requestId: string, userId: string, reason?: string) {
    const request = await this.prisma.approvalRequest.findFirst({ where: { id: requestId } });
    if (!request) throw new NotFoundException('Approval request not found');
    if (request.status !== 'PENDING') throw new BadRequestException('Request is not in PENDING status');
    if (request.requestedById === userId) {
      throw new BadRequestException(
        'Maker-checker: you cannot reject a request you submitted. Another approver must act.',
      );
    }

    const updated = await this.prisma.approvalRequest.update({
      where: { id: requestId },
      data: { status: 'REJECTED', rejectedAt: new Date() },
    });

    await this.prisma.approvalAction.create({
      data: { approvalRequestId: requestId, action: 'REJECTED', actionById: userId, stepOrder: request.currentStepOrder, reason },
    });

    await this.notifications.sendNotification({
      recipientUserId: request.requestedById,
      companyId: request.companyId ?? undefined,
      title: 'Request Rejected',
      message: `Your approval request "${request.requestTitle}" has been rejected. Reason: ${reason ?? 'No reason provided'}`,
      notificationType: 'APPROVAL_REJECTED',
      priority: 'HIGH',
      linkedEntityType: 'ApprovalRequest',
      linkedEntityId: requestId,
    });

    await this.audit.log({ userId, action: 'UPDATE', entityType: 'ApprovalRequest', entityId: requestId, newValue: { status: 'REJECTED' } });
    return updated;
  }

  async cancelRequest(requestId: string, userId: string, reason?: string) {
    const request = await this.prisma.approvalRequest.findFirst({ where: { id: requestId } });
    if (!request) throw new NotFoundException('Approval request not found');

    const updated = await this.prisma.approvalRequest.update({
      where: { id: requestId },
      data: { status: 'CANCELLED', cancelledAt: new Date() },
    });

    await this.prisma.approvalAction.create({
      data: { approvalRequestId: requestId, action: 'CANCELLED', actionById: userId, stepOrder: request.currentStepOrder, reason },
    });

    await this.audit.log({ userId, action: 'UPDATE', entityType: 'ApprovalRequest', entityId: requestId, newValue: { status: 'CANCELLED' } });
    return updated;
  }

  async isApproved(entityType: string, entityId: string): Promise<boolean> {
    const request = await this.prisma.approvalRequest.findFirst({
      where: { entityType, entityId, status: 'APPROVED' },
      orderBy: { createdAt: 'desc' },
    });
    return !!request;
  }
}
