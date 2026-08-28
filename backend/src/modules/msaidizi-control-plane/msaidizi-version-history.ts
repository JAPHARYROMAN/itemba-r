import { MsaidiziSchedule, Prisma } from '@prisma/client';

export type MsaidiziScheduleSnapshotSource = MsaidiziSchedule & {
  mandate: { companyId: string | null };
};

/** Builds a complete immutable schedule snapshot from a row read after its CAS write. */
export function msaidiziScheduleVersionSnapshot(
  schedule: MsaidiziScheduleSnapshotSource,
  changeType: string,
  changedByUserId: string | null,
): Prisma.MsaidiziScheduleVersionUncheckedCreateInput {
  return {
    scheduleId: schedule.id,
    version: schedule.version,
    changeType,
    changedByUserId,
    principalId: schedule.principalId,
    mandateId: schedule.mandateId,
    companyId: schedule.mandate.companyId,
    createdByUserId: schedule.createdByUserId,
    name: schedule.name,
    status: schedule.status,
    cronExpression: schedule.cronExpression,
    timezone: schedule.timezone,
    taskTemplate: schedule.taskTemplate as Prisma.InputJsonValue,
    concurrencyMode: schedule.concurrencyMode,
    nextRunAt: schedule.nextRunAt,
    lastRunAt: schedule.lastRunAt,
    sourceCreatedAt: schedule.createdAt,
    sourceUpdatedAt: schedule.updatedAt,
  };
}
