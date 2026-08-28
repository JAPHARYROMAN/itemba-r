import { ConflictException, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  AuditChannel,
  AuditScopeKind,
  AuditSeverity,
  MsaidiziPrincipalStatus,
  MsaidiziScheduleStatus,
  MsaidiziTaskStatus,
  Prisma,
} from '@prisma/client';
import { AuthUser } from '../../common/decorators/current-user.decorator';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { AutonomyConfig } from '../msaidizi-tasks/autonomy.config';
import { msaidiziScheduleVersionSnapshot } from './msaidizi-version-history';

const OPERATOR_PAUSE_DETAIL =
  'Global Autopilot was disabled by an operator; re-enable and resume this task explicitly';

const SCHEDULE_HISTORY_INCLUDE = {
  mandate: { select: { companyId: true } },
} satisfies Prisma.MsaidiziScheduleInclude;

const DISABLE_TRANSACTION_ATTEMPTS = 3;

class RetryableSafetyDisableError extends ConflictException {
  constructor() {
    super('An active routine changed while Autopilot was being disabled; retry the operation');
  }
}

/**
 * Human-only, persisted safety latch for the global non-human principal.
 *
 * Disabling is deliberately stronger than changing a UI preference: the same
 * principal status is rechecked by task credentials and the host broker. The
 * transaction also moves work into cooperative pause states so re-enabling the
 * principal never resumes a task or routine by itself.
 */
