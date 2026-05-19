import { execFile } from 'child_process';
import { createHash, randomUUID } from 'crypto';
import { createReadStream, promises as fs } from 'fs';
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
      process.env.BACKUPS_DIR ??
      process.env.BACKUP_STORAGE_PATH ??
      path.join(
        process.env.STORAGE_LOCAL_PATH ?? process.env.LOCAL_STORAGE_PATH ?? process.cwd(),
        'backups',
      );
    await fs.mkdir(backupsDir, { recursive: true });

    const databaseUrl = this.databaseUrlForPgTools(process.env.DATABASE_URL);
    if (!databaseUrl) throw new Error('DATABASE_URL is not set');

    const startedAt = new Date();
    const backupRun = await this.prisma.backupRun.findUnique({
      where: { id: backupRunId },
      select: {
        id: true,
        backupJobId: true,
        backupRunNumber: true,
        backupType: true,
        status: true,
        filePath: true,
        fileSizeBytes: true,
        checksum: true,
        metadata: true,
      },
    });
    if (!backupRun) throw new Error(`BackupRun ${backupRunId} not found`);
    if (backupRun.status === 'COMPLETED' && backupRun.filePath && backupRun.checksum) {
      return {
        data: {
          fileName: path.basename(backupRun.filePath),
          filePath: backupRun.filePath,
          sizeBytes: Number(backupRun.fileSizeBytes ?? 0),
          checksum: backupRun.checksum,
          skipped: true,
          reason: 'backup run already completed',
        },
      };
    }

    await this.prisma.backupRun.update({
      where: { id: backupRunId },
      data: { status: 'RUNNING', startedAt },
    });

    const fileName = this.safeBackupFileName(backupRun.backupRunNumber);
    const filePath = this.resolveBackupPath(backupsDir, fileName);
    const tempFilePath = this.resolveBackupPath(backupsDir, `${fileName}.tmp-${randomUUID()}`);

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
          `--file=${tempFilePath}`,
          `--dbname=${databaseUrl}`,
        ],
        { env: process.env, timeout: 30 * 60_000 },
      );

      await fs.rename(tempFilePath, filePath);
      const stat = await fs.stat(filePath);
      const checksum = await this.fileSha256(filePath);

      const durationMs = Date.now() - startedAt.getTime();
      const completedAt = new Date();
      await this.prisma.$transaction(async (tx) => {
        await tx.backupRun.update({
          where: { id: backupRunId },
          data: {
            status: 'COMPLETED',
            completedAt,
            durationMs,
            filePath,
            fileSizeBytes: BigInt(stat.size),
            checksum,
            metadata: {
              ...(backupRun.metadata &&
              typeof backupRun.metadata === 'object' &&
              !Array.isArray(backupRun.metadata)
                ? (backupRun.metadata as Record<string, unknown>)
                : {}),
              backupType: backupRun.backupType,
              checksumAlgorithm: 'sha256',
              artifactFormat: 'pg_dump/plain-sql',
            },
          },
        });
        if (backupRun.backupJobId) {
          await tx.backupJob.update({
            where: { id: backupRun.backupJobId },
            data: { lastRunAt: completedAt },
          });
        }
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
      await fs.unlink(tempFilePath).catch(() => undefined);
      await fs.unlink(filePath).catch(() => undefined);
      throw err;
    }
  }

  private async fileSha256(filePath: string): Promise<string> {
    const hash = createHash('sha256');
    await new Promise<void>((resolve, reject) => {
      const stream = createReadStream(filePath);
      stream.on('data', (chunk) => hash.update(chunk));
      stream.on('error', reject);
      stream.on('end', resolve);
    });
    return hash.digest('hex');
  }

  private safeBackupFileName(backupRunNumber: string): string {
    const normalized = backupRunNumber
      .replace(/[^A-Za-z0-9._-]/g, '_')
      .replace(/^\.+/, '')
      .slice(0, 120);
    return `backup-${normalized || 'run'}.sql`;
  }

  private resolveBackupPath(backupsDir: string, fileName: string): string {
    const root = path.resolve(backupsDir);
    const filePath = path.resolve(root, fileName);
    const relative = path.relative(root, filePath);
    if (relative.startsWith('..') || path.isAbsolute(relative)) {
      throw new Error('Resolved backup file path escapes BACKUPS_DIR');
    }
    return filePath;
  }

  private databaseUrlForPgTools(databaseUrl?: string): string | undefined {
    if (!databaseUrl) return databaseUrl;
    const allowedParams = new Set([
      'application_name',
      'channel_binding',
      'connect_timeout',
      'gssencmode',
      'keepalives',
      'keepalives_count',
      'keepalives_idle',
      'keepalives_interval',
      'sslcert',
      'sslcompression',
      'sslcrl',
      'sslkey',
      'sslmode',
      'sslrootcert',
      'target_session_attrs',
    ]);
    try {
      const url = new URL(databaseUrl);
      for (const key of Array.from(url.searchParams.keys())) {
        if (!allowedParams.has(key)) url.searchParams.delete(key);
      }
      return url.toString();
    } catch {
      return databaseUrl;
    }
  }
}
