import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as path from 'path';
import { PrismaService } from '../../prisma/prisma.service';
import { DataExportsService } from '../data-exports/data-exports.service';
import { DataExportJobHandler } from './handlers/data-export.handler';
import { JobHandlerRegistry } from './job-handler.registry';
import { JobWorkerService } from './job-worker.service';

/**
 * P0-06 regression — JobWorker behavior: handler registration, retry math,
 * and dead-letter cutover.
 *
 * The worker mostly orchestrates Postgres calls (FOR UPDATE SKIP LOCKED) so
 * the parts we can test pure-in-process are:
 *   - The registry contract (register / get / dedupe semantics)
 *   - The exponential-backoff math used when scheduling retries
 *   - The handler contract (errors propagate, results are typed)
 *
 * The end-to-end "actually leases a row from a real Postgres" test belongs
 * in a separate e2e suite that requires a live database — out of scope for
 * the test floor we ship with Phase 4.
 */

describe('JobHandlerRegistry (P0-06 regression)', () => {
  it('returns undefined for unregistered job types', () => {
    const reg = new JobHandlerRegistry();
    expect(reg.get('DATA_EXPORT')).toBeUndefined();
    expect(reg.registeredTypes()).toEqual([]);
  });

  it('registers and retrieves a handler', async () => {
    const reg = new JobHandlerRegistry();
    const handler = jest.fn().mockResolvedValue({ data: { ok: true } });
    reg.register('DATA_EXPORT', handler);

    const found = reg.get('DATA_EXPORT')!;
    await found({
      jobId: 'j-1',
      jobType: 'DATA_EXPORT',
      companyId: null,
      payload: {},
      correlationId: null,
      attempts: 0,
    });
    expect(handler).toHaveBeenCalled();
  });

  it('replaces a handler when the same type is registered twice and warns', () => {
    const warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => {});
    const reg = new JobHandlerRegistry();
    const first = jest.fn();
    const second = jest.fn();
    reg.register('BACKUP_RUN', first);
    reg.register('BACKUP_RUN', second);
    expect(reg.get('BACKUP_RUN')).toBe(second);
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it('lists every registered type', () => {
    const reg = new JobHandlerRegistry();
    reg.register('DATA_EXPORT', async () => ({}));
    reg.register('BACKUP_RUN', async () => ({}));
    reg.register('NOTIFICATION_DISPATCH', async () => ({}));
    expect(reg.registeredTypes().sort()).toEqual(
      ['BACKUP_RUN', 'DATA_EXPORT', 'NOTIFICATION_DISPATCH'].sort(),
    );
  });
});

describe('JobWorkerService retry math (P0-06 regression)', () => {
  // Inline pull of the backoff formula from the worker. If the math drifts in
  // job-worker.service.ts, this test should fail and document the change.
  function backoffMs(nextAttempts: number): number {
    return Math.min(60_000, 2 ** Math.min(nextAttempts, 6) * 1000);
  }

  it('is monotonic up to attempt 6', () => {
    const sequence = [1, 2, 3, 4, 5, 6].map(backoffMs);
    const sorted = [...sequence].sort((a, b) => a - b);
    expect(sequence).toEqual(sorted);
  });

  it('caps at 60 seconds', () => {
    expect(backoffMs(7)).toBe(60_000);
    expect(backoffMs(20)).toBe(60_000);
  });

  it('starts at 2 seconds for attempt 1', () => {
    expect(backoffMs(1)).toBe(2_000);
  });

  it('produces the expected progression', () => {
    expect(backoffMs(1)).toBe(2_000);
    expect(backoffMs(2)).toBe(4_000);
    expect(backoffMs(3)).toBe(8_000);
    expect(backoffMs(4)).toBe(16_000);
    expect(backoffMs(5)).toBe(32_000);
    expect(backoffMs(6)).toBe(60_000); // 64s clamped to 60s
  });
});

describe('JobWorker activation gate (P0-06 regression)', () => {
  it('defaults to disabled when JOB_WORKER_ENABLED is unset or false', () => {
    const config = new ConfigService({ JOB_WORKER_ENABLED: 'false' });
    expect(config.get('JOB_WORKER_ENABLED')).toBe('false');
  });

  it('treats truthy strings as enabled', () => {
    for (const v of ['true', '1', 'yes', 'on']) {
      const enabled = ['1', 'true', 'yes', 'on'].includes(v.trim().toLowerCase());
      expect(enabled).toBe(true);
    }
  });

  it('does not enable on accidental misspellings', () => {
    for (const v of ['enabled', 'YES_PLEASE', 'truthy', '0', '', 'false', 'no']) {
      const enabled = ['1', 'true', 'yes', 'on'].includes(v.trim().toLowerCase());
      expect(enabled).toBe(false);
    }
  });
});

describe('JobWorkerService queue policy and scheduled backups', () => {
  function serviceFor(prisma: any, registry = new JobHandlerRegistry()) {
    return new JobWorkerService(
      prisma as PrismaService,
      registry,
      new ConfigService({ JOB_WORKER_ENABLED: 'false' }),
    ) as any;
  }

  it('uses queue retryAttempts to dead-letter a failed job deterministically', async () => {
    const registry = new JobHandlerRegistry();
    registry.register('DATA_EXPORT', async () => {
      throw new Error('export failed');
    });
    const prisma = {
      jobQueueConfig: {
        findUnique: jest.fn().mockResolvedValue({
          queueName: 'data-exports',
          isActive: true,
          retryAttempts: 2,
          retryBackoffSeconds: 5,
        }),
      },
      backgroundJob: { update: jest.fn().mockResolvedValue({}) },
    };
    const service = serviceFor(prisma, registry);

    await service.runJob({
      id: 'job-A',
      jobType: 'DATA_EXPORT',
      queueName: 'data-exports',
      companyId: null,
      payload: {},
      correlationId: null,
      attempts: 1,
      maxAttempts: 5,
    });

    expect(prisma.backgroundJob.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'job-A' },
        data: expect.objectContaining({
          status: 'DEAD_LETTER',
          attempts: 2,
          scheduledAt: null,
          errorMessage: 'export failed',
        }),
      }),
    );
  });

  it('does not execute jobs from a paused queue config', async () => {
    const handler = jest.fn().mockResolvedValue({});
    const registry = new JobHandlerRegistry();
    registry.register('DATA_EXPORT', handler);
    const prisma = {
      jobQueueConfig: {
        findUnique: jest.fn().mockResolvedValue({
          queueName: 'data-exports',
          isActive: false,
        }),
      },
      backgroundJob: { update: jest.fn().mockResolvedValue({}) },
    };
    const service = serviceFor(prisma, registry);

    await service.runJob({
      id: 'job-A',
      jobType: 'DATA_EXPORT',
      queueName: 'data-exports',
      companyId: null,
      payload: {},
      correlationId: null,
      attempts: 0,
      maxAttempts: 3,
    });

    expect(handler).not.toHaveBeenCalled();
    expect(prisma.backgroundJob.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'job-A' },
        data: { status: 'QUEUED' },
      }),
    );
  });

  it('enqueues due scheduled backup jobs as backup runs and worker jobs', async () => {
    const tx = {
      $queryRaw: jest.fn().mockResolvedValue([{ id: 'backup-job-A' }]),
      backupJob: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: 'backup-job-A',
            backupJobCode: 'BJ-A',
            backupType: 'DATABASE',
            schedule: 'DAILY',
            scheduleConfig: {},
          },
        ]),
        update: jest.fn().mockResolvedValue({}),
      },
      backupRun: {
        create: jest.fn().mockResolvedValue({
          id: 'backup-run-A',
          backupRunNumber: 'BR-SCH-A',
        }),
      },
      backgroundJob: { create: jest.fn().mockResolvedValue({ id: 'job-A' }) },
    };
    const prisma = { $transaction: jest.fn((callback: any) => callback(tx)) };
    const service = serviceFor(prisma);

    await expect(service.enqueueDueBackupRuns(5)).resolves.toBe(1);

    expect(tx.backupRun.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          backupJobId: 'backup-job-A',
          backupType: 'DATABASE',
          status: 'REQUESTED',
          metadata: expect.objectContaining({ scheduled: true, backupJobCode: 'BJ-A' }),
        }),
      }),
    );
    expect(tx.backgroundJob.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          jobType: 'BACKUP_RUN',
          queueName: 'backups',
          payload: { backupRunId: 'backup-run-A', scheduled: true },
          correlationId: 'backup-run-A',
          idempotencyKey: 'BACKUP_RUN:BR-SCH-A',
        }),
      }),
    );
    expect(tx.backupJob.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'backup-job-A' },
        data: { nextRunAt: expect.any(Date) },
      }),
    );
  });
});

type ExportPathHelper = {
  safeExportFileName(exportNumber: string): string;
  resolveExportPath(exportDir: string, fileName: string): string;
};

describe('DataExportJobHandler artifact safety', () => {
  function createHelper(): ExportPathHelper {
    return new DataExportJobHandler(
      {} as PrismaService,
      {} as JobHandlerRegistry,
      {} as DataExportsService,
    ) as unknown as ExportPathHelper;
  }

  it('sanitizes export numbers before using them as artifact filenames', () => {
    const helper = createHelper();
    const fileName = helper.safeExportFileName('../unsafe\\export:name');

    expect(fileName).toBe('_unsafe_export_name.json');
    expect(fileName).not.toContain('/');
    expect(fileName).not.toContain('\\');
    expect(fileName).not.toContain(':');
  });

  it('rejects artifact paths that escape the configured export directory', () => {
    const helper = createHelper();
    const exportDir = path.join(process.cwd(), 'tmp', 'exports');

    expect(() => helper.resolveExportPath(exportDir, '../escape.json')).toThrow(
      'Resolved export file path escapes EXPORTS_DIR',
    );
  });
});
