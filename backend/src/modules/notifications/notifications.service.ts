import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { NotificationType, NotificationPriority } from '@prisma/client';
import { EmailService } from '@common/services/email.service';

@Injectable()
export class NotificationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditLogsService,
    private readonly emailService: EmailService,
  ) {}

  async sendNotification(data: {
    recipientUserId: string;
    companyId?: string;
    title: string;
    message: string;
    notificationType: NotificationType;
    priority?: NotificationPriority;
    linkedEntityType?: string;
    linkedEntityId?: string;
    actionUrl?: string;
    expiresAt?: Date;
    emailAddress?: string;
  }): Promise<void> {
    const notificationNumber = `NOTIF-${Date.now()}-${Math.random().toString(36).substr(2, 5)}`;
    await this.prisma.notification.create({
      data: {
        notificationNumber,
        recipientUserId: data.recipientUserId,
        companyId: data.companyId,
        title: data.title,
        message: data.message,
        notificationType: data.notificationType,
        priority: data.priority ?? 'NORMAL',
        status: 'UNREAD',
        linkedEntityType: data.linkedEntityType,
        linkedEntityId: data.linkedEntityId,
        actionUrl: data.actionUrl,
        expiresAt: data.expiresAt,
      },
    });

    if (data.emailAddress) {
      await this.emailService.sendEmail(data.emailAddress, data.title, `<p>${data.message}</p>`, data.message);
    }
  }

  async findMyNotifications(user: any, query: any) {
    const { page = 1, limit = 20, status, type } = query;
    const skip = (Number(page) - 1) * Number(limit);
    const where: any = { recipientUserId: user.id };
    if (status) where.status = status;
    if (type) where.notificationType = type;
    const [data, total] = await Promise.all([
      this.prisma.notification.findMany({ where, skip, take: Number(limit), orderBy: { createdAt: 'desc' } }),
      this.prisma.notification.count({ where }),
    ]);
    return { data, total, page: Number(page), limit: Number(limit) };
  }

  async findOne(id: string, user: any) {
    const record = await this.prisma.notification.findFirst({ where: { id, recipientUserId: user.id } });
    if (!record) throw new NotFoundException('Notification not found');
    return record;
  }

  async markRead(id: string, user: any) {
    await this.findOne(id, user);
    return this.prisma.notification.update({ where: { id }, data: { status: 'READ', readAt: new Date() } });
  }

  async dismiss(id: string, user: any) {
    await this.findOne(id, user);
    return this.prisma.notification.update({ where: { id }, data: { status: 'DISMISSED', dismissedAt: new Date() } });
  }

  async markAllRead(user: any) {
    await this.prisma.notification.updateMany({
      where: { recipientUserId: user.id, status: 'UNREAD' },
      data: { status: 'READ', readAt: new Date() },
    });
    return { message: 'All notifications marked as read' };
  }

  async remove(id: string, user: any) {
    await this.findOne(id, user);
    await this.prisma.notification.delete({ where: { id } });
    return { message: 'Notification deleted' };
  }

  async getUnreadCount(user: any) {
    const count = await this.prisma.notification.count({ where: { recipientUserId: user.id, status: 'UNREAD' } });
    return { count };
  }
}
