import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import {
  MsaidiziTaskStatus,
  NotificationPriority,
  NotificationStatus,
  NotificationType,
  Prisma,
} from '@prisma/client';
import { AuthUser } from '../../common/decorators/current-user.decorator';
import { EmailService } from '../../common/services/email.service';

type MsaidiziTerminalStatus = Extract<
  MsaidiziTaskStatus,
  'COMPLETED' | 'PARTIAL' | 'FAILED' | 'NEEDS_ATTENTION'
>;

type MsaidiziDeviceIncident = 'KILLED' | 'REVOKED' | 'UNKNOWN_ACTION';

interface NotificationQuery {
  page?: number | string;
  limit?: number | string;
  status?: NotificationStatus;
  type?: NotificationType;
}

const MSAIDIZI_TERMINAL_COPY: Record<
  MsaidiziTerminalStatus,
  { title: string; detail: string; priority: NotificationPriority; type: NotificationType }
> = {
  COMPLETED: {
    title: 'Msaidizi task completed',
    detail: 'completed successfully',
    priority: NotificationPriority.NORMAL,
    type: NotificationType.TASK_REMINDER,
  },
  PARTIAL: {
    title: 'Msaidizi task completed partially',
    detail: 'completed with unresolved steps',
    priority: NotificationPriority.HIGH,
    type: NotificationType.SYSTEM_ALERT,
  },
  FAILED: {
    title: 'Msaidizi task failed',
    detail: 'failed and stopped',
    priority: NotificationPriority.HIGH,
    type: NotificationType.SYSTEM_ALERT,
  },
  NEEDS_ATTENTION: {
    title: 'Msaidizi task needs attention',
    detail: 'stopped and needs your attention',
    priority: NotificationPriority.CRITICAL,
    type: NotificationType.SYSTEM_ALERT,
  },
};

