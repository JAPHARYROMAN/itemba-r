/** Real child-process termination, leases, step execution and local HTTP IO.
 * Admission/token ports and receiver are synthetic; no production ERP guard,
 * cloud model, device, deployment or workstation acceptance is implied.
 */
import { fork, ChildProcess } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { createServer, Server, ServerResponse } from 'node:http';
import path from 'node:path';
import { ConfigService } from '@nestjs/config';
import { Prisma } from '@prisma/client';
import { PersistenceSecretGuard } from '../src/common/services/persistence-secret-guard.service';
import { EphemeralSecretFingerprintRegistry } from '../src/common/services/ephemeral-secret-fingerprint-registry.service';
import { PrismaService } from '../src/prisma/prisma.service';
import { MsaidiziTaskDispatcherService } from '../src/modules/msaidizi-task-runtime/msaidizi-task-dispatcher.service';
import { postgresInterruptionProxy } from './fixtures/postgres-interruption-proxy';
import { disposablePostgresRestart } from './fixtures/disposable-postgres-restart';

const describeDisposable =
  process.env.MSAIDIZI_CHAT_DISPOSABLE_DB === '1' ? describe : describe.skip;
describeDisposable('Msaidizi worker restart (owned child processes, disposable PostgreSQL)', () => {
  let prisma: PrismaService;
  let server: Server;
  let receiver: string;
  let principalId: string;
  const children = new Set<ChildProcess>();
  const proxies: Array<Awaited<ReturnType<typeof postgresInterruptionProxy>>> = [];
  let interruptedDatabase: Awaited<ReturnType<typeof disposablePostgresRestart>> | undefined;
  const requests = new Map<
    string,
    { hold: boolean; count: number; response?: ServerResponse; session?: string; failures?: number }
  >();

  beforeAll(async () => {
    const database = new URL(process.env.DATABASE_URL!);
    if (
      !['localhost', '127.0.0.1'].includes(database.hostname) ||
      !/^\/msaidizi_chat_proof(?:_[a-z0-9]+)?$/.test(database.pathname)
    ) {
      throw new Error('Requires a dedicated local msaidizi_chat_proof[_suffix] database');
    }
    prisma = new PrismaService(
      new PersistenceSecretGuard(new EphemeralSecretFingerprintRegistry()),
    );
    await prisma.$connect();
    principalId = (
      await prisma.msaidiziPrincipal.create({
        data: {
          key: `restart-proof-${randomUUID()}`,
          displayName: 'Disposable restart proof',
          grants: ['restart-proof.read', 'restart-proof.write'],
        },
      })
    ).id;
    server = createServer((req, res) => {
      void (async () => {
        const taskId = new URL(req.url!, 'http://localhost').pathname.replace(
          '/restart-proof/',
          '',
        );
        const receipt = requests.get(taskId);
        if (
          !receipt ||
          req.headers.authorization !== 'Bearer disposable-restart-proof-only' ||
          !['GET', 'PATCH'].includes(req.method!)
        ) {
          res.writeHead(403).end();
          return;
        }
        // This is a real isolated database effect, NOT an Itemba controller or
        // authorization bypass in production. Every duplicate creates another row.
        if (req.method === 'PATCH')
          await prisma.group.create({
            data: {
              code: `RP-${randomUUID()}`,
              name: `Restart proof ${taskId}`,
            },
          });
        receipt.count += 1;
        receipt.session = String(req.headers['x-msaidizi-session']);
        receipt.response = res;
        if (receipt.failures) {
          receipt.failures -= 1;
          res
            .writeHead(503, { 'content-type': 'application/json' })
            .end(JSON.stringify({ retry: true }));
          return;
        }
        if (!receipt.hold)
          res.setHeader('content-type', 'application/json').end(JSON.stringify({ ok: true }));
      })().catch(() => res.writeHead(500).end());
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    receiver = `http://127.0.0.1:${(server.address() as { port: number }).port}/`;
  });
  afterEach(async () => {
    await Promise.all(
      [...children].map(async (child) => {
        if (child.exitCode !== null || child.signalCode !== null) return;
        const exited = new Promise<void>((resolve) => child.once('exit', () => resolve()));
        child.kill('SIGKILL'); // Only this suite's exact owned child handle.
        await exited;
      }),
    );
    for (const receipt of requests.values()) receipt.response?.destroy();
    await Promise.all(proxies.splice(0).map((proxy) => proxy.close()));
    await interruptedDatabase?.restore();
    interruptedDatabase = undefined;
  });
  afterAll(async () => {
    server?.closeAllConnections();
    if (server) await new Promise<void>((resolve) => server.close(() => resolve()));
    await prisma?.$disconnect();
  });

  async function fixture(
    mutation: boolean,
    hold = false,
    withSuccessor = false,
    maxLocalBytes = 1_000_000,
    retryable = true,
  ) {
    const task = await prisma.msaidiziTask.create({
      data: {
        principalId,
        mode: 'COLLABORATIVE',
        title: 'Disposable worker restart',
        objective: 'Exercise owned worker process restart',
      },
    });
    const plan = await prisma.msaidiziPlanVersion.create({
      data: {
        taskId: task.id,
        version: 1,
        summary: 'Restart fixture',
        objective: task.objective,
        inputs: {},
        stopConditions: {},
        budgetSnapshot: {},
        planDigest: 'a'.repeat(64),
      },
    });
    const step = await prisma.msaidiziTaskStep.create({
      data: {
        taskId: task.id,
        planVersionId: plan.id,
        stepKey: 'first',
        sequence: 1,
        name: 'Controlled loopback',
        capability: `RestartProofController.${mutation ? 'write' : 'read'}`,
        arguments: { path: { taskId: task.id }, query: {}, ...(mutation ? { body: {} } : {}) },
        dependencies: [],
        expectedEffect: mutation ? 'WRITE' : 'READ',
        dataClass: 'business_records',
        preconditions: {},
        budgets: { maxLocalBytes },
        stopConditions: {},
        idempotent: !mutation && retryable,
        mutation,
        status: 'READY',
      },
    });
    const successor = withSuccessor
      ? await prisma.msaidiziTaskStep.create({
          data: {
            taskId: task.id,
            planVersionId: plan.id,
            stepKey: 'successor',
            sequence: 2,
            name: 'Undispatched successor',
            capability: 'RestartProofController.read',
            arguments: { path: { taskId: task.id }, query: {} },
            dependencies: ['first'],
            expectedEffect: 'READ',
            dataClass: 'business_records',
            preconditions: {},
            budgets: { maxLocalBytes: 1_000_000 },
            stopConditions: {},
            idempotent: true,
            mutation: false,
            status: 'PENDING',
          },
        })
      : null;
    await prisma.$executeRaw(Prisma.sql`UPDATE "msaidizi_tasks"
      SET "status" = 'RUNNING', "activePlanVersion" = 1,
          "startedAt" = GREATEST("createdAt", clock_timestamp() AT TIME ZONE 'UTC')
      WHERE "id" = ${task.id} AND "startedAt" IS NULL`);
    const dispatcher = new MsaidiziTaskDispatcherService(
      prisma,
      { enabled: false } as never,
      new ConfigService({}),
    );
    await (
      dispatcher as unknown as { enqueueStep(id: string, step: unknown): Promise<boolean> }
    ).enqueueStep(task.id, step);
    const job = await prisma.backgroundJob.findUniqueOrThrow({
      where: { idempotencyKey: `msaidizi-step:${step.id}` },
    });
    requests.set(task.id, { hold, count: 0 });
    return { task, step, job, successor };
  }

  function run(
    jobId: string,
    taskId: string,
    databaseUrl = process.env.DATABASE_URL,
    pauseBeforeDispatch = false,
    pauseAfterLease = false,
  ) {
    const child = fork(
      path.join(__dirname, 'fixtures/msaidizi-worker-process.ts'),
      [jobId, taskId],
      {
        cwd: path.resolve(__dirname, '..'),
        silent: true,
        execArgv: ['-r', 'ts-node/register/transpile-only', '-r', 'tsconfig-paths/register'],
        env: {
          PATH: process.env.PATH,
          SystemRoot: process.env.SystemRoot,
          TEMP: process.env.TEMP,
          DATABASE_URL: databaseUrl,
          NODE_ENV: 'test',
          MSAIDIZI_CHAT_DISPOSABLE_DB: '1',
          MSAIDIZI_RESTART_RECEIVER: receiver,
          ...(pauseBeforeDispatch ? { MSAIDIZI_RESTART_PAUSE_BEFORE_DISPATCH: '1' } : {}),
          ...(pauseAfterLease ? { MSAIDIZI_RESTART_PAUSE_AFTER_LEASE: '1' } : {}),
        },
      },
    );
    children.add(child);
    let error = '';
    let result: { leased: number; recoveredStale: number } | undefined;
    let reserved!: () => void;
    const reservation = new Promise<void>((resolve) => {
      reserved = resolve;
    });
    let reportLease!: () => void;
    const lease = new Promise<void>((resolve) => {
      reportLease = resolve;
    });
    child.stderr?.on('data', (data) => {
      error = (error + String(data)).slice(-5000);
    });
    child.stdout?.resume();
    child.on('message', (message: { type: string; message?: string; result?: typeof result }) => {
      if (message.type === 'error') error = message.message ?? 'Child error';
      if (message.type === 'result') result = message.result;
      if (message.type === 'reserved') reserved();
      if (message.type === 'leased') reportLease();
    });
    const exited = new Promise<number | null>((resolve, reject) => {
      child.once('error', reject);
      child.once('exit', (code) => {
        children.delete(child);
        resolve(code);
      });
    });
    // On Windows 'exit' can arrive before buffered IPC/stdio is drained.
    // Process-death drills use exited; successful evidence waits for close.
    const closed = new Promise<number | null>((resolve) => child.once('close', resolve));
    return {
      child,
      exited,
      reservation,
      lease,
      done: async () => {
        const code = await closed;
        if (code !== 0 || !result) throw new Error(`Restart child failed (${code}): ${error}`);
        return result;
      },
    };
  }
  async function received(taskId: string, child?: ChildProcess) {
    const deadline = Date.now() + 40_000;
    while (!requests.get(taskId)?.count) {
      if (child && (child.exitCode !== null || child.signalCode !== null))
        throw new Error('Worker exited before controlled HTTP dispatch');
      if (Date.now() > deadline) throw new Error('Worker did not reach controlled HTTP receiver');
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
  }

  it.each([false, true])(
    'executes and checkpoints a real worker positive control (mutation=%s)',
    async (mutation) => {
      const { task, step, job } = await fixture(mutation);
      expect((await run(job.id, task.id).done()).leased).toBe(1);
      expect(requests.get(task.id)?.count).toBe(1);
      expect(requests.get(task.id)?.session).toBe(`task_${task.id.replace(/-/g, '')}`);
      expect((await prisma.msaidiziTask.findUniqueOrThrow({ where: { id: task.id } })).status).toBe(
        'COMPLETED',
      );
      expect(
        await prisma.msaidiziToolAttempt.findFirstOrThrow({ where: { stepId: step.id } }),
      ).toMatchObject({ status: 'SUCCEEDED', attemptNumber: 1 });
      expect(
        await prisma.auditLog.count({
          where: { taskId: task.id, stepId: step.id, principalId, channel: 'AGENT' },
        }),
      ).toBeGreaterThanOrEqual(2);
      expect((await run(job.id, task.id).done()).leased).toBe(0);
      expect(requests.get(task.id)?.count).toBe(1);
    },
  );

  it('does not lease future work in a non-UTC database session', async () => {
    const { task, step, job } = await fixture(false);
    await prisma.backgroundJob.update({
      where: { id: job.id },
      data: { scheduledAt: new Date(Date.now() + 10 * 60_000) },
    });
    expect((await run(job.id, task.id).done()).leased).toBe(0);
    expect(requests.get(task.id)?.count).toBe(0);
    expect(await prisma.msaidiziToolAttempt.count({ where: { stepId: step.id } })).toBe(0);
    expect((await prisma.backgroundJob.findUniqueOrThrow({ where: { id: job.id } })).status).toBe(
      'QUEUED',
    );
  });

  it('does not replay a write after worker death beyond the HTTP dispatch boundary', async () => {
    const { task, step, job, successor } = await fixture(true, true, true);
    const first = run(job.id, task.id);
    await received(task.id);
    expect(
      (await prisma.msaidiziToolAttempt.findFirstOrThrow({ where: { stepId: step.id } })).status,
    ).toBe('RUNNING');
    // A second process must not steal a live heartbeat or duplicate the effect.
    expect((await run(job.id, task.id).done()).leased).toBe(0);
    expect(requests.get(task.id)?.count).toBe(1);
    expect((await prisma.backgroundJob.findUniqueOrThrow({ where: { id: job.id } })).status).toBe(
      'RUNNING',
    );
    expect((await prisma.msaidiziTask.findUniqueOrThrow({ where: { id: task.id } })).status).toBe(
      'RUNNING',
    );
    first.child.kill('SIGKILL');
    await first.exited;
    requests.get(task.id)?.response?.destroy();
    // Wait on the actual persisted heartbeat deadline; do not rewrite lease age.
    const heartbeat = (await prisma.backgroundJob.findUniqueOrThrow({ where: { id: job.id } }))
      .leaseHeartbeatAt!;
    const delay = Math.max(0, heartbeat.getTime() + 2100 - Date.now());
    if (delay) await new Promise((resolve) => setTimeout(resolve, delay));
    const recovery = await run(job.id, task.id).done();
    expect(recovery.recoveredStale).toBeGreaterThanOrEqual(1);
    expect(recovery.leased).toBe(0);
    expect((await prisma.msaidiziTask.findUniqueOrThrow({ where: { id: task.id } })).status).toBe(
      'NEEDS_ATTENTION',
    );
    expect(
      await prisma.msaidiziToolAttempt.findFirstOrThrow({ where: { stepId: step.id } }),
    ).toMatchObject({ status: 'UNKNOWN', uncertainOutcome: true });
    expect(await prisma.msaidiziToolAttempt.count({ where: { stepId: step.id } })).toBe(1);
    expect(await prisma.group.count({ where: { name: `Restart proof ${task.id}` } })).toBe(1);
    expect((await run(job.id, task.id).done()).leased).toBe(0);
    expect(requests.get(task.id)?.count).toBe(1);
    expect(
      await prisma.backgroundJob.count({
        where: { idempotencyKey: `msaidizi-step:${successor!.id}` },
      }),
    ).toBe(0);
  });

  it.each(['before-headers', 'partial-body'])(
    'does not replay a committed write after connection loss (%s)',
    async (boundary) => {
      const { task, step, job, successor } = await fixture(true, true, true);
      const executing = run(job.id, task.id);
      await received(task.id);
      const response = requests.get(task.id)!.response!;
      const prefix = Buffer.from('{"payload":"' + 'x'.repeat(32_768));
      if (boundary === 'partial-body') {
        response.writeHead(200, {
          'content-type': 'application/json',
          'content-length': prefix.length + 100,
        });
        await new Promise<void>((resolve, reject) =>
          response.write(prefix, (error) => (error ? reject(error) : resolve())),
        );
        await new Promise((resolve) => setTimeout(resolve, 200));
      }
      response.destroy();
      await executing.done();
      expect(await prisma.msaidiziTask.findUniqueOrThrow({ where: { id: task.id } })).toMatchObject(
        {
          status: 'NEEDS_ATTENTION',
          attemptedToolCalls: 1,
          executedToolCalls: 1,
          mutations: 1,
        },
      );
      const attempt = await prisma.msaidiziToolAttempt.findFirstOrThrow({
        where: { stepId: step.id },
      });
      expect(attempt).toMatchObject({ status: 'UNKNOWN', uncertainOutcome: true });
      if (boundary === 'partial-body') {
        expect(
          (await prisma.msaidiziTask.findUniqueOrThrow({ where: { id: task.id } })).bytesRead,
        ).toBe(BigInt(prefix.length));
        expect(attempt.resultSummary).toMatchObject({
          responseIncomplete: true,
          responseBytes: prefix.length,
          responseSha256: createHash('sha256').update(prefix).digest('hex'),
        });
        expect(JSON.stringify(attempt.resultSummary)).not.toContain('x'.repeat(100));
      }
      expect((await run(job.id, task.id).done()).leased).toBe(0);
      expect(await prisma.group.count({ where: { name: `Restart proof ${task.id}` } })).toBe(1);
      expect(await prisma.msaidiziToolAttempt.count({ where: { stepId: step.id } })).toBe(1);
      expect(
        await prisma.backgroundJob.count({
          where: { idempotencyKey: `msaidizi-step:${successor!.id}` },
        }),
      ).toBe(0);
    },
  );

  it('charges an interrupted read across retry without retaining its partial content', async () => {
    const { task, step, job } = await fixture(false, true);
    const executing = run(job.id, task.id);
    await received(task.id);
    const prefix = Buffer.from('{"discarded":"' + 'y'.repeat(16_384));
    const response = requests.get(task.id)!.response!;
    response.writeHead(200, {
      'content-type': 'application/json',
      'content-length': prefix.length + 100,
    });
    await new Promise<void>((resolve, reject) =>
      response.write(prefix, (error) => (error ? reject(error) : resolve())),
    );
    await new Promise((resolve) => setTimeout(resolve, 200));
    response.destroy();
    await executing.done();
    expect((await prisma.backgroundJob.findUniqueOrThrow({ where: { id: job.id } })).status).toBe(
      'RETRYING',
    );
    const failed = await prisma.msaidiziToolAttempt.findFirstOrThrow({
      where: { stepId: step.id },
    });
    expect(failed.status).toBe('FAILED');
    expect(failed.resultSummary).toMatchObject({
      responseIncomplete: true,
      responseBytes: prefix.length,
    });
    requests.get(task.id)!.hold = false;
    const due = (await prisma.backgroundJob.findUniqueOrThrow({ where: { id: job.id } }))
      .scheduledAt!;
    const delay = Math.max(0, due.getTime() - Date.now() + 20);
    if (delay) await new Promise((resolve) => setTimeout(resolve, delay));
    await run(job.id, task.id).done();
    expect(await prisma.msaidiziTask.findUniqueOrThrow({ where: { id: task.id } })).toMatchObject({
      status: 'COMPLETED',
      bytesRead: BigInt(prefix.length + Buffer.byteLength(JSON.stringify({ ok: true }))),
      attemptedToolCalls: 2,
      executedToolCalls: 2,
      mutations: 0,
    });
    const attempts = await prisma.msaidiziToolAttempt.findMany({
      where: { stepId: step.id },
      orderBy: { attemptNumber: 'asc' },
    });
    expect(attempts.map((attempt) => attempt.status)).toEqual(['FAILED', 'SUCCEEDED']);
    expect(JSON.stringify(attempts)).not.toContain('y'.repeat(100));
    const audits = await prisma.auditLog.findMany({ where: { taskId: task.id } });
    expect(JSON.stringify(audits)).not.toContain('y'.repeat(100));
    expect(requests.get(task.id)?.count).toBe(2);
  });

  it.each(['before-dispatch', 'after-commit'])(
    'recovers after loss of the worker database connection (%s)',
    async (boundary) => {
      const { task, step, job, successor } = await fixture(true, true, true);
      const proxy = await postgresInterruptionProxy(new URL(process.env.DATABASE_URL!));
      proxies.push(proxy);
      const executing = run(job.id, task.id, proxy.url, boundary === 'before-dispatch');
      // Attach rejection immediately: expected connection failure must not
      // become an unhandled promise rejection while the parent is inspecting DB.
      const outcome = executing.done().then(
        () => 'completed',
        () => 'database-unavailable',
      );
      await Promise.race([
        boundary === 'before-dispatch' ? executing.reservation : received(task.id),
        outcome.then(() => {
          throw new Error('Worker exited before the requested fault boundary');
        }),
      ]);
      expect(proxy.connections()).toBeGreaterThan(0);
      expect(proxy.cut()).toBeGreaterThan(0);
      if (boundary === 'before-dispatch') executing.child.send('continue-dispatch');
      else
        requests
          .get(task.id)!
          .response!.setHeader('content-type', 'application/json')
          .end(JSON.stringify({ ok: true }));
      expect(await outcome).toBe('database-unavailable');
      expect((await prisma.backgroundJob.findUniqueOrThrow({ where: { id: job.id } })).status).toBe(
        'RUNNING',
      );
      expect(await prisma.group.count({ where: { name: `Restart proof ${task.id}` } })).toBe(
        boundary === 'after-commit' ? 1 : 0,
      );
      proxy.restore();
      const heartbeat = (await prisma.backgroundJob.findUniqueOrThrow({ where: { id: job.id } }))
        .leaseHeartbeatAt!;
      const delay = Math.max(0, heartbeat.getTime() + 2100 - Date.now());
      if (delay) await new Promise((resolve) => setTimeout(resolve, delay));
      expect((await run(job.id, task.id, proxy.url).done()).leased).toBe(0);
      expect(await prisma.msaidiziTask.findUniqueOrThrow({ where: { id: task.id } })).toMatchObject(
        {
          status: 'NEEDS_ATTENTION',
          mutations: 1,
          attemptedToolCalls: 1,
        },
      );
      expect(
        await prisma.msaidiziToolAttempt.findFirstOrThrow({ where: { stepId: step.id } }),
      ).toMatchObject({ status: 'UNKNOWN', uncertainOutcome: true });
      expect(await prisma.msaidiziToolAttempt.count({ where: { stepId: step.id } })).toBe(1);
      expect(
        await prisma.backgroundJob.count({
          where: { idempotencyKey: `msaidizi-step:${successor!.id}` },
        }),
      ).toBe(0);
      expect((await run(job.id, task.id, proxy.url).done()).leased).toBe(0);
      expect(requests.get(task.id)?.count).toBe(boundary === 'after-commit' ? 1 : 0);
    },
  );

  it.each([
    {
      label: 'after dispatch with retry budget',
      beforeDispatch: false,
      budget: 40_000_000,
      canRetry: true,
      cancel: false,
    },
    {
      label: 'after dispatch with exhausted IO budget',
      beforeDispatch: false,
      budget: 1_000_000,
      canRetry: false,
      cancel: false,
    },
    {
      label: 'before dispatch',
      beforeDispatch: true,
      budget: 1_000_000,
      canRetry: true,
      cancel: false,
    },
    {
      label: 'cancelled after dispatch',
      beforeDispatch: false,
      budget: 40_000_000,
      canRetry: false,
      cancel: true,
    },
    {
      label: 'cancelled before dispatch',
      beforeDispatch: true,
      budget: 1_000_000,
      canRetry: false,
      cancel: true,
    },
    {
      label: 'cancelled after retry claim',
      beforeDispatch: false,
      budget: 40_000_000,
      canRetry: false,
      cancel: true,
      claimed: true,
    },
    {
      label: 'read lease exhausted',
      beforeDispatch: false,
      budget: 40_000_000,
      canRetry: false,
      cancel: false,
      exhausted: true,
    },
  ])(
    'reconciles an abandoned read attempt ($label)',
    async ({ beforeDispatch, budget, canRetry, cancel, claimed, exhausted }) => {
      // A lost read conservatively keeps its response reservation charged. Leave
      // enough immutable step budget for another read without refunding that IO.
      const { task, step, job, successor } = await fixture(false, true, cancel, budget, !exhausted);
      const proxy = await postgresInterruptionProxy(new URL(process.env.DATABASE_URL!));
      proxies.push(proxy);
      const executing = run(job.id, task.id, proxy.url, beforeDispatch);
      const outcome = executing.done().then(
        () => 'completed',
        () => 'database-unavailable',
      );
      await Promise.race([
        beforeDispatch ? executing.reservation : received(task.id, executing.child),
        outcome.then(() => {
          throw new Error('Worker exited before read dispatch');
        }),
      ]);
      expect(proxy.cut()).toBeGreaterThan(0);
      if (beforeDispatch) executing.child.send('continue-dispatch');
      else
        requests
          .get(task.id)!
          .response!.setHeader('content-type', 'application/json')
          .end(JSON.stringify({ ok: true }));
      expect(await outcome).toBe('database-unavailable');
      const reservedBytes = (
        await prisma.msaidiziTask.findUniqueOrThrow({ where: { id: task.id } })
      ).bytesRead;
      if (beforeDispatch) expect(reservedBytes).toBe(0n);
      else expect(reservedBytes).toBeGreaterThan(0n);
      proxy.restore();
      requests.get(task.id)!.hold = false;
      if (cancel && !claimed)
        await prisma.msaidiziTask.update({
          where: { id: task.id },
          data: { status: 'CANCELLING' },
        });
      const heartbeat = (await prisma.backgroundJob.findUniqueOrThrow({ where: { id: job.id } }))
        .leaseHeartbeatAt!;
      const delay = Math.max(0, heartbeat.getTime() + 2100 - Date.now());
      if (delay) await new Promise((resolve) => setTimeout(resolve, delay));
      await run(job.id, task.id, proxy.url).done();
      const retry = await prisma.backgroundJob.findUniqueOrThrow({ where: { id: job.id } });
      expect(retry.status).toBe(
        exhausted ? 'DEAD_LETTER' : cancel && !claimed ? 'CANCELLED' : 'RETRYING',
      );
      const backoff = Math.max(0, (retry.scheduledAt?.getTime() ?? 0) - Date.now() + 20);
      if (backoff) await new Promise((resolve) => setTimeout(resolve, backoff));
      const resumed = run(job.id, task.id, proxy.url, false, claimed);
      if (claimed) {
        await resumed.lease;
        await prisma.msaidiziTask.update({
          where: { id: task.id },
          data: { status: 'CANCELLING' },
        });
        resumed.child.send('continue-handler');
      }
      await resumed.done();
      expect(await prisma.msaidiziTask.findUniqueOrThrow({ where: { id: task.id } })).toMatchObject(
        {
          status: exhausted
            ? 'FAILED'
            : cancel
              ? 'CANCELLED'
              : canRetry
                ? 'COMPLETED'
                : 'NEEDS_ATTENTION',
          attemptedToolCalls: canRetry ? 2 : 1,
          executedToolCalls: (beforeDispatch ? 0 : 1) + (canRetry ? 1 : 0),
          mutations: 0,
          bytesRead:
            reservedBytes +
            (canRetry ? BigInt(Buffer.byteLength(JSON.stringify({ ok: true }))) : 0n),
        },
      );
      const attempts = await prisma.msaidiziToolAttempt.findMany({
        where: { stepId: step.id },
        orderBy: { attemptNumber: 'asc' },
      });
      expect(attempts.map((attempt) => attempt.status)).toEqual(
        canRetry ? ['FAILED', 'SUCCEEDED'] : ['FAILED'],
      );
      expect(attempts[0].endedAt).not.toBeNull();
      expect(attempts[0].errorCode).toBe(
        exhausted
          ? 'READ_JOB_TERMINATED'
          : cancel
            ? 'READ_CANCELLED_AFTER_LEASE_LOSS'
            : 'READ_WORKER_LEASE_LOST',
      );
      expect(
        await prisma.auditLog.count({
          where: {
            taskId: task.id,
            entityId: attempts[0].id,
            action: 'MSAIDIZI_ERP_ACTION_FAILED',
          },
        }),
      ).toBe(1);
      expect(requests.get(task.id)?.count).toBe((beforeDispatch ? 0 : 1) + (canRetry ? 1 : 0));
      if (successor)
        expect(
          await prisma.backgroundJob.count({
            where: { idempotencyKey: `msaidizi-step:${successor.id}` },
          }),
        ).toBe(0);
    },
  );

  const itServerRestart = process.env.MSAIDIZI_RESTART_PGDATA ? it : it.skip;
  itServerRestart.each(['before-dispatch', 'after-commit'])(
    'recovers committed state across an actual PostgreSQL crash/restart (%s)',
    async (boundary) => {
      interruptedDatabase = await disposablePostgresRestart(
        prisma,
        new URL(process.env.DATABASE_URL!),
      );
      const { task, step, job, successor } = await fixture(true, true, true);
      const executing = run(
        job.id,
        task.id,
        process.env.DATABASE_URL,
        boundary === 'before-dispatch',
      );
      const outcome = executing.done().then(
        () => 'completed',
        () => 'database-unavailable',
      );
      await Promise.race([
        boundary === 'before-dispatch' ? executing.reservation : received(task.id, executing.child),
        outcome.then(() => {
          throw new Error('Worker exited before the controlled restart boundary');
        }),
      ]);
      await interruptedDatabase.stop();
      if (boundary === 'before-dispatch') executing.child.send('continue-dispatch');
      else
        requests
          .get(task.id)!
          .response!.setHeader('content-type', 'application/json')
          .end(JSON.stringify({ ok: true }));
      expect(await outcome).toBe('database-unavailable');
      await interruptedDatabase.restore();
      expect((await interruptedDatabase.inspect()).started).not.toBe(
        interruptedDatabase.originalStart,
      );
      const persisted = await prisma.backgroundJob.findUniqueOrThrow({ where: { id: job.id } });
      expect(persisted.status).toBe('RUNNING');
      const delay = Math.max(0, persisted.leaseHeartbeatAt!.getTime() + 2100 - Date.now());
      if (delay) await new Promise((resolve) => setTimeout(resolve, delay));
      expect((await run(job.id, task.id).done()).leased).toBe(0);
      expect(await prisma.msaidiziTask.findUniqueOrThrow({ where: { id: task.id } })).toMatchObject(
        {
          status: 'NEEDS_ATTENTION',
          attemptedToolCalls: 1,
          mutations: 1,
        },
      );
      const attempt = await prisma.msaidiziToolAttempt.findFirstOrThrow({
        where: { stepId: step.id },
      });
      expect(attempt).toMatchObject({ status: 'UNKNOWN', uncertainOutcome: true });
      expect(await prisma.group.count({ where: { name: `Restart proof ${task.id}` } })).toBe(
        boundary === 'after-commit' ? 1 : 0,
      );
      expect(
        await prisma.auditLog.count({
          where: {
            taskId: task.id,
            stepId: step.id,
            entityId: attempt.id,
            action: 'MSAIDIZI_ERP_ACTION_UNKNOWN',
          },
        }),
      ).toBe(1);
      expect(
        await prisma.backgroundJob.count({
          where: { idempotencyKey: `msaidizi-step:${successor!.id}` },
        }),
      ).toBe(0);
      expect((await run(job.id, task.id).done()).leased).toBe(0);
      expect(requests.get(task.id)?.count).toBe(boundary === 'after-commit' ? 1 : 0);
      expect(await prisma.msaidiziToolAttempt.count({ where: { stepId: step.id } })).toBe(1);
    },
    90_000,
  );

  it('honors cancellation during a live write without dispatching its successor', async () => {
    const { task, job, successor } = await fixture(true, true, true);
    const executing = run(job.id, task.id);
    await received(task.id);
    await prisma.msaidiziTask.update({ where: { id: task.id }, data: { status: 'CANCELLING' } });
    requests
      .get(task.id)!
      .response!.setHeader('content-type', 'application/json')
      .end(JSON.stringify({ ok: true }));
    await executing.done();
    expect((await prisma.msaidiziTask.findUniqueOrThrow({ where: { id: task.id } })).status).toBe(
      'CANCELLED',
    );
    expect(
      await prisma.backgroundJob.count({
        where: { idempotencyKey: `msaidizi-step:${successor!.id}` },
      }),
    ).toBe(0);
    expect(await prisma.group.count({ where: { name: `Restart proof ${task.id}` } })).toBe(1);
    expect(requests.get(task.id)?.count).toBe(1);
  });

  it('resumes a real failed read in a new worker while preserving its spent attempt', async () => {
    const { task, step, job } = await fixture(false);
    requests.get(task.id)!.failures = 1;
    await run(job.id, task.id).done();
    expect((await prisma.backgroundJob.findUniqueOrThrow({ where: { id: job.id } })).status).toBe(
      'RETRYING',
    );
    const dispatcher = new MsaidiziTaskDispatcherService(
      prisma,
      { enabled: false } as never,
      new ConfigService({}),
    );
    const transitions = dispatcher as unknown as {
      pauseRemaining(id: string): Promise<void>;
      enqueueStep(id: string, step: unknown): Promise<boolean>;
    };
    await prisma.msaidiziTask.update({ where: { id: task.id }, data: { status: 'PAUSING' } });
    await transitions.pauseRemaining(task.id);
    expect((await prisma.msaidiziTask.findUniqueOrThrow({ where: { id: task.id } })).status).toBe(
      'PAUSED',
    );
    await prisma.msaidiziTask.update({ where: { id: task.id }, data: { status: 'RUNNING' } });
    expect(await transitions.enqueueStep(task.id, step)).toBe(true);
    await run(job.id, task.id).done();
    expect(await prisma.msaidiziTask.findUniqueOrThrow({ where: { id: task.id } })).toMatchObject({
      status: 'COMPLETED',
      attemptedToolCalls: 2,
      executedToolCalls: 2,
      mutations: 0,
    });
    expect(
      (
        await prisma.msaidiziToolAttempt.findMany({
          where: { stepId: step.id },
          orderBy: { attemptNumber: 'asc' },
        })
      ).map((row) => row.status),
    ).toEqual(['FAILED', 'SUCCEEDED']);
    expect(await prisma.backgroundJob.findUniqueOrThrow({ where: { id: job.id } })).toMatchObject({
      attempts: 1,
      maxAttempts: 3,
    });
    expect(requests.get(task.id)?.count).toBe(2);
  });
});
