import { Injectable, NotFoundException, ForbiddenException } from '@nestjs/common';
import { AuditSeverity } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { AuthUser } from '../../common/decorators/current-user.decorator';

@Injectable()
export class SupportTicketCommentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditLogs: AuditLogsService,
  ) {}

  async addComment(ticketId: string, dto: any, user: AuthUser) {
    if (dto.internal && !user.permissions?.includes('support.comments.manage')) {
      throw new ForbiddenException('You do not have permission to add internal comments');
    }
    const comment = await this.prisma.supportTicketComment.create({
      data: {
        supportTicketId: ticketId,
        comment: dto.comment,
        internal: dto.internal ?? false,
        userId: user.id,
      },
    });
    await this.auditLogs.log({ action: 'SUPPORT_COMMENT_ADDED', entityType: 'SupportTicketComment', entityId: comment.id, userId: user.id, severity: AuditSeverity.LOW });
    return comment;
  }

  async getComments(ticketId: string, user: AuthUser) {
    const canViewInternal = user.permissions?.includes('support.internal_comments.view');
    return this.prisma.supportTicketComment.findMany({
      where: { supportTicketId: ticketId, deletedAt: null, ...(canViewInternal ? {} : { internal: false }) },
      orderBy: { createdAt: 'asc' },
    });
  }

  async update(id: string, dto: any, userId: string) {
    const record = await this.prisma.supportTicketComment.findFirst({ where: { id, deletedAt: null } });
    if (!record) throw new NotFoundException('Comment not found');
    const updated = await this.prisma.supportTicketComment.update({ where: { id }, data: { comment: dto.comment } });
    await this.auditLogs.log({ action: 'SUPPORT_COMMENT_UPDATED', entityType: 'SupportTicketComment', entityId: id, userId, severity: AuditSeverity.LOW });
    return updated;
  }

  async remove(id: string, userId: string) {
    const record = await this.prisma.supportTicketComment.findFirst({ where: { id, deletedAt: null } });
    if (!record) throw new NotFoundException('Comment not found');
    await this.prisma.supportTicketComment.update({ where: { id }, data: { deletedAt: new Date() } });
    await this.auditLogs.log({ action: 'SUPPORT_COMMENT_DELETED', entityType: 'SupportTicketComment', entityId: id, userId, severity: AuditSeverity.LOW });
    return { success: true };
  }
}