@Injectable()
export class NotificationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditLogsService,
    private readonly emailService: EmailService,
  ) {}

  /**
   * Writes a terminal-task notification through the caller's transaction.
   * Callers invoke this only after their task CAS wins, so the state change,
   * event, and notification either commit together or all roll back together.
   */
  async notifyMsaidiziTaskTerminal(
    tx: Prisma.TransactionClient,
    taskId: string,
    status: MsaidiziTerminalStatus,
  ): Promise<boolean> {
    const task = await tx.msaidiziTask.findUnique({
      where: { id: taskId },
      select: {
        id: true,
        title: true,
        companyId: true,
        stateVersion: true,
        initiatedByUserId: true,
        schedule: { select: { createdByUserId: true } },
        mandate: { select: { createdByUserId: true } },
      },
    });
    if (!task) return false;
    const recipientUserId =
      task.initiatedByUserId ??
      task.schedule?.createdByUserId ??
      task.mandate?.createdByUserId ??
      null;
    if (!recipientUserId) return false;

    const copy = MSAIDIZI_TERMINAL_COPY[status];
    await tx.notification.create({
      data: {
        notificationNumber: `MSAIDIZI-TASK-${task.id}-${task.stateVersion}`,
        recipientUserId,
        companyId: task.companyId,
        title: copy.title,
        message: `“${task.title}” ${copy.detail}. Open the durable task for its evidence and next steps.`,
        notificationType: copy.type,
        priority: copy.priority,
        status: 'UNREAD',
        linkedEntityType: 'MsaidiziTask',
        linkedEntityId: task.id,
        actionUrl: `/msaidizi?workspace=tasks&taskId=${task.id}`,
      },
    });
    return true;
  }

  /**
   * Persists a governed device incident after the caller's device/action CAS.
   * Unknown-action incidents resolve the same task owner fallback as terminal
   * task notifications; operator kill/revoke incidents use the explicit actor.
   */
  async notifyMsaidiziDeviceIncident(
    tx: Prisma.TransactionClient,
    input: {
      kind: MsaidiziDeviceIncident;
      deviceId: string;
      recipientUserId?: string | null;
      taskId?: string | null;
      actionId?: string | null;
    },
  ): Promise<boolean> {
    const [device, task] = await Promise.all([
      tx.msaidiziDevice.findUnique({
        where: { id: input.deviceId },
        select: { id: true, name: true },
      }),
      input.taskId
        ? tx.msaidiziTask.findUnique({
            where: { id: input.taskId },
            select: {
              companyId: true,
              initiatedByUserId: true,
              schedule: { select: { createdByUserId: true } },
              mandate: { select: { createdByUserId: true } },
            },
          })
        : Promise.resolve(null),
    ]);
    if (!device) return false;
    const recipientUserId =
      input.recipientUserId ??
      task?.initiatedByUserId ??
      task?.schedule?.createdByUserId ??
      task?.mandate?.createdByUserId ??
      null;
    if (!recipientUserId) return false;

    const unknown = input.kind === 'UNKNOWN_ACTION';
    const killed = input.kind === 'KILLED';
    const title = unknown
      ? 'Msaidizi device action needs reconciliation'
      : killed
        ? 'Msaidizi device emergency-killed'
        : 'Msaidizi device enrollment revoked';
    const message = unknown
      ? `A host action on “${device.name}” has an unknown outcome. Inspect the device and reconcile it before allowing more work.`
      : killed
        ? `“${device.name}” was emergency-killed. Its leases were revoked and later dispatches are blocked.`
        : `“${device.name}” was revoked. Its enrollment can no longer receive Msaidizi work.`;
    const incidentKey = unknown ? input.actionId : input.kind;
    if (!incidentKey) return false;

    await tx.notification.create({
      data: {
        notificationNumber: `MSAIDIZI-DEVICE-${device.id}-${incidentKey}`,
        recipientUserId,
        companyId: task?.companyId ?? undefined,
        title,
        message,
        notificationType: NotificationType.SECURITY_ALERT,
        priority: unknown || killed ? NotificationPriority.CRITICAL : NotificationPriority.HIGH,
        status: 'UNREAD',
        linkedEntityType: 'MsaidiziDevice',
        linkedEntityId: device.id,
        actionUrl: `/msaidizi?workspace=devices&deviceId=${device.id}`,
      },
    });
    return true;
  }

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
      await this.emailService.sendEmail(
        data.emailAddress,
        data.title,
        `<p>${data.message}</p>`,
        data.message,
      );
    }
  }

  async findMyNotifications(user: AuthUser, query: NotificationQuery) {
    const { page = 1, limit = 20, status, type } = query;
    const skip = (Number(page) - 1) * Number(limit);
    const where: Prisma.NotificationWhereInput = { recipientUserId: user.id };
    if (status) where.status = status;
    if (type) where.notificationType = type;
    const [data, total] = await Promise.all([
      this.prisma.notification.findMany({
        where,
        skip,
        take: Number(limit),
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.notification.count({ where }),
    ]);
    return { data, total, page: Number(page), limit: Number(limit) };
  }

  async findOne(id: string, user: AuthUser) {
    const record = await this.prisma.notification.findFirst({
      where: { id, recipientUserId: user.id },
    });
    if (!record) throw new NotFoundException('Notification not found');
    return record;
  }

  async markRead(id: string, user: AuthUser) {
    const existing = await this.findOne(id, user);
    const updated = await this.prisma.notification.update({
      where: { id },
      data: { status: 'READ', readAt: new Date() },
    });
    await this.audit.log({
      action: 'NOTIFICATION_MARK_READ',
      entityType: 'Notification',
      entityId: id,
      userId: user.id,
      companyId: existing.companyId ?? undefined,
      oldValue: existing as unknown as Record<string, unknown>,
      newValue: updated as unknown as Record<string, unknown>,
    });
    return updated;
  }

  async dismiss(id: string, user: AuthUser) {
    const existing = await this.findOne(id, user);
    const updated = await this.prisma.notification.update({
      where: { id },
      data: { status: 'DISMISSED', dismissedAt: new Date() },
    });
    await this.audit.log({
      action: 'NOTIFICATION_DISMISS',
      entityType: 'Notification',
      entityId: id,
      userId: user.id,
      companyId: existing.companyId ?? undefined,
      oldValue: existing as unknown as Record<string, unknown>,
      newValue: updated as unknown as Record<string, unknown>,
    });
    return updated;
  }

  async markAllRead(user: AuthUser) {
    const result = await this.prisma.notification.updateMany({
      where: { recipientUserId: user.id, status: 'UNREAD' },
      data: { status: 'READ', readAt: new Date() },
    });
    await this.audit.log({
      action: 'NOTIFICATIONS_MARK_ALL_READ',
      entityType: 'Notification',
      entityId: user.id,
      userId: user.id,
      companyId: null,
      newValue: { updatedCount: result.count },
    });
    return { message: 'All notifications marked as read' };
  }

  async remove(id: string, user: AuthUser) {
    const existing = await this.findOne(id, user);
    await this.prisma.notification.delete({ where: { id } });
    await this.audit.log({
      action: 'NOTIFICATION_DELETE',
      entityType: 'Notification',
      entityId: id,
      userId: user.id,
      companyId: existing.companyId ?? undefined,
      oldValue: existing as unknown as Record<string, unknown>,
    });
    return { message: 'Notification deleted' };
  }

  async getUnreadCount(user: AuthUser) {
    const count = await this.prisma.notification.count({
      where: { recipientUserId: user.id, status: 'UNREAD' },
    });
    return { count };
  }
}
