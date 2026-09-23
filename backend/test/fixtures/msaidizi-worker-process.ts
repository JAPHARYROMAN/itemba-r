/** Disposable process-crash fixture. Never boots AppModule or production gates.
 * Synthetic manifest, token and CRUD admission ports; real worker, full step
 * handler, HTTP invoker, Prisma and audit writer. Not authorization evidence.
 */
import 'reflect-metadata';
import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Capability } from '../../src/common/capabilities/capability-manifest';
import { PersistenceSecretGuard } from '../../src/common/services/persistence-secret-guard.service';
import { EphemeralSecretFingerprintRegistry } from '../../src/common/services/ephemeral-secret-fingerprint-registry.service';
import { PrismaService } from '../../src/prisma/prisma.service';
import { AuditLogsService } from '../../src/modules/audit-logs/audit-logs.service';
import { JobHandlerRegistry } from '../../src/modules/job-worker/job-handler.registry';
import { JobWorkerService } from '../../src/modules/job-worker/job-worker.service';
import { MsaidiziTaskStepHandler } from '../../src/modules/msaidizi-task-runtime/msaidizi-task-step.handler';
import { MsaidiziTaskDispatcherService } from '../../src/modules/msaidizi-task-runtime/msaidizi-task-dispatcher.service';
import { CapabilityInvoker } from '../../src/modules/msaidizi/capability-invoker';
import { ManifestProvider } from '../../src/modules/msaidizi/manifest.provider';

async function send(message: Record<string, unknown>): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    if (!process.send || !process.connected) return reject(new Error('Fixture IPC is unavailable'));
    process.send(message, (error) => (error ? reject(error) : resolve()));
  });
}

async function main() {
  const database = new URL(process.env.DATABASE_URL ?? '');
  const receiver = new URL(process.env.MSAIDIZI_RESTART_RECEIVER ?? '');
  if (
    process.env.MSAIDIZI_CHAT_DISPOSABLE_DB !== '1' ||
    !['localhost', '127.0.0.1'].includes(database.hostname) ||
    !/^\/msaidizi_chat_proof(?:_[a-z0-9]+)?$/.test(database.pathname) ||
    receiver.protocol !== 'http:' ||
    receiver.hostname !== '127.0.0.1' ||
    receiver.username ||
    receiver.password ||
    receiver.pathname !== '/'
  ) {
    throw new Error('Restart fixture requires disposable PostgreSQL and a loopback-only receiver');
  }
  Logger.overrideLogger(false);
  // Pin one connection so the session-timezone regression is deterministic,
  // including on CI hosts whose PostgreSQL default happens to be UTC.
  database.searchParams.set('connection_limit', '1');
  process.env.DATABASE_URL = database.toString();
  const prisma = new PrismaService(
    new PersistenceSecretGuard(new EphemeralSecretFingerprintRegistry()),
  );
  await prisma.$connect();
  try {
    await prisma.$executeRawUnsafe("SET TIME ZONE 'Africa/Nairobi'");
    const [jobId, taskId] = process.argv.slice(2);
    const job = await prisma.backgroundJob.findUniqueOrThrow({ where: { id: jobId } });
    if (job.correlationId !== taskId || job.jobType !== 'MSAIDIZI_TASK_STEP')
      throw new Error('Fixture job mismatch');
    const grants = ['restart-proof.read', 'restart-proof.write'];
    const manifest = new ManifestProvider();
    manifest.setForTesting(
      [false, true].map(
        (mutation): Capability => ({
          id: `RestartProofController.${mutation ? 'write' : 'read'}`,
          controller: 'RestartProofController',
          handler: mutation ? 'write' : 'read',
          verb: mutation ? 'PATCH' : 'GET',
          path: 'restart-proof/:taskId',
          permissions: [mutation ? grants[1] : grants[0]],
          anyPermissions: [],
          roles: [],
          apiScopes: [],
          guard: 'permission',
          tier: mutation ? 'amber' : 'green',
          tierReason: 'disposable-fixture',
          params: { path: ['taskId'], query: [], freeFormQuery: false, hasBody: mutation },
          agentExcluded: false,
        }),
      ),
    );
    const autonomy = { enabled: true, globalKillSwitchActive: false, principalGrants: grants };
    const modelConfig = {
      allowedTiers: ['green', 'amber'],
      loopbackBaseUrl: receiver.origin,
      invokeTimeoutMs: 60_000,
    };
    const registry = new JobHandlerRegistry();
    new MsaidiziTaskStepHandler(
      prisma,
      registry,
      autonomy as never,
      modelConfig as never,
      manifest,
      new CapabilityInvoker(modelConfig as never),
      {
        issue: async () => {
          if (process.env.MSAIDIZI_RESTART_PAUSE_BEFORE_DISPATCH === '1') {
            await new Promise<void>((resolve) => {
              const receive = (message: unknown) => {
                if (message === 'continue-dispatch') {
                  process.off('message', receive);
                  resolve();
                }
              };
              process.on('message', receive);
              process.send?.({ type: 'reserved' });
            });
          }
          return { accessToken: 'disposable-restart-proof-only' };
        },
      } as never,
      { report: () => ({ releaseGate: { status: 'passed' } }) } as never,
      new AuditLogsService(prisma),
    ).onModuleInit();
    if (process.env.MSAIDIZI_RESTART_PAUSE_AFTER_LEASE === '1') {
      const execute = registry.get('MSAIDIZI_TASK_STEP')!;
      registry.register('MSAIDIZI_TASK_STEP', async (context) => {
        await new Promise<void>((resolve) => {
          const receive = (message: unknown) => {
            if (message !== 'continue-handler') return;
            process.off('message', receive);
            resolve();
          };
          process.on('message', receive);
          process.send?.({ type: 'leased' });
        });
        return execute(context);
      });
    }
    const config = new ConfigService({
      JOB_WORKER_ENABLED: 'false',
      AUTOMATION_DISPATCH_ENABLED: 'false',
      JOB_WORKER_STALE_AFTER_SECONDS: '2',
      JOB_WORKER_DEFAULT_TIMEOUT_SECONDS: '60',
      MSAIDIZI_TASK_WORKER_ENABLED: 'false',
    });
    const worker = new JobWorkerService(prisma, registry, config);
    process.send?.({ type: 'ready', pid: process.pid });
    const result = await worker.drainOnce(1, { jobId });
    const dispatcher = new MsaidiziTaskDispatcherService(
      prisma,
      autonomy as never,
      config,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      new AuditLogsService(prisma),
    );
    const transitions = dispatcher as unknown as {
      reconcileDeadStepJobs(id: string): Promise<boolean>;
      advance(task: unknown): Promise<number>;
    };
    await transitions.reconcileDeadStepJobs(taskId);
    const task = await prisma.msaidiziTask.findUniqueOrThrow({ where: { id: taskId } });
    if (['RUNNING', 'PAUSING', 'CANCELLING'].includes(task.status)) await transitions.advance(task);
    await send({ type: 'result', result });
  } finally {
    await prisma.$disconnect();
  }
}
main()
  .catch(async (error) => {
    process.exitCode = 1;
    await send({ type: 'error', message: String(error?.message ?? error) }).catch(() => undefined);
  })
  .finally(() => {
    if (process.connected) process.disconnect?.();
  });