@Injectable()
export class MsaidiziSafetyService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly autonomy: AutonomyConfig,
    private readonly config: ConfigService,
    private readonly audit: AuditLogsService,
  ) {}

  async status() {
    const principal = await this.prisma.msaidiziPrincipal.findUnique({
      where: { key: this.autonomy.principalKey },
      select: { id: true, status: true, updatedAt: true },
    });
    const principalId = principal?.id;
    const [activeSchedules, readyTasks, queuedTasks, runningTasks, pausingTasks, pausedTasks] =
      principalId
        ? await Promise.all([
            this.prisma.msaidiziSchedule.count({
              where: { principalId, status: MsaidiziScheduleStatus.ACTIVE },
            }),
            this.prisma.msaidiziTask.count({
              where: { principalId, status: MsaidiziTaskStatus.READY },
            }),
            this.prisma.msaidiziTask.count({
              where: { principalId, status: MsaidiziTaskStatus.QUEUED },
            }),
            this.prisma.msaidiziTask.count({
              where: { principalId, status: MsaidiziTaskStatus.RUNNING },
            }),
            this.prisma.msaidiziTask.count({
              where: { principalId, status: MsaidiziTaskStatus.PAUSING },
            }),
            this.prisma.msaidiziTask.count({
              where: { principalId, status: MsaidiziTaskStatus.PAUSED },
            }),
          ])
        : [0, 0, 0, 0, 0, 0];
    return this.snapshot(principal, {
      activeSchedules,
      readyTasks,
      queuedTasks,
      runningTasks,
      pausingTasks,
      pausedTasks,
    });
  }

  async disable(user: AuthUser) {
    let lastError: unknown;
    for (let attempt = 1; attempt <= DISABLE_TRANSACTION_ATTEMPTS; attempt += 1) {
      try {
        return await this.disableOnce(user);
      } catch (error) {
        lastError = error;
        if (!retryableDisableTransactionError(error) || attempt === DISABLE_TRANSACTION_ATTEMPTS) {
          throw error;
        }
      }
    }
    throw lastError;
  }

  private disableOnce(user: AuthUser) {
    return this.prisma.$transaction(
      async (tx) => {
        const now = new Date();
        const principal = await tx.msaidiziPrincipal.upsert({
          where: { key: this.autonomy.principalKey },
          update: { status: MsaidiziPrincipalStatus.DISABLED },
          create: {
            key: this.autonomy.principalKey,
            displayName: 'Msaidizi',
            status: MsaidiziPrincipalStatus.DISABLED,
            grants: this.deploymentGrants(),
            createdByUserId: user.id,
          },
        });
        const [queued, running, activeSchedules] = await Promise.all([
          tx.msaidiziTask.findMany({
            where: { principalId: principal.id, status: MsaidiziTaskStatus.QUEUED },
            select: { id: true, stateVersion: true },
          }),
          tx.msaidiziTask.findMany({
            where: { principalId: principal.id, status: MsaidiziTaskStatus.RUNNING },
            select: { id: true, stateVersion: true },
          }),
          tx.msaidiziSchedule.findMany({
            where: { principalId: principal.id, status: MsaidiziScheduleStatus.ACTIVE },
            include: SCHEDULE_HISTORY_INCLUDE,
          }),
        ]);
        const paused = await tx.msaidiziTask.updateMany({
          where: {
            id: { in: queued.map((task) => task.id) },
            status: MsaidiziTaskStatus.QUEUED,
          },
          data: {
            status: MsaidiziTaskStatus.PAUSED,
            pauseRequestedAt: now,
            statusDetail: OPERATOR_PAUSE_DETAIL,
            lastCheckpointAt: now,
            stateVersion: { increment: 1 },
          },
        });
        const pausing = await tx.msaidiziTask.updateMany({
          where: {
            id: { in: running.map((task) => task.id) },
            status: MsaidiziTaskStatus.RUNNING,
          },
          data: {
            status: MsaidiziTaskStatus.PAUSING,
            pauseRequestedAt: now,
            statusDetail: OPERATOR_PAUSE_DETAIL,
            lastCheckpointAt: now,
            stateVersion: { increment: 1 },
          },
        });
        let pausedScheduleCount = 0;
        for (const schedule of activeSchedules) {
          const won = await tx.msaidiziSchedule.updateMany({
            where: {
              id: schedule.id,
              principalId: principal.id,
              status: MsaidiziScheduleStatus.ACTIVE,
            },
            data: {
              status: MsaidiziScheduleStatus.PAUSED,
              version: { increment: 1 },
            },
          });
          if (won.count !== 1) {
            const current = await tx.msaidiziSchedule.findUnique({
              where: { id: schedule.id },
              include: SCHEDULE_HISTORY_INCLUDE,
            });
            if (current?.status === MsaidiziScheduleStatus.ACTIVE) {
              throw new RetryableSafetyDisableError();
            }
            continue;
          }
          const current = await tx.msaidiziSchedule.findUnique({
            where: { id: schedule.id },
            include: SCHEDULE_HISTORY_INCLUDE,
          });
          if (!current) throw new Error('Paused Msaidizi schedule disappeared during transaction');
          await tx.msaidiziScheduleVersion.create({
            data: msaidiziScheduleVersionSnapshot(
              current,
              'MSAIDIZI_SCHEDULE_AUTOPILOT_DISABLE',
              user.id,
            ),
          });
          pausedScheduleCount += 1;
        }
        const remainingActiveSchedules = await tx.msaidiziSchedule.count({
          where: { principalId: principal.id, status: MsaidiziScheduleStatus.ACTIVE },
        });
        if (remainingActiveSchedules !== 0) throw new RetryableSafetyDisableError();
        const events = [
          ...queued.map((task) => ({
            taskId: task.id,
            type: 'task.autopilot_disabled',
            actorType: 'HUMAN',
            actorId: user.id,
            payload: {
              from: MsaidiziTaskStatus.QUEUED,
              to: MsaidiziTaskStatus.PAUSED,
              previousStateVersion: task.stateVersion,
            } as Prisma.InputJsonObject,
          })),
          ...running.map((task) => ({
            taskId: task.id,
            type: 'task.autopilot_disabled',
            actorType: 'HUMAN',
            actorId: user.id,
            payload: {
              from: MsaidiziTaskStatus.RUNNING,
              to: MsaidiziTaskStatus.PAUSING,
              previousStateVersion: task.stateVersion,
            } as Prisma.InputJsonObject,
          })),
        ];
        if (events.length > 0) await tx.msaidiziTaskEvent.createMany({ data: events });
        await this.audit.logStrictInTransaction(tx, {
          action: 'MSAIDIZI_AUTOPILOT_DISABLED',
          entityType: 'MsaidiziPrincipal',
          entityId: principal.id,
          userId: user.id,
          scopeKind: AuditScopeKind.GLOBAL,
          companyScopeIds: [],
          severity: AuditSeverity.CRITICAL,
          channel: AuditChannel.WEB,
          principalType: 'MSAIDIZI',
          principalId: principal.id,
          metadata: {
            pausedQueuedTasks: paused.count,
            pausingRunningTasks: pausing.count,
            pausedSchedules: pausedScheduleCount,
          },
        });
        return {
          operatorLatch: 'DISABLED' as const,
          effectiveAutopilotEnabled: false,
          pausedQueuedTasks: paused.count,
          pausingRunningTasks: pausing.count,
          pausedSchedules: pausedScheduleCount,
          message:
            'No task or routine was resumed or cancelled; running steps pause cooperatively.',
        };
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
  }

  async enable(user: AuthUser) {
    return this.prisma.$transaction(async (tx) => {
      const principal = await tx.msaidiziPrincipal.upsert({
        where: { key: this.autonomy.principalKey },
        update: { status: MsaidiziPrincipalStatus.ACTIVE },
        create: {
          key: this.autonomy.principalKey,
          displayName: 'Msaidizi',
          status: MsaidiziPrincipalStatus.ACTIVE,
          grants: this.deploymentGrants(),
          createdByUserId: user.id,
        },
      });
      await this.audit.logStrictInTransaction(tx, {
        action: 'MSAIDIZI_AUTOPILOT_ENABLED',
        entityType: 'MsaidiziPrincipal',
        entityId: principal.id,
        userId: user.id,
        scopeKind: AuditScopeKind.GLOBAL,
        companyScopeIds: [],
        severity: AuditSeverity.HIGH,
        channel: AuditChannel.WEB,
        principalType: 'MSAIDIZI',
        principalId: principal.id,
        metadata: { tasksResumed: 0, schedulesActivated: 0 },
      });
      return {
        operatorLatch: 'ACTIVE' as const,
        effectiveAutopilotEnabled: this.deploymentAllowsAutopilot(),
        tasksResumed: 0,
        schedulesActivated: 0,
        message: 'Operator latch released. Resume tasks and activate routines explicitly.',
      };
    });
  }

  private snapshot(
    principal: { status: MsaidiziPrincipalStatus; updatedAt: Date } | null,
    counts: {
      activeSchedules: number;
      readyTasks: number;
      queuedTasks: number;
      runningTasks: number;
      pausingTasks: number;
      pausedTasks: number;
    },
  ) {
    const externalKillSwitchActive = truthy(
      this.config.get<string>('MSAIDIZI_GLOBAL_KILL_SWITCH', 'false'),
    );
    const operatorLatch = principal?.status ?? 'UNINITIALIZED';
    return {
      operatorLatch,
      effectiveAutopilotEnabled:
        operatorLatch === MsaidiziPrincipalStatus.ACTIVE &&
        this.deploymentAllowsAutopilot() &&
        !externalKillSwitchActive,
      deploymentAutonomyEnabled: this.autonomy.enabled,
      deploymentAutopilotEnabled: this.autonomy.autopilotEnabled,
      externalKillSwitchActive,
      lastChangedAt: principal?.updatedAt ?? null,
      ...counts,
    };
  }

  private deploymentAllowsAutopilot(): boolean {
    return (
      this.autonomy.enabled &&
      this.autonomy.autopilotEnabled &&
      !truthy(this.config.get<string>('MSAIDIZI_GLOBAL_KILL_SWITCH', 'false'))
    );
  }

  private deploymentGrants(): Prisma.InputJsonObject {
    return {
      scope: 'GROUP',
      authoritySource: 'deployment-policy',
      permissions: this.autonomy.principalGrants,
    };
  }
}

function truthy(value: string): boolean {
  return ['1', 'true', 'yes', 'on'].includes(value.trim().toLowerCase());
}

function retryableDisableTransactionError(error: unknown): boolean {
  return (
    error instanceof RetryableSafetyDisableError ||
    (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2034')
  );
}
