import { BackupSchedule } from '@prisma/client';
import { computeNextBackupRunAt } from './backup-schedule';

describe('computeNextBackupRunAt', () => {
  const base = new Date('2026-05-02T10:00:00.000Z');

  it('does not schedule manual jobs', () => {
    expect(computeNextBackupRunAt(BackupSchedule.MANUAL, base)).toBeNull();
  });

  it('calculates fixed backup schedules from the supplied base time', () => {
    expect(computeNextBackupRunAt(BackupSchedule.HOURLY, base)?.toISOString()).toBe(
      '2026-05-02T11:00:00.000Z',
    );
    expect(computeNextBackupRunAt(BackupSchedule.DAILY, base)?.toISOString()).toBe(
      '2026-05-03T10:00:00.000Z',
    );
    expect(computeNextBackupRunAt(BackupSchedule.WEEKLY, base)?.toISOString()).toBe(
      '2026-05-09T10:00:00.000Z',
    );
  });

  it('supports custom minute, hour, and day intervals', () => {
    expect(
      computeNextBackupRunAt(BackupSchedule.CUSTOM, base, { everyMinutes: 15 })?.toISOString(),
    ).toBe('2026-05-02T10:15:00.000Z');
    expect(
      computeNextBackupRunAt(BackupSchedule.CUSTOM, base, { everyHours: 2 })?.toISOString(),
    ).toBe('2026-05-02T12:00:00.000Z');
    expect(
      computeNextBackupRunAt(BackupSchedule.CUSTOM, base, { everyDays: 3 })?.toISOString(),
    ).toBe('2026-05-05T10:00:00.000Z');
  });

  it('falls back to a daily cadence for invalid custom configs', () => {
    expect(
      computeNextBackupRunAt(BackupSchedule.CUSTOM, base, { everyMinutes: 0 })?.toISOString(),
    ).toBe('2026-05-03T10:00:00.000Z');
  });
});
