/** Real PostgreSQL + encrypted storage + owned process restarts. Source states are seeded. No device or external action executes. */
import { ChildProcess, fork } from 'node:child_process';
import { createCipheriv, createHash, randomBytes, randomUUID } from 'node:crypto';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../src/prisma/prisma.service';
import { PersistenceSecretGuard } from '../src/common/services/persistence-secret-guard.service';
import { EphemeralSecretFingerprintRegistry } from '../src/common/services/ephemeral-secret-fingerprint-registry.service';
import { captureDependencyLineage } from '../src/modules/msaidizi-tasks/msaidizi-dependency-lineage';
import { ResolvedStepInputs } from '../src/modules/msaidizi-tasks/msaidizi-input-bindings';

const proof = process.env.MSAIDIZI_CHAT_DISPOSABLE_DB === '1' ? describe : describe.skip;
proof('Cross-plan artifact preparation with PostgreSQL and process restart', () => {
  let prisma: PrismaService;
  let root: string;
  let key: Buffer;
  let principalId: string;
  const children = new Set<ChildProcess>();
  const content = Buffer.from('Synthetic reviewed artifact for local restart proof.');
  const hash = createHash('sha256').update(content).digest('hex');
  const connect = async () => {
    prisma = new PrismaService(
      new PersistenceSecretGuard(new EphemeralSecretFingerprintRegistry()),
    );
    await prisma.$connect();
  };
  beforeAll(async () => {
    const database = new URL(process.env.DATABASE_URL ?? '');
    if (
      database.hostname !== '127.0.0.1' ||
      !/^\/msaidizi_chat_proof_api(?:_[a-z0-9]+)?$/.test(database.pathname)
    )
      throw new Error('Requires the dedicated loopback API proof database');
    await connect();
    root = await fs.mkdtemp(path.join(os.tmpdir(), 'msaidizi-artifact-proof-'));
    key = randomBytes(32);
    principalId = (
      await prisma.msaidiziPrincipal.create({
        data: {
          key: `artifact-proof-${randomUUID()}`,
          displayName: 'Artifact-only disposable fixture',
          grants: {},
        },
      })
    ).id;
  });
  async function stop(child: ChildProcess) {
    if (child.exitCode === null && child.signalCode === null) {
      const ended = new Promise<void>((resolve) => child.once('exit', () => resolve()));
      child.kill('SIGKILL');
      await ended;
    }
    children.delete(child);
  }
  afterAll(async () => {
    await Promise.all([...children].map(stop));
    await prisma?.$disconnect();
    key?.fill(0);
    if (
      root &&
      path.dirname(path.resolve(root)) === path.resolve(os.tmpdir()) &&
      path.basename(root).startsWith('msaidizi-artifact-proof-')
    )
      await fs.rm(root, { recursive: true, force: true });
  });
  async function boot() {
    const child = fork(path.join(__dirname, 'fixtures/msaidizi-artifact-process.ts'), [], {
      cwd: path.resolve(__dirname, '..'),
      silent: true,
      execArgv: [
        '--max-old-space-size=8192',
        '-r',
        'ts-node/register/transpile-only',
        '-r',
        'tsconfig-paths/register',
      ],
      env: {
        PATH: process.env.PATH,
        SystemRoot: process.env.SystemRoot,
        TEMP: process.env.TEMP,
        NODE_ENV: 'test',
        DATABASE_URL: process.env.DATABASE_URL,
        MSAIDIZI_CHAT_DISPOSABLE_DB: '1',
        MSAIDIZI_ARTIFACT_PROOF_ROOT: root,
        MSAIDIZI_ARTIFACT_PROOF_KEY: key.toString('base64'),
      },
    });
    children.add(child);
    child.stdout?.resume();
    child.stderr?.resume();
    await new Promise<void>((resolve, reject) => {
      child.once('error', reject);
      child.once('exit', () => reject(new Error('Artifact fixture exited before readiness')));
      child.on('message', (message: { ready?: boolean }) => {
        if (message.ready) resolve();
      });
    });
    return child;
  }
  type Reply = { id: string; ok: boolean; result?: ResolvedStepInputs; code?: string };
  function resolve(
    child: ChildProcess,
    fixture: { taskId: string; stepId: string; attemptId: string },
  ) {
    const id = randomUUID();
    return new Promise<Reply>((done, reject) => {
      const failed = () => {
        cleanup();
        reject(new Error('Artifact fixture exited during preparation'));
      };
      const received = (message: Reply) => {
        if (message.id === id) {
          cleanup();
          done(message);
        }
      };
      const cleanup = () => {
        child.off('exit', failed);
        child.off('message', received);
      };
      child.once('exit', failed);
      child.on('message', received);
      child.send({
        id,
        taskId: fixture.taskId,
        stepId: fixture.stepId,
        attemptId: fixture.attemptId,
      });
    });
  }
  async function fixture(
    maxBytes = content.length * 2,
    options: { target?: 'HOST' | 'ERP'; stepBudget?: number } = {},
  ) {
    const deviceId = randomUUID();
    const task = await prisma.msaidiziTask.create({
      data: {
        principalId,
        mode: 'AUTOPILOT',
        hostExecutionAllowed: true,
        title: 'Artifact preparation proof',
        objective: 'Prepare synthetic artifact bytes without executing a host action',
        maxLocalBytes: BigInt(maxBytes),
      },
    });
    const planData = {
      taskId: task.id,
      summary: 'Synthetic reviewed plan',
      objective: task.objective,
      inputs: {},
      stopConditions: {},
      budgetSnapshot: {},
      planDigest: 'a'.repeat(64),
    };
    const oldPlan = await prisma.msaidiziPlanVersion.create({ data: { ...planData, version: 1 } });
    const newPlan = await prisma.msaidiziPlanVersion.create({ data: { ...planData, version: 2 } });
    const stepData = {
      taskId: task.id,
      sequence: 1,
      name: 'Synthetic fixture source',
      arguments: {},
      dependencies: [],
      dataClass: 'business_records',
      preconditions: {},
      budgets: {},
      stopConditions: {},
      idempotent: true,
      mutation: false,
    };
    const source = await prisma.msaidiziTaskStep.create({
      data: {
        ...stepData,
        planVersionId: oldPlan.id,
        stepKey: 'source',
        target: 'ERP',
        capability: 'ExpensesController.findAll',
        expectedEffect: 'READ',
        status: 'SUCCEEDED',
      },
    });
    const artifactId = randomUUID();
    const attempt = await prisma.msaidiziToolAttempt.create({
      data: {
        taskId: task.id,
        stepId: source.id,
        attemptNumber: 1,
        toolName: source.capability,
        argumentsRedacted: {},
        argsDigest: 'b'.repeat(64),
        idempotencyKey: randomUUID(),
        status: 'SUCCEEDED',
        resultSummary: { artifactId, sha256: hash },
      },
    });
    const storageKey = `${artifactId}.msa`;
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', key, iv);
    const encrypted = Buffer.concat([cipher.update(content), cipher.final()]);
    await fs.writeFile(
      path.join(root, storageKey),
      Buffer.concat([Buffer.from('MSA1'), iv, encrypted, cipher.getAuthTag()]),
      { flag: 'wx' },
    );
    iv.fill(0);
    encrypted.fill(0);
    await prisma.msaidiziArtifact.create({
      data: {
        id: artifactId,
        taskId: task.id,
        stepId: source.id,
        kind: 'FILE',
        name: 'synthetic-report.txt',
        mimeType: 'text/plain',
        storageKey,
        sha256: hash,
        byteSize: BigInt(content.length),
        encrypted: true,
        dataClass: 'business_records',
        trustLevel: 'UNTRUSTED',
        provenance: {
          attemptId: attempt.id,
          persistedSha256: hash,
          persistedBytes: content.length,
          redactionsApplied: false,
          trustLevel: 'UNTRUSTED',
        },
      },
    });
    const lineage = await captureDependencyLineage(prisma, task.id, 2, source.id);
    const properties = {
      schemaVersion: { type: 'integer', const: 1 },
      byteSize: { type: 'integer' },
      ...Object.fromEntries(
        [
          'taskId',
          'planVersionId',
          'targetStepId',
          'deviceId',
          'sourceStepId',
          'sourceAttemptId',
          'artifactId',
          'sha256',
          'mimeType',
          'name',
          'kind',
          'dataClass',
          'scopeSha256',
          'contentBase64',
        ].map((name) => [name, { type: 'string' }]),
      ),
    };
    const step = await prisma.msaidiziTaskStep.create({
      data: {
        ...stepData,
        planVersionId: newPlan.id,
        stepKey: 'deliver',
        name: 'Prepare, do not deliver',
        target: options.target ?? 'HOST',
        capability: 'email.send',
        expectedEffect: 'EXTERNAL',
        mutation: true,
        idempotent: false,
        status: 'RUNNING',
        arguments: { artifact: null },
        preconditions: { deviceId },
        budgets: { maxLocalBytes: options.stepBudget ?? maxBytes },
        dependencyLineage: [lineage] as unknown as Prisma.InputJsonValue,
        inputBindings: [
          {
            targetPath: '/artifact',
            source: {
              kind: 'DEPENDENCY_ARTIFACT',
              dependencyStepKey: 'source',
              artifactId,
              path: '',
            },
            dataClass: 'business_records',
            expectedType: 'object',
            expectedSchema: {
              type: 'object',
              properties,
              required: Object.keys(properties),
              additionalProperties: false,
            },
            transform: { name: 'IDENTITY', version: '1' },
          },
        ],
      },
    });
    const targetAttempt = await prisma.msaidiziToolAttempt.create({
      data: {
        taskId: task.id,
        stepId: step.id,
        attemptNumber: 1,
        toolName: step.capability,
        argumentsRedacted: {},
        argsDigest: 'c'.repeat(64),
        idempotencyKey: randomUUID(),
        status: 'RUNNING',
      },
    });
    await prisma.$executeRaw(Prisma.sql`UPDATE "msaidizi_tasks" SET "status" = 'RUNNING', "activePlanVersion" = 2,
      "startedAt" = GREATEST("createdAt", clock_timestamp() AT TIME ZONE 'UTC') WHERE "id" = ${task.id} AND "startedAt" IS NULL`);
    return {
      taskId: task.id,
      stepId: step.id,
      attemptId: targetAttempt.id,
      source,
      oldPlan,
      newPlan,
      sourceAttempt: attempt,
      artifactId,
      deviceId,
    };
  }

  it('prepares exact historical bytes after process restart and retains charged I/O', async () => {
    const f = await fixture();
    const original = await boot();
    await stop(original);
    const restarted = await boot();
    const result = await resolve(restarted, f);
    expect(result.ok).toBe(true);
    expect(result.result?.arguments.artifact).toMatchObject({
      taskId: f.taskId,
      planVersionId: f.newPlan.id,
      sourceStepId: f.source.id,
      sourceAttemptId: f.sourceAttempt.id,
      artifactId: f.artifactId,
      deviceId: f.deviceId,
      contentBase64: content.toString('base64'),
    });
    expect(result.result?.provenance).toMatchObject({
      bindings: [
        {
          instructionAuthority: false,
          trustLevel: 'UNTRUSTED',
          source: {
            sourcePlanVersionId: f.oldPlan.id,
            planVersionId: f.newPlan.id,
            attemptId: f.sourceAttempt.id,
          },
        },
      ],
    });
    await stop(restarted);
    await prisma.$disconnect();
    await connect();
    expect(await prisma.msaidiziTask.findUniqueOrThrow({ where: { id: f.taskId } })).toMatchObject({
      bytesRead: BigInt(content.length),
      bytesWritten: 0n,
    });
    expect(
      await prisma.msaidiziTaskStep.findUniqueOrThrow({ where: { id: f.stepId } }),
    ).toMatchObject({ bytesRead: BigInt(content.length), bytesWritten: 0n });
    expect(await prisma.msaidiziToolAttempt.count({ where: { taskId: f.taskId } })).toBe(2);
    expect(await prisma.msaidiziHostAction.count({ where: { taskId: f.taskId } })).toBe(0);
  }, 120_000);

  it('never exceeds one artifact read when two processes compete for the same budget', async () => {
    const f = await fixture(content.length);
    const workers = await Promise.all([boot(), boot()]);
    const results = await Promise.all(workers.map((worker) => resolve(worker, f)));
    expect(results.filter((result) => result.ok)).toHaveLength(1);
    await Promise.all(workers.map(stop));
    expect(await prisma.msaidiziTask.findUniqueOrThrow({ where: { id: f.taskId } })).toMatchObject({
      bytesRead: BigInt(content.length),
    });
    expect(
      await prisma.msaidiziTaskStep.findUniqueOrThrow({ where: { id: f.stepId } }),
    ).toMatchObject({ bytesRead: BigInt(content.length) });
  }, 120_000);

  it.each(['cancelled', 'wrong-attempt', 'erp-target', 'step-budget', 'wrong-task'] as const)(
    'refuses %s without reading stored bytes',
    async (scenario) => {
      const f = await fixture(undefined, {
        target: scenario === 'erp-target' ? 'ERP' : 'HOST',
        stepBudget: scenario === 'step-budget' ? 0 : undefined,
      });
      if (scenario === 'cancelled')
        await prisma.msaidiziTask.update({
          where: { id: f.taskId },
          data: { status: 'CANCELLING' },
        });
      const worker = await boot();
      const result = await resolve(worker, {
        ...f,
        taskId: scenario === 'wrong-task' ? (await fixture()).taskId : f.taskId,
        attemptId: scenario === 'wrong-attempt' ? f.sourceAttempt.id : f.attemptId,
      });
      expect(result.ok).toBe(false);
      await stop(worker);
      expect(
        await prisma.msaidiziTask.findUniqueOrThrow({ where: { id: f.taskId } }),
      ).toMatchObject({ bytesRead: 0n });
      expect(
        await prisma.msaidiziTaskStep.findUniqueOrThrow({ where: { id: f.stepId } }),
      ).toMatchObject({ bytesRead: 0n });
    },
    120_000,
  );
});
