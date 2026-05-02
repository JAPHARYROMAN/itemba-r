import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';
import { JobContext, JobHandlerRegistry, JobResult } from '../job-handler.registry';

/**
 * NOTIFICATION_DISPATCH handler. Reserved for fan-out of in-app notifications
 * to external channels (email, SMS, push). Notification status itself is a
 * read-state model in the schema, so this handler just records the dispatch
 * attempt against the underlying message provider and returns a structured
 * result that observability can roll up.
 *
 * Concrete delivery is delegated: when EmailService / an SMS provider is
 * wired up, replace the body of {@link dispatchOne} with the real call.
 *
 * Payload shape:
 *   { notificationId: string }
 *   OR
 *   { batch: string[] }
 */
@Injectable()
export class NotificationDispatchJobHandler implements OnModuleInit {
  private readonly logger = new Logger(NotificationDispatchJobHandler.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly registry: JobHandlerRegistry,
  ) {}

  onModuleInit(): void {
    this.registry.register('NOTIFICATION_DISPATCH', (ctx) => this.handle(ctx));
  }

  private async handle(ctx: JobContext): Promise<JobResult> {
    const single = ctx.payload.notificationId as string | undefined;
    const batch = (ctx.payload.batch as string[] | undefined) ?? [];
    const ids = single ? [single, ...batch] : batch;
    if (ids.length === 0) {
      return { data: { delivered: 0, note: 'No notification ids in payload' } };
    }

    const notifications = await this.prisma.notification.findMany({
      where: { id: { in: ids } },
      select: { id: true, recipientUserId: true, notificationType: true },
    });

    const dispatched: string[] = [];
    const failed: Array<{ id: string; reason: string }> = [];
    for (const n of notifications) {
      try {
        await this.dispatchOne(n.id);
        dispatched.push(n.id);
      } catch (err) {
        failed.push({
          id: n.id,
          reason: err instanceof Error ? err.message : String(err),
        });
      }
    }

    if (failed.length > 0 && dispatched.length === 0) {
      // Total failure — let the worker retry the whole batch.
      throw new Error(
        `Notification dispatch failed for all ${failed.length} target(s): ${failed
          .slice(0, 3)
          .map((f) => `${f.id}=${f.reason}`)
          .join('; ')}`,
      );
    }

    return { data: { dispatched, failed } };
  }

  /**
   * Hook point. Replace this implementation with real channel delivery once
   * EmailService / SMS providers are wired in.
   */
  private async dispatchOne(notificationId: string): Promise<void> {
    // No-op stub: in dev/staging the in-app notification IS the delivery.
    // Real channel dispatch will live here.
    this.logger.debug(`Dispatched notification ${notificationId} (stub)`);
  }
}
