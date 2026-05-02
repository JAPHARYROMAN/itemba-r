import { INestApplication } from '@nestjs/common';
import { AccessLevel, BackgroundJobStatus, DataExportStatus, DataExportType } from '@prisma/client';
import { promises as fs } from 'fs';
import * as os from 'os';
import * as path from 'path';
import { AuthUser } from '../src/common/decorators/current-user.decorator';
import { DataExportsService } from '../src/modules/data-exports/data-exports.service';
import { JobWorkerService } from '../src/modules/job-worker/job-worker.service';
import { PrismaService } from '../src/prisma/prisma.service';
import { createE2eApp } from './e2e-app';

jest.setTimeout(60_000);

type ExportArtifact = {
  exportNumber: string;
  exportType: DataExportType;
  companyId: string | null;
  rowCount: number;
  rows: unknown[];
};

describe('Job worker data exports (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let dataExports: DataExportsService;
  let worker: JobWorkerService;
  let exportDir = '';
  let originalExportsDir: string | undefined;

  const suffix = `${Date.now()}`;
  let groupId = '';
  let companyId = '';
  let userId = '';

  const exportLogIds: string[] = [];
  const backgroundJobIds: string[] = [];

  beforeAll(async () => {
    originalExportsDir = process.env.EXPORTS_DIR;
    exportDir = await fs.mkdtemp(path.join(os.tmpdir(), 'itemba-export-e2e-'));
    process.env.EXPORTS_DIR = exportDir;

    app = await createE2eApp();
    prisma = app.get(PrismaService);
    dataExports = app.get(DataExportsService);
    worker = app.get(JobWorkerService);

    const group = await prisma.group.create({
      data: {
        code: `E2EJOB${suffix.slice(-8)}`,
        name: `E2E Job Worker Group ${suffix}`,
      },
    });
    groupId = group.id;

    const company = await prisma.company.create({
      data: {
        groupId: group.id,
        code: `E2EJW${suffix.slice(-8)}`,
        name: `E2E Job Worker Company ${suffix}`,
      },
    });
    companyId = company.id;

    const user = await prisma.user.create({
      data: {
        email: `e2e-job-worker-${suffix}@itemba.local`,
        passwordHash: 'e2e-test-password-hash',
        fullName: 'E2E Job Worker User',
        status: 'ACTIVE',
        companyId: company.id,
      },
    });
    userId = user.id;
  });

  afterAll(async () => {
    if (prisma) {
      await prisma.backgroundJob.deleteMany({
        where: { id: { in: backgroundJobIds } },
      });
      await prisma.dataExportLog.deleteMany({
        where: { id: { in: exportLogIds } },
      });
      await prisma.auditLog.deleteMany({
        where: {
          OR: [{ userId }, { entityId: { in: exportLogIds } }, { companyId }],
        },
      });
      if (userId) {
        await prisma.user.deleteMany({ where: { id: userId } });
      }
      if (companyId) {
        await prisma.company.deleteMany({ where: { id: companyId } });
      }
      if (groupId) {
        await prisma.group.deleteMany({ where: { id: groupId } });
      }
    }

    if (app) {
      await app.close();
    }
    if (exportDir) {
      await fs.rm(exportDir, { recursive: true, force: true });
    }
    if (originalExportsDir === undefined) {
      delete process.env.EXPORTS_DIR;
    } else {
      process.env.EXPORTS_DIR = originalExportsDir;
    }
  });

  it('leases and completes a queued data export job with a scoped artifact', async () => {
    const authUser: AuthUser = {
      id: userId,
      email: `e2e-job-worker-${suffix}@itemba.local`,
      fullName: 'E2E Job Worker User',
      roles: ['Company User'],
      roleScopes: ['COMPANY'],
      permissions: [],
      companyId,
      companyAccess: [{ companyId, accessLevel: AccessLevel.MANAGE }],
    };

    const requested = await dataExports.create(
      {
        companyId,
        exportType: DataExportType.OTHER,
        filters: { source: 'job-worker-e2e' },
      },
      authUser,
    );
    exportLogIds.push(requested.id);

    expect(requested.status).toBe(DataExportStatus.REQUESTED);

    const queuedJob = await prisma.backgroundJob.findFirstOrThrow({
      where: { correlationId: requested.id, jobType: 'DATA_EXPORT' },
    });
    backgroundJobIds.push(queuedJob.id);
    expect(queuedJob.status).toBe(BackgroundJobStatus.QUEUED);
    expect(queuedJob.companyId).toBe(companyId);

    const drain = await worker.drainOnce(1);
    expect(drain.skipped).toBe(false);
    expect(drain.leased).toBe(1);
    expect(drain.settled).toEqual([{ jobId: queuedJob.id, status: 'fulfilled' }]);

    const completedExport = await prisma.dataExportLog.findUniqueOrThrow({
      where: { id: requested.id },
    });
    expect(completedExport.status).toBe(DataExportStatus.COMPLETED);
    expect(completedExport.fileName).toBe(`${requested.exportNumber}.json`);
    expect(completedExport.filePath).toBeTruthy();

    const filePath = completedExport.filePath!;
    const relativePath = path.relative(exportDir, filePath);
    expect(relativePath.startsWith('..')).toBe(false);
    expect(path.isAbsolute(relativePath)).toBe(false);

    await fs.access(filePath);
    const artifact = JSON.parse(await fs.readFile(filePath, 'utf8')) as ExportArtifact;
    expect(artifact.exportNumber).toBe(requested.exportNumber);
    expect(artifact.exportType).toBe(DataExportType.OTHER);
    expect(artifact.companyId).toBe(companyId);
    expect(artifact.rowCount).toBe(0);
    expect(artifact.rows).toEqual([]);

    const completedJob = await prisma.backgroundJob.findUniqueOrThrow({
      where: { id: queuedJob.id },
    });
    expect(completedJob.status).toBe(BackgroundJobStatus.COMPLETED);
    expect(completedJob.completedAt).toBeTruthy();
    expect(completedJob.errorMessage).toBeNull();

    const result = completedJob.result as Record<string, unknown>;
    expect(result.fileName).toBe(completedExport.fileName);
    expect(result.filePath).toBe(filePath);
    expect(result.rowCount).toBe(0);
  });
});
