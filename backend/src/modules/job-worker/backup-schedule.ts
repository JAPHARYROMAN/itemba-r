import { BackupSchedule, Prisma } from '@prisma/client';

const DEFAULT_CUSTOM_INTERVAL_MINUTES = 24 * 60;

export function computeNextBackupRunAt(
  schedule: BackupSchedule | string | null | undefined,
  from: Date = new Date(),
  scheduleConfig?: Prisma.JsonValue | null,
): Date | null {
  const normalized = String(schedule ?? BackupSchedule.MANUAL).toUpperCase();
  const base = from.getTime();

  switch (normalized) {
    case BackupSchedule.HOURLY:
      return new Date(base + 60 * 60_000);
    case BackupSchedule.DAILY:
      return new Date(base + 24 * 60 * 60_000);
    case BackupSchedule.WEEKLY:
      return new Date(base + 7 * 24 * 60 * 60_000);
    case BackupSchedule.MONTHLY: {
      const next = new Date(from);
      next.setMonth(next.getMonth() + 1);
      return next;
    }
    case BackupSchedule.CUSTOM:
      return new Date(base + customIntervalMinutes(scheduleConfig) * 60_000);
    case BackupSchedule.MANUAL:
    default:
      return null;
  }
}

function customIntervalMinutes(scheduleConfig?: Prisma.JsonValue | null): number {
  if (!scheduleConfig || typeof scheduleConfig !== 'object' || Array.isArray(scheduleConfig)) {
    return DEFAULT_CUSTOM_INTERVAL_MINUTES;
  }

  const config = scheduleConfig as Record<string, unknown>;
  const explicitMinutes = positiveNumber(config.everyMinutes ?? config.intervalMinutes);
  if (explicitMinutes) return explicitMinutes;

  const hours = positiveNumber(config.everyHours ?? config.intervalHours);
  if (hours) return hours * 60;

  const days = positiveNumber(config.everyDays ?? config.intervalDays);
  if (days) return days * 24 * 60;

  return DEFAULT_CUSTOM_INTERVAL_MINUTES;
}

function positiveNumber(value: unknown): number | null {
  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}
