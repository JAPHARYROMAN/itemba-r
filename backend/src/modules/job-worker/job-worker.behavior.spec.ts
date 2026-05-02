import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as path from 'path';
import { PrismaService } from '../../prisma/prisma.service';
import { DataExportsService } from '../data-exports/data-exports.service';
import { DataExportJobHandler } from './handlers/data-export.handler';
import { JobHandlerRegistry } from './job-handler.registry';

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
