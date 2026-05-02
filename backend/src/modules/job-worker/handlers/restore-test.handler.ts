import { createHash } from 'crypto';
import { promises as fs } from 'fs';
import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';
import { JobContext, JobHandlerRegistry, JobResult } from '../job-handler.registry';

/**
 * P0-06 (cont.): RestoreTest verifier.
 *
 * Drains the BackgroundJob queue for `CUSTOM`-typed jobs whose payload
 * `kind === 'RESTORE_TEST'`. The job links to a {@link RestoreTest} row via
 * `correlationId = restoreTestId`. The handler:
 *
 *   1. Loads the RestoreTest and the linked BackupRun.
 *   2. For `CHECKSUM_VERIFY` and `METADATA_CHECK`: re-hashes the file at
 *      `BackupRun.filePath`, compares to `BackupRun.checksum`, and flips the
 *      RestoreTest to PASSED or FAILED with a result summary.
 *   3. For `TEST_RESTORE` / `FULL_RESTORE_DRILL` / `PARTIAL_RESTORE`: marks
 *      the RestoreTest FAILED with a "manual operation required" message —
 *      these need a real DR runbook (psql apply, etc.) and should not run
 *      automatically without operator scheduling.
 *
 * The point of this handler is to fulfil the audit promise that "backup ran"
 * is followed by "backup is verifiable" — so admins see real PASSED/FAILED
 * rows instead of a row that sits in PLANNED forever.
 *
 * The handler only fires on jobs explicitly enqueued by an admin or a
 * scheduled task; it never auto-creates verification work, by design.
 */
@Injectable()
export class RestoreTestJobHandler implements OnModuleInit {
  private readonly logger = new Logger(RestoreTestJobHandler.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly registry: JobHandlerRegistry,
  ) {}

  onModuleInit(): void {
    // No dedicated BackgroundJobType for restore tests; piggyback on CUSTOM
    // and route by `payload.kind === 'RESTORE_TEST'`. Adding a real enum
    // value would require a Prisma migration which Phase 5 does not pull.
    this.registry.register('CUSTOM', (ctx) => this.handle(ctx));
  }

  private async handle(ctx: JobContext): Promise<JobResult> {
    if ((ctx.payload as any).kind !== 'RESTORE_TEST') {
      // CUSTOM is a shared queue — this handler only consumes restore-test
      // jobs. Other consumers can add their own dispatch on `kind` later.
      return { data: { skipped: true, reason: 'unknown CUSTOM payload kind' } };
    }

    const restoreTestId =
      (ctx.payload.restoreTestId as string | undefined) ?? ctx.correlationId ?? null;
    if (!restoreTestId) throw new Error('payload.restoreTestId is required');

    const test = await this.prisma.restoreTest.findUnique({
      where: { id: restoreTestId },
      include: { backupRun: true },
    });
    if (!test) throw new Error(`RestoreTest ${restoreTestId} not found`);

    await this.prisma.restoreTest.update({
      where: { id: restoreTestId },
      data: { status: 'RUNNING', startedAt: new Date() },
    });

    let resultSummary = '';
    let passed = false;
    let issuesFound: string | null = null;

    try {
      if (test.testType === 'CHECKSUM_VERIFY' || test.testType === 'METADATA_CHECK') {
        if (!test.backupRun) {
          issuesFound = 'No linked BackupRun on this RestoreTest';
        } else if (!test.backupRun.filePath) {
          issuesFound = 'BackupRun has no filePath; backup may not have completed';
        } else if (!test.backupRun.checksum) {
          issuesFound =
            'BackupRun has no recorded checksum; cannot verify integrity. Re-run the backup with the updated handler.';
        } else {
          const actual = await this.fileSha256(test.backupRun.filePath);
          if (actual === test.backupRun.checksum) {
            passed = true;
            resultSummary = `SHA-256 verified (${test.backupRun.checksum.slice(0, 16)}…) for backup ${test.backupRun.backupRunNumber}`;
          } else {
            issuesFound = `Checksum mismatch: expected ${test.backupRun.checksum.slice(0, 16)}…, got ${actual.slice(0, 16)}…`;
          }
        }
      } else {
        // TEST_RESTORE / FULL_RESTORE_DRILL / PARTIAL_RESTORE — these are
        // out-of-band operations that an SRE should run from a runbook.
        // Mark FAILED with a clear reason rather than silently sit PLANNED.
        issuesFound =
          `RestoreTest type ${test.testType} requires an out-of-band runbook (psql apply, instance spin-up). ` +
          `Run the operator script and update this row manually with the result.`;
      }

      await this.prisma.restoreTest.update({
        where: { id: restoreTestId },
        data: {
          status: passed ? 'PASSED' : 'FAILED',
          completedAt: new Date(),
          resultSummary: resultSummary || (issuesFound ?? 'Verification failed'),
          issuesFound,
        },
      });

      return {
        data: {
          restoreTestId,
          backupRunId: test.backupRunId,
          testType: test.testType,
          passed,
          resultSummary,
          issuesFound,
        },
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      await this.prisma.restoreTest
        .update({
          where: { id: restoreTestId },
          data: {
            status: 'FAILED',
            completedAt: new Date(),
            issuesFound: message.slice(0, 4000),
          },
        })
        .catch(() => undefined);
      throw err;
    }
  }

  private async fileSha256(filePath: string): Promise<string> {
    const data = await fs.readFile(filePath);
    return createHash('sha256').update(data).digest('hex');
  }
}
