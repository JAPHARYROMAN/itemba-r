import { execFile } from 'child_process';
import { createHash } from 'crypto';
import { promises as fs } from 'fs';
import * as path from 'path';
import { promisify } from 'util';
import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';
import { JobContext, JobHandlerRegistry, JobResult } from '../job-handler.registry';

const execFileAsync = promisify(execFile);

/**
 * BACKUP_RUN handler. Drives `pg_dump` against the database referenced by
 * `DATABASE_URL`, writes the artifact to `BACKUPS_DIR`, computes a SHA-256
 * checksum, and updates the BackupRun row to COMPLETED with file size +
 * checksum + duration. On failure, marks FAILED with the error message.
 *
 * Why pg_dump invoked here:
 *   - The worker process has the same DATABASE_URL as the API, so it can
 *     connect.
 *   - We capture file size + checksum so an external restore-test job can
 *     verify integrity without re-reading the file.
 *
 * Operationally the path can be swapped for a managed backup service (RDS
 * snapshot, etc.) by replacing this handler.
 */
@Injectable()
export class BackupRunJobHandler implements OnModuleInit {
  private readonly logger = new Logger(BackupRunJobHandler.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly registry: JobHandlerRegistry,
  ) {}

  onModuleInit(): void {
    this.registry.register('BACKUP_RUN', (ctx) => this.handle(ctx));
  }

  private async handle(ctx: JobContext): Promise<JobResult> {
    const backupRunId =
      (ctx.payload.backupRunId as string | undefined) ?? ctx.correlationId ?? null;
    if (!backupRunId) throw new Error('payload.backupRunId is required');

    const backupsDir =
      process.env.BACKUPS_DIR ?? path.join(process.cwd(), 'uploads', 'backups');
    await fs.mkdir(backupsDir, { recursive: true });

    const databaseUrl = process.env.DATABASE_URL;
    if (!databaseUrl) throw new Error('DATABASE_URL is not set');

    const startedAt = new Date();
    await this.prisma.backupRun.update({
      where: { id: backupRunId },
      data: { status: 'RUNNING', startedAt },
    });

    const fileName = `backup-${backupRunId}-${Date.now()}.sql`;
    const filePath = path.join(backupsDir, fileName);

    try {
      // pg_dump is invoked via execFile (no shell) so DATABASE_URL is not
      // interpreted by a shell. The connection string is passed as one argv
      // value through --dbname so pg_dump can resolve the target database.
      await execFileAsync(
        'pg_dump',
        [
          '--no-owner',
          '--no-privileges',
          '--format=plain',
          `--file=${filePath}`,
          `--dbname=${databaseUrl}`,
        ],
        { env: process.env, timeout: 30 * 60_000 },
      );

      const stat = await fs.stat(filePath);
      const checksum = await this.fileSha256(filePath);

      const durationMs = Date.now() - startedAt.getTime();
      await this.prisma.backupRun.update({
        where: { id: backupRunId },
        data: {
          status: 'COMPLETED',
          completedAt: new Date(),
          durationMs,
          filePath,
          fileSizeBytes: BigInt(stat.size),
          checksum,
        },
      });
      return { data: { fileName, filePath, sizeBytes: stat.size, checksum } };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      await this.prisma.backupRun
        .update({
          where: { id: backupRunId },
          data: {
            status: 'FAILED',
            completedAt: new Date(),
            errorMessage: message.slice(0, 4000),
          },
        })
        .catch(() => undefined);
      // Best-effort cleanup of partial file
      await fs.unlink(filePath).catch(() => undefined);
      throw err;
    }
  }

  private async fileSha256(filePath: string): Promise<string> {
    const data = await fs.readFile(filePath);
    return createHash('sha256').update(data).digest('hex');
  }
}
