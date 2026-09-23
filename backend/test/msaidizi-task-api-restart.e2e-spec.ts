/** Real AppModule process restarts + JWT/permissions/ERP. Release admission is synthetic. */
import { ChildProcess, fork } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import * as argon2 from 'argon2';
import request from 'supertest';
import { AccessLevel, RoleScope } from '@prisma/client';
import { ALL_PERMISSIONS } from '../../database/seeds/permission-matrix';
import { PrismaService } from '../src/prisma/prisma.service';
import { PersistenceSecretGuard } from '../src/common/services/persistence-secret-guard.service';
import { EphemeralSecretFingerprintRegistry } from '../src/common/services/ephemeral-secret-fingerprint-registry.service';
import { actionArgumentDigest } from '../src/common/utils/canonical-digest';

const describeProof = process.env.MSAIDIZI_CHAT_DISPOSABLE_DB === '1' ? describe : describe.skip;
describeProof('Authenticated Msaidizi task API across backend process restarts', () => {
  let prisma: PrismaService;
  let child: ChildProcess | undefined;
  let url: string;
  let companyId: string;
  let otherCompanyId: string;
  let viewPermissionId: string;
  let expenseCategoryId: string;
  type Actor = { id: string; roleId: string; email: string; token: string };
  const password = 'DisposableApiProof123!';
  let operator: Actor;
  let observer: Actor;
  let denied: Actor;
  let revokee: Actor;
  const suffix = randomUUID().slice(0, 8);
  const principalKey = `api-restart-proof-${suffix}`;
  const pending = new Map<
    string,
    {
      resolve: () => void;
      reject: (error: Error) => void;
      afterResponse?: () => void;
      afterModelReservation?: () => void;
      afterDecision?: () => void;
    }
  >();

  async function stop() {
    if (!child || child.exitCode !== null || child.signalCode !== null) return;
    const owned = child;
    const exited = new Promise<void>((resolve) => owned.once('exit', () => resolve()));
    owned.kill('SIGKILL'); // Exact owned AppModule child only; no system service.
    await exited;
    child = undefined;
  }
  async function boot(
    writes = false,
    routines = false,
    reasoning?: 'continue' | 'unplanned' | 'replan' | 'binding-fill',
  ) {
    await stop();
    const owned = fork(path.join(__dirname, 'fixtures/msaidizi-api-process.ts'), [], {
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
        // Each case has a fresh real session and a <= 180-second test ceiling.
        // Keep finite expiry shorter than a full run, independent of .env.
        JWT_ACCESS_EXPIRES_IN: '5m',
        MSAIDIZI_CHAT_DISPOSABLE_DB: '1',
        MSAIDIZI_API_PROOF_PRINCIPAL: principalKey,
        MSAIDIZI_API_PROOF_WRITES: writes ? '1' : '0',
        MSAIDIZI_API_PROOF_ROUTINES: routines ? '1' : '0',
        ...(reasoning ? { MSAIDIZI_API_PROOF_REASONING: reasoning } : {}),
        JOB_WORKER_ENABLED: 'false',
        AUTOMATION_DISPATCH_ENABLED: 'false',
        ANTHROPIC_API_KEY: '',
      },
    });
    child = owned;
    let error = '';
    owned.stderr?.on('data', (data) => {
      error = (error + String(data)).slice(-4000);
    });
    owned.stdout?.resume();
    await new Promise<void>((resolve, reject) => {
      owned.once('error', reject);
      owned.once('exit', () => {
        const failure = new Error(`API proof child exited: ${error}`);
        reject(failure);
        for (const waiter of pending.values()) waiter.reject(failure);
        pending.clear();
      });
      owned.on(
        'message',
        (message: { type: string; url?: string; id?: string; message?: string }) => {
          if (message.type === 'ready') {
            url = message.url!;
            resolve();
          }
          if (message.type === 'error') {
            error = message.message ?? 'Child error';
            if (!message.id) reject(new Error(error));
            else {
              pending.get(message.id)?.reject(new Error(error));
              pending.delete(message.id);
            }
          }
          if (message.type === 'tick' && message.id) {
            pending.get(message.id)?.resolve();
            pending.delete(message.id);
          }
          if (message.type === 'after-response' && message.id) {
            pending.get(message.id)?.afterResponse?.();
          }
          if (message.type === 'after-model-reservation' && message.id) {
            pending.get(message.id)?.afterModelReservation?.();
          }
          if (message.type === 'after-decision' && message.id)
            pending.get(message.id)?.afterDecision?.();
        },
      );
    });
  }
  const tick = (
    taskId: string,
    afterResponse?: () => void,
    afterModelReservation?: () => void,
    dispatchOnly = false,
    lateModelResult = false,
    afterDecision?: () => void,
  ) =>
    new Promise<void>((resolve, reject) => {
      const id = randomUUID();
      pending.set(id, { resolve, reject, afterResponse, afterModelReservation, afterDecision });
      child!.send({
        command: dispatchOnly ? 'dispatch-only' : 'tick',
        id,
        taskId,
        holdAfterResponse: Boolean(afterResponse),
        holdAfterModelReservation: Boolean(afterModelReservation),
        lateModelResult,
        holdAfterDecision: Boolean(afterDecision),
      });
    });
  const api = (actor: Actor) => ({
    get: (route: string) => request(url).get(route).auth(actor.token, { type: 'bearer' }),
    post: (route: string, body: unknown = {}) =>
      request(url)
        .post(route)
        .auth(actor.token, { type: 'bearer' })
        .send(body as object),
  });
  const planBody = (selectedCompany = companyId) => ({
    title: `API read proof ${suffix}`,
    objective: 'Read company expenses through the governed ERP path',
    mode: 'ASK',
    companyId: selectedCompany,
    idempotencyKey: randomUUID(),
    steps: [
      {
        key: 'expenses',
        name: 'Read expenses',
        target: 'ERP',
        capability: 'ExpensesController.findAll',
        arguments: { path: {}, query: { companyId: selectedCompany } },
        expectedEffect: 'READ',
        dataClass: 'business_records',
        idempotent: true,
        mutation: false,
      },
    ],
  });
  const plan = async (actor = operator) =>
    (await api(actor).post('/msaidizi/tasks/plan', planBody()).expect(201)).body.data;

  beforeAll(async () => {
    const database = new URL(process.env.DATABASE_URL!);
    if (
      database.hostname !== '127.0.0.1' ||
      !/^\/msaidizi_chat_proof_api(?:_[a-z0-9]+)?$/.test(database.pathname)
    )
      throw new Error('Requires a separate local msaidizi_chat_proof_api[_suffix] database');
    prisma = new PrismaService(
      new PersistenceSecretGuard(new EphemeralSecretFingerprintRegistry()),
    );
    await prisma.$connect();
    await boot();
    const permissions = await Promise.all(
      ALL_PERMISSIONS.filter((entry) =>
        ['msaidizi.use', 'msaidizi.oversight', 'expenses.view', 'expenses.create'].includes(
          entry.code,
        ),
      ).map((entry) =>
        prisma.permission.upsert({ where: { code: entry.code }, update: {}, create: entry }),
      ),
    );
    viewPermissionId = permissions.find((entry) => entry.code === 'expenses.view')!.id;
    const group = await prisma.group.create({
      data: { code: `APG${suffix}`, name: `API proof ${suffix}` },
    });
    companyId = (
      await prisma.company.create({
        data: { groupId: group.id, code: `APA${suffix}`, name: 'API proof A' },
      })
    ).id;
    otherCompanyId = (
      await prisma.company.create({
        data: { groupId: group.id, code: `APB${suffix}`, name: 'API proof B' },
      })
    ).id;
    const passwordHash = await argon2.hash(password);
    async function actor(name: string, withView = true): Promise<Actor> {
      const role = await prisma.role.create({
        data: {
          name: `${name}-${suffix}`,
          displayName: name,
          scope: RoleScope.COMPANY,
          rolePermissions: {
            create: permissions
              .filter((entry) => withView || entry.code === 'msaidizi.use')
              .filter((entry) => entry.code !== 'msaidizi.oversight' || name === 'api-operator')
              .map((entry) => ({ permissionId: entry.id })),
          },
        },
      });
      const user = await prisma.user.create({
        data: {
          email: `${name}-${suffix}@itemba.invalid`,
          fullName: name,
          passwordHash,
          companyId,
          userRoles: { create: { roleId: role.id } },
          companyAccess: { create: { companyId, accessLevel: AccessLevel.MANAGE } },
        },
      });
      return { id: user.id, roleId: role.id, email: user.email, token: '' };
    }
    operator = await actor('api-operator');
    observer = await actor('api-observer');
    denied = await actor('api-no-view', false);
    revokee = await actor('api-revokee');
    for (const [selected, marker] of [
      [companyId, 'visible'],
      [otherCompanyId, 'hidden'],
    ]) {
      const category = await prisma.expenseCategory.create({
        data: { companyId: selected, name: `API proof ${suffix}` },
      });
      if (selected === companyId) expenseCategoryId = category.id;
      await prisma.expense.create({
        data: {
          companyId: selected,
          expenseCategoryId: category.id,
          expenseNumber: `API-${suffix}`,
          amount: 10,
          expenseDate: new Date(),
          description: `${marker}-expense-${suffix}`,
          createdById: operator.id,
        },
      });
    }
  }, 120_000);
  beforeEach(async () => {
    // A complete run outlives an access token. Authenticate once per test, not
    // once per suite; do not silently retry a rejected action or refresh within
    // a restart scenario. Permission revocations and owner checks remain real.
    for (const actor of [operator, observer, denied, revokee]) {
      const login = await request(url)
        .post('/auth/login')
        .send({ email: actor.email, password })
        .expect(200);
      actor.token = login.body.data.accessToken;
      const claims = JSON.parse(Buffer.from(actor.token.split('.')[1], 'base64url').toString());
      expect(claims.sub).toBe(actor.id);
      expect(claims.exp - claims.iat).toBe(300);
      expect(claims.exp).toBeGreaterThan(Math.floor(Date.now() / 1000));
    }
  });
  afterAll(async () => {
    await stop();
    await prisma?.$disconnect();
  });

  it('resumes an HTTP-planned task after restart and preserves results/cursors through a second restart', async () => {
    const task = await plan();
    expect(task.status).toBe('READY');
    await api(operator).post('/msaidizi/tasks', { taskId: task.id }).expect(201);
    await api(operator).post(`/msaidizi/tasks/${task.id}/pause`).expect(200);
    const before = (await api(operator).get(`/msaidizi/tasks/${task.id}/events`).expect(200)).body
      .data;
    await boot();
    const paused = (await api(operator).get(`/msaidizi/tasks/${task.id}`).expect(200)).body.data;
    expect(paused.status).toBe('PAUSED');
    expect(paused.planVersions).toEqual(task.planVersions);
    await api(operator).post(`/msaidizi/tasks/${task.id}/resume`).expect(200);
    await tick(task.id);
    const done = (await api(operator).get(`/msaidizi/tasks/${task.id}`).expect(200)).body.data;
    expect(done).toMatchObject({
      status: 'COMPLETED',
      attemptedToolCalls: 1,
      executedToolCalls: 1,
      mutations: 0,
    });
    expect(done.toolAttempts).toHaveLength(1);
    expect(done.toolAttempts[0]).toMatchObject({
      status: 'SUCCEEDED',
      resultSummary: { ok: true, httpStatus: 200 },
    });
    expect(JSON.stringify(done.toolAttempts[0].resultSummary)).toContain(
      `visible-expense-${suffix}`,
    );
    expect(JSON.stringify(done.toolAttempts[0].resultSummary)).not.toContain(
      `hidden-expense-${suffix}`,
    );
    await boot();
    const restored = (await api(operator).get(`/msaidizi/tasks/${task.id}`).expect(200)).body.data;
    expect(restored.toolAttempts).toEqual(done.toolAttempts);
    expect(restored.startedAt).toBe(done.startedAt);
    const events = (
      await api(operator)
        .get(`/msaidizi/tasks/${task.id}/events?after=${before.nextCursor}`)
        .expect(200)
    ).body.data;
    expect(events.data.length).toBeGreaterThan(0);
    const cursors: bigint[] = events.data.map((event: { cursor: string }) => BigInt(event.cursor));
    expect(
      cursors.every((cursor, i) => cursor > (i ? cursors[i - 1] : BigInt(before.nextCursor))),
    ).toBe(true);
    await tick(task.id);
    expect(await prisma.msaidiziToolAttempt.count({ where: { taskId: task.id } })).toBe(1);
    expect(
      await prisma.auditLog.count({
        where: {
          taskId: task.id,
          principalId: done.principalId,
          initiatedByUserId: operator.id,
          channel: 'AGENT',
          action: 'MSAIDIZI_ERP_ACTION_SUCCEEDED',
        },
      }),
    ).toBe(1);
  }, 120_000);

  it('retains authentication, caller ownership, company scope and plan permission checks', async () => {
    const task = await plan();
    await request(url).get(`/msaidizi/tasks/${task.id}`).expect(401);
    await api(observer).get(`/msaidizi/tasks/${task.id}`).expect(404);
    await api(observer).get(`/msaidizi/tasks/${task.id}/events`).expect(404);
    await api(observer).post(`/msaidizi/tasks/${task.id}/cancel`).expect(404);
    await api(operator).post('/msaidizi/tasks/plan', planBody(otherCompanyId)).expect(403);
    await api(denied).post('/msaidizi/tasks/plan', planBody()).expect(400);
    const untrustedPlan = planBody();
    await api(operator)
      .post('/msaidizi/tasks/plan', {
        ...untrustedPlan,
        steps: untrustedPlan.steps.map((step) => ({ ...step, dependencyLineage: [] })),
      })
      .expect(400);
    expect(await prisma.msaidiziToolAttempt.count({ where: { taskId: task.id } })).toBe(0);
  });

  it('honors live permission revocation before restarted execution', async () => {
    const task = await plan(revokee);
    await api(revokee).post('/msaidizi/tasks', { taskId: task.id }).expect(201);
    await prisma.rolePermission.deleteMany({
      where: { roleId: revokee.roleId, permissionId: viewPermissionId },
    });
    await boot();
    await tick(task.id);
    const result = (await api(revokee).get(`/msaidizi/tasks/${task.id}`).expect(200)).body.data;
    expect(result.status).toBe('FAILED');
    expect(result.toolAttempts).toHaveLength(1);
    expect(result.toolAttempts[0].status).toBe('FAILED');
    expect(JSON.stringify(result.toolAttempts)).not.toContain(`visible-expense-${suffix}`);
    expect(result.mutations).toBe(0);
  }, 90_000);

  it('preserves HTTP cancellation across restart and refuses to resume or dispatch it', async () => {
    const task = await plan();
    await api(operator).post('/msaidizi/tasks', { taskId: task.id }).expect(201);
    const cancelled = (await api(operator).post(`/msaidizi/tasks/${task.id}/cancel`).expect(200))
      .body.data;
    expect(cancelled.status).toBe('CANCELLED');
    await boot();
    await api(operator).post(`/msaidizi/tasks/${task.id}/resume`).expect(409);
    await api(operator).post('/msaidizi/tasks', { taskId: task.id }).expect(409);
    await tick(task.id);
    const restored = (await api(operator).get(`/msaidizi/tasks/${task.id}`).expect(200)).body.data;
    expect(restored).toMatchObject({
      status: 'CANCELLED',
      endedAt: cancelled.endedAt,
      attemptedToolCalls: 0,
      executedToolCalls: 0,
      mutations: 0,
      toolAttempts: [],
    });
    const repeated = (await api(operator).post(`/msaidizi/tasks/${task.id}/cancel`).expect(200))
      .body.data;
    expect(repeated.endedAt).toBe(cancelled.endedAt);
    expect(await prisma.backgroundJob.count({ where: { correlationId: task.id } })).toBe(0);
  }, 90_000);

  it('never replays an authenticated committed expense after backend death before task settlement', async () => {
    await boot(true);
    async function createPlan(marker: string, successor = false) {
      const body = planBody();
      return (
        await api(operator)
          .post('/msaidizi/tasks/plan', {
            ...body,
            mode: 'COLLABORATIVE',
            steps: [
              {
                ...body.steps[0],
                key: 'create',
                name: 'Create draft expense',
                capability: 'ExpensesController.create',
                expectedEffect: 'WRITE',
                mutation: true,
                idempotent: false,
                arguments: {
                  path: {},
                  query: {},
                  body: {
                    companyId,
                    expenseCategoryId,
                    amount: 12.34,
                    expenseDate: '2026-09-04',
                    description: marker,
                  },
                },
              },
              ...(successor ? [{ ...body.steps[0], dependsOn: ['create'] }] : []),
            ],
          })
          .expect(201)
      ).body.data;
    }
    // Positive control establishes that the real write path can fully succeed.
    const positiveMarker = `api-write-positive-${suffix}`;
    const positive = await createPlan(positiveMarker);
    await api(operator).post('/msaidizi/tasks', { taskId: positive.id }).expect(201);
    await tick(positive.id);
    const completed = (await api(operator).get(`/msaidizi/tasks/${positive.id}`).expect(200)).body
      .data;
    expect(completed).toMatchObject({
      status: 'COMPLETED',
      mutations: 1,
      attemptedToolCalls: 1,
      executedToolCalls: 1,
    });
    expect(await prisma.expense.count({ where: { companyId, description: positiveMarker } })).toBe(
      1,
    );
    expect(
      await prisma.auditLog.count({
        where: { taskId: positive.id, action: 'MSAIDIZI_ERP_ACTION_SUCCEEDED' },
      }),
    ).toBe(1);

    const marker = `api-write-interrupted-${suffix}`;
    const task = await createPlan(marker, true);
    await api(operator).post('/msaidizi/tasks', { taskId: task.id }).expect(201);
    let reached!: () => void;
    const checkpoint = new Promise<void>((resolve) => {
      reached = resolve;
    });
    const inFlight = tick(task.id, reached).then(
      () => null,
      (error: Error) => error,
    );
    await Promise.race([
      checkpoint,
      inFlight.then(() => {
        throw new Error('Worker settled before the post-response checkpoint');
      }),
    ]);
    const committed = await prisma.expense.findMany({ where: { companyId, description: marker } });
    expect(committed).toHaveLength(1);
    expect(committed[0]).toMatchObject({ status: 'DRAFT', createdById: operator.id });
    const running = (await api(operator).get(`/msaidizi/tasks/${task.id}`).expect(200)).body.data;
    expect(running.status).toBe('RUNNING');
    expect(running.toolAttempts).toHaveLength(1);
    expect(running.toolAttempts[0].status).toBe('RUNNING');
    const cancellation = (await api(operator).post(`/msaidizi/tasks/${task.id}/cancel`).expect(200))
      .body.data;
    expect(cancellation.status).toBe('CANCELLING');
    await stop();
    expect(await inFlight).toBeInstanceOf(Error);
    await boot(true);
    await tick(task.id);
    const recovered = (await api(operator).get(`/msaidizi/tasks/${task.id}`).expect(200)).body.data;
    expect(recovered).toMatchObject({
      status: 'NEEDS_ATTENTION',
      failureCode: 'UNKNOWN_WRITE_OUTCOME',
      attemptedToolCalls: running.attemptedToolCalls,
      executedToolCalls: running.executedToolCalls,
      mutations: running.mutations,
      startedAt: running.startedAt,
    });
    expect(recovered.toolAttempts).toHaveLength(1);
    expect(recovered.toolAttempts[0]).toMatchObject({
      id: running.toolAttempts[0].id,
      status: 'UNKNOWN',
      uncertainOutcome: true,
      errorCode: 'WORKER_LEASE_LOST',
    });
    await api(operator).post(`/msaidizi/tasks/${task.id}/cancel`).expect(409);
    await api(operator).post(`/msaidizi/tasks/${task.id}/resume`).expect(409);
    await boot(true);
    await tick(task.id);
    const stable = (await api(operator).get(`/msaidizi/tasks/${task.id}`).expect(200)).body.data;
    expect(stable.status).toBe('NEEDS_ATTENTION');
    expect(stable.toolAttempts).toEqual(recovered.toolAttempts);
    expect(await prisma.expense.count({ where: { companyId, description: marker } })).toBe(1);
    expect(await prisma.msaidiziToolAttempt.count({ where: { taskId: task.id } })).toBe(1);
    const audits = await prisma.auditLog.findMany({
      where: { taskId: task.id, action: { in: ['EXPENSE_CREATE', 'MSAIDIZI_ERP_ACTION_UNKNOWN'] } },
    });
    expect(audits.map((audit) => audit.action).sort()).toEqual([
      'EXPENSE_CREATE',
      'MSAIDIZI_ERP_ACTION_UNKNOWN',
    ]);
    for (const audit of audits)
      expect(audit).toMatchObject({
        companyId,
        principalId: recovered.principalId,
        initiatedByUserId: operator.id,
        channel: 'AGENT',
      });
    expect(
      await prisma.msaidiziTaskStep.findFirst({ where: { taskId: task.id, stepKey: 'expenses' } }),
    ).toMatchObject({ status: 'CANCELLED' });
  }, 120_000);
  it('executes a reviewed routine through real ERP after restart with bound inputs and authority evidence', async () => {
    await boot(false, true);
    const mandateBody = {
      name: `API routine authority ${suffix}`,
      description: 'Read company expenses only; no host, mutations or model use',
      companyId,
      capabilities: [
        {
          capability: 'ExpensesController.findAll',
          effects: ['READ'],
          dataClasses: ['business_records'],
        },
      ],
      deviceIds: [],
      budgets: { maxAttemptedToolCalls: 2, maxMutations: 0, maxModelCostUsd: 0 },
      expiresAt: new Date(Date.now() + 300_000).toISOString(),
    };
    const unapproved = (await api(denied).post('/msaidizi/mandates', mandateBody).expect(201)).body
      .data;
    await api(denied)
      .post(`/msaidizi/mandates/${unapproved.id}/activate`, {
        expectedVersion: unapproved.version,
      })
      .expect(403);
    expect(await prisma.msaidiziMandate.findUnique({ where: { id: unapproved.id } })).toMatchObject(
      { status: 'DRAFT', version: unapproved.version },
    );
    const draft = (await api(operator).post('/msaidizi/mandates', mandateBody).expect(201)).body
      .data;
    const mandate = (
      await api(operator)
        .post(`/msaidizi/mandates/${draft.id}/activate`, {
          expectedVersion: draft.version,
        })
        .expect(200)
    ).body.data;
    const template = {
      title: `API routine ${suffix}`,
      objective: 'Read expenses using the immutable reviewed page input',
      inputs: { page: 1 },
      steps: [
        {
          ...planBody().steps[0],
          arguments: { path: {}, query: { companyId, page: null } },
          inputBindings: [
            {
              targetPath: '/query/page',
              source: { kind: 'PLAN_INPUT', path: '/page' },
              dataClass: 'business_records',
              expectedType: 'integer',
              expectedSchema: { type: 'integer', minimum: 1 },
              transform: { name: 'IDENTITY', version: '1' },
            },
          ],
        },
      ],
    };
    const routineDraft = (
      await api(operator)
        .post('/msaidizi/routines', {
          mandateId: mandate.id,
          name: `API read routine ${suffix}`,
          cronExpression: '0 0 * * *',
          timezone: 'UTC',
          nextRunAt: new Date(Date.now() - 1_000).toISOString(),
          taskTemplate: template,
        })
        .expect(201)
    ).body.data;
    await api(observer).get(`/msaidizi/routines/${routineDraft.id}`).expect(404);
    await api(denied)
      .post(`/msaidizi/routines/${routineDraft.id}/activate`, {
        expectedVersion: routineDraft.version,
      })
      .expect(403);
    const routine = (
      await api(operator)
        .post(`/msaidizi/routines/${routineDraft.id}/activate`, {
          expectedVersion: routineDraft.version,
        })
        .expect(200)
    ).body.data;
    try {
      const snapshot = (
        await api(operator)
          .get(`/msaidizi/routines/${routine.id}/versions/${routine.version}`)
          .expect(200)
      ).body.data;
      expect(snapshot.taskTemplate).toEqual(template);
      // Restart before the first occurrence: no in-memory schedule is needed.
      await boot(false, true);
      // An unrelated task ID advances the real dispatcher but drains no jobs.
      await tick(randomUUID());
      const tasks = await prisma.msaidiziTask.findMany({ where: { scheduleId: routine.id } });
      expect(tasks).toHaveLength(1);
      const task = tasks[0];
      expect(task).toMatchObject({
        mode: 'AUTOPILOT',
        mandateId: mandate.id,
        companyId,
        initiatedByUserId: operator.id,
        hostExecutionAllowed: false,
        maxAttemptedToolCalls: 2,
        maxMutations: 0,
      });
      expect(await prisma.msaidiziToolAttempt.count({ where: { taskId: task.id } })).toBe(0);
      // Restart again between durable scheduling and actual ERP execution.
      await boot(false, true);
      await tick(task.id);
      const done = (await api(operator).get(`/msaidizi/tasks/${task.id}`).expect(200)).body.data;
      expect(done).toMatchObject({
        status: 'COMPLETED',
        attemptedToolCalls: 1,
        executedToolCalls: 1,
        mutations: 0,
      });
      expect(done.toolAttempts).toHaveLength(1);
      const attempt = done.toolAttempts[0];
      expect(attempt).toMatchObject({
        status: 'SUCCEEDED',
        resultSummary: { ok: true, httpStatus: 200 },
      });
      expect(JSON.stringify(attempt.resultSummary)).toContain(`visible-expense-${suffix}`);
      expect(JSON.stringify(attempt.resultSummary)).not.toContain(`hidden-expense-${suffix}`);
      const step = await prisma.msaidiziTaskStep.findFirstOrThrow({ where: { taskId: task.id } });
      expect(step.inputBindings).toEqual(template.steps[0].inputBindings);
      expect(step.arguments).toEqual(template.steps[0].arguments);
      const persistedAttempt = await prisma.msaidiziToolAttempt.findUniqueOrThrow({
        where: { id: attempt.id },
      });
      expect(persistedAttempt.resolvedInputProvenance).toMatchObject({
        taskId: task.id,
        stepId: step.id,
        attemptId: attempt.id,
        bindings: [
          {
            targetPath: '/query/page',
            instructionAuthority: false,
            trustLevel: 'REVIEWED_REFERENCE',
            source: { kind: 'PLAN_INPUT', sourcePath: '/page', planVersionId: step.planVersionId },
          },
        ],
      });
      expect(persistedAttempt.inputProvenanceSha256).toMatch(/^[a-f0-9]{64}$/);
      const authority = {
        protocol: 'MSAIDIZI_SCHEDULE_AUTHORITY_V1',
        principalId: task.principalId,
        companyId,
        scheduleId: routine.id,
        scheduleVersion: routine.version,
        scheduleUpdatedAt: routine.updatedAt,
        mandateId: mandate.id,
        mandateVersion: mandate.version,
        mandateUpdatedAt: mandate.updatedAt,
      };
      const created = await prisma.msaidiziTaskEvent.findFirstOrThrow({
        where: { taskId: task.id, type: 'task.created' },
      });
      expect(created.payload).toMatchObject({ creationAuthority: authority });
      const audits = await prisma.auditLog.findMany({
        where: {
          taskId: task.id,
          action: { in: ['MSAIDIZI_SCHEDULE_DISPATCH', 'MSAIDIZI_ERP_ACTION_SUCCEEDED'] },
        },
      });
      expect(audits.map((entry) => entry.action).sort()).toEqual([
        'MSAIDIZI_ERP_ACTION_SUCCEEDED',
        'MSAIDIZI_SCHEDULE_DISPATCH',
      ]);
      for (const audit of audits)
        expect(audit).toMatchObject({
          companyId,
          principalType: audit.action === 'MSAIDIZI_SCHEDULE_DISPATCH' ? 'MSAIDIZI' : 'SERVICE',
          principalId: task.principalId,
          mandateId: mandate.id,
          initiatedByUserId: operator.id,
          channel: 'AGENT',
        });
      expect(
        audits.find((entry) => entry.action === 'MSAIDIZI_SCHEDULE_DISPATCH')!.newValue,
      ).toMatchObject({ creationAuthority: authority });
      await tick(task.id);
      expect(await prisma.msaidiziTask.count({ where: { scheduleId: routine.id } })).toBe(1);
      expect(await prisma.msaidiziToolAttempt.count({ where: { taskId: task.id } })).toBe(1);
    } finally {
      // Retain all evidence but remove this fixture's future authority.
      const current = (await api(operator).get(`/msaidizi/routines/${routine.id}`).expect(200)).body
        .data;
      await api(operator)
        .post(`/msaidizi/routines/${routine.id}/pause`, {
          expectedVersion: current.version,
        })
        .expect(200);
      await api(operator)
        .post(`/msaidizi/mandates/${mandate.id}/revoke`, {
          expectedVersion: mandate.version,
        })
        .expect(200);
    }
  }, 150_000);
  it.each([
    'continue',
    'revoke',
    'adaptive',
    'queued-pause',
    'model-pause-live',
    'model-pause-replan',
    'model-pause-crash',
    'decision-commit-crash',
    'decision-commit-replan',
    'decision-commit-pause',
    'unplanned',
    'replan',
    'lineage',
    'binding-fill',
    'model-crash',
    'model-cancel-crash',
    'model-cancel-live',
    'model-cancel-late',
  ] as const)(
    'governs a result-dependent routine across restart: %s',
    async (decision) => {
      const reasoning =
        decision === 'adaptive' ||
        decision === 'queued-pause' ||
        decision === 'model-pause-live' ||
        decision === 'model-pause-crash' ||
        decision === 'decision-commit-crash' ||
        decision === 'decision-commit-pause' ||
        decision === 'model-crash' ||
        decision === 'model-cancel-crash' ||
        decision === 'model-cancel-live' ||
        decision === 'model-cancel-late'
          ? 'continue'
          : decision === 'lineage' ||
              decision === 'model-pause-replan' ||
              decision === 'decision-commit-replan'
            ? 'replan'
            : decision === 'unplanned' || decision === 'replan' || decision === 'binding-fill'
              ? decision
              : undefined;
      const replanning = [
        'replan',
        'lineage',
        'binding-fill',
        'model-pause-replan',
        'decision-commit-replan',
      ].includes(decision);
      const planInputReplan = decision === 'replan' || decision === 'binding-fill';
      await boot(false, true, reasoning);
      const draft = (
        await api(operator)
          .post('/msaidizi/mandates', {
            name: `Dependent read authority ${decision} ${suffix}`,
            description: 'Reviewed read calls only; no mutations or host access',
            companyId,
            capabilities: ['ExpensesController.findAll', 'ExpensesController.findOne'].map(
              (capability) => ({
                capability,
                effects: ['READ'],
                dataClasses: ['business_records'],
              }),
            ),
            deviceIds: [],
            budgets: {
              maxAttemptedToolCalls: replanning ? 3 : 2,
              maxMutations: 0,
              maxModelCostUsd: reasoning ? 20 : 0,
              maxModelTurns: 2,
            },
            expiresAt: new Date(Date.now() + 300_000).toISOString(),
          })
          .expect(201)
      ).body.data;
      const mandate = (
        await api(operator)
          .post(`/msaidizi/mandates/${draft.id}/activate`, {
            expectedVersion: draft.version,
          })
          .expect(200)
      ).body.data;
      const source = planBody().steps[0];
      const binding = planInputReplan
        ? {
            targetPath: '/query/page',
            source: { kind: 'PLAN_INPUT', path: '/page' },
            dataClass: 'business_records',
            expectedType: 'integer',
            expectedSchema: { type: 'integer', minimum: 1 },
            transform: { name: 'IDENTITY', version: '1' },
          }
        : {
            targetPath: '/path/id',
            source: {
              kind: 'DEPENDENCY_OUTPUT',
              dependencyStepKey: source.key,
              path: '/data/data/0/id',
            },
            dataClass: 'business_records',
            expectedType: 'string',
            expectedSchema: { type: 'string', minLength: 36, maxLength: 36 },
            transform: { name: 'IDENTITY', version: '1' },
          };
      const detailArguments = planInputReplan
        ? { path: {}, query: { companyId, page: null } }
        : { path: { id: null }, query: {} };
      const routineDraft = (
        await api(operator)
          .post('/msaidizi/routines', {
            mandateId: mandate.id,
            name: `Dependent read ${decision} ${suffix}`,
            cronExpression: '0 0 * * *',
            timezone: 'UTC',
            nextRunAt: new Date(Date.now() - 1_000).toISOString(),
            taskTemplate: {
              title: `Dependent read ${decision} ${suffix}`,
              objective: 'Read one company expense selected from the preceding verified result',
              inputs: planInputReplan ? { page: 1 } : {},
              steps: [
                source,
                {
                  ...source,
                  key: 'detail',
                  name: 'Read selected expense',
                  capability: planInputReplan
                    ? 'ExpensesController.findAll'
                    : 'ExpensesController.findOne',
                  arguments: detailArguments,
                  dependsOn: [source.key],
                  inputBindings: [binding],
                },
                ...(replanning
                  ? [
                      {
                        ...source,
                        key: 'fallback',
                        name: 'Optional fallback',
                        dependsOn: [source.key],
                      },
                    ]
                  : []),
              ],
            },
          })
          .expect(201)
      ).body.data;
      const routine = (
        await api(operator)
          .post(`/msaidizi/routines/${routineDraft.id}/activate`, {
            expectedVersion: routineDraft.version,
          })
          .expect(200)
      ).body.data;
      let revoked = false;
      try {
        await tick(randomUUID());
        const task = await prisma.msaidiziTask.findFirstOrThrow({
          where: { scheduleId: routine.id },
        });
        await tick(task.id);
        const first = (await api(operator).get(`/msaidizi/tasks/${task.id}`).expect(200)).body.data;
        expect(first).toMatchObject({
          status: 'RUNNING',
          attemptedToolCalls: 1,
          executedToolCalls: 1,
          mutations: 0,
        });
        expect(first.toolAttempts).toHaveLength(1);
        const sourceAttempt = first.toolAttempts[0];
        expect(sourceAttempt).toMatchObject({
          status: 'SUCCEEDED',
          resultSummary: { observation: { available: true, redactionsApplied: false } },
        });
        const selectedId = sourceAttempt.resultSummary.observation.value.data.data[0].id;
        expect(
          await prisma.expense.findUnique({
            where: { id: selectedId },
            select: { companyId: true },
          }),
        ).toEqual({ companyId });
        let detail = await prisma.msaidiziTaskStep.findFirstOrThrow({
          where: { taskId: task.id, stepKey: 'detail' },
        });
        expect(detail).toMatchObject({
          status: reasoning ? 'PENDING' : 'LEASED',
          inputBindings: [binding],
          arguments: detailArguments,
        });
        expect(await prisma.msaidiziToolAttempt.count({ where: { stepId: detail.id } })).toBe(0);
        let checkpointId: string | undefined;
        if (reasoning) {
          const queued = await prisma.msaidiziReasoningTurn.findFirstOrThrow({
            where: { taskId: task.id },
          });
          expect(queued).toMatchObject({ status: 'QUEUED', inputTokens: 0n, outputTokens: 0n });
          checkpointId = queued.id;
          const jobs = await prisma.backgroundJob.findMany({
            where: { correlationId: task.id, jobType: 'MSAIDIZI_REASONING_CHECKPOINT' },
          });
          expect(jobs).toHaveLength(1);
          expect(jobs[0]).toMatchObject({
            maxAttempts: 1,
            status: 'QUEUED',
            payload: { turnId: queued.id, taskId: task.id },
          });
        }
        if (decision === 'revoke') {
          await api(operator)
            .post(`/msaidizi/mandates/${mandate.id}/revoke`, { expectedVersion: mandate.version })
            .expect(200);
          revoked = true;
        }
        if (decision === 'queued-pause') {
          const original = await prisma.msaidiziReasoningTurn.findUniqueOrThrow({
            where: { id: checkpointId! },
          });
          const job = await prisma.backgroundJob.findFirstOrThrow({
            where: { correlationId: task.id, jobType: 'MSAIDIZI_REASONING_CHECKPOINT' },
          });
          expect(
            (await api(operator).post(`/msaidizi/tasks/${task.id}/pause`).expect(200)).body.data
              .status,
          ).toBe('PAUSING');
          await tick(task.id);
          await boot(false, true, reasoning);
          await tick(task.id);
          expect(
            (await api(operator).get(`/msaidizi/tasks/${task.id}`).expect(200)).body.data,
          ).toMatchObject({
            status: 'PAUSED',
            modelTurns: 0,
            attemptedToolCalls: 1,
            executedToolCalls: 1,
          });
          expect(
            await prisma.msaidiziReasoningTurn.findUniqueOrThrow({ where: { id: checkpointId! } }),
          ).toEqual(original);
          expect(
            await prisma.backgroundJob.findUniqueOrThrow({ where: { id: job.id } }),
          ).toMatchObject({ status: 'CANCELLED', attempts: 0, leaseOwner: null });
          await api(operator).post(`/msaidizi/tasks/${task.id}/resume`).expect(200);
        }
        await boot(false, true, reasoning);
        if (decision.startsWith('decision-commit-')) {
          let reached!: () => void;
          const committed = new Promise<void>((resolve) => {
            reached = resolve;
          });
          const inFlight = tick(task.id, undefined, undefined, false, false, reached).then(
            () => null,
            (error: Error) => error,
          );
          await Promise.race([
            committed,
            inFlight.then(() => {
              throw new Error('Worker settled before decision-commit checkpoint');
            }),
          ]);
          const savedTurn = await prisma.msaidiziReasoningTurn.findUniqueOrThrow({
            where: { id: checkpointId! },
          });
          expect(savedTurn).toMatchObject({
            status: 'SUCCEEDED',
            decision: replanning ? 'REPLAN' : 'CONTINUE',
            inputTokens: 120n,
            outputTokens: 30n,
          });
          const savedEvents = await prisma.msaidiziTaskEvent.findMany({
            where: {
              taskId: task.id,
              type: {
                in: [
                  'reasoning.model_call_accounted',
                  'reasoning.checkpoint_completed',
                  'reasoning.plan_version_created',
                ],
              },
            },
            orderBy: { cursor: 'asc' },
          });
          expect(
            savedEvents.filter((event) => event.type === 'reasoning.model_call_accounted'),
          ).toHaveLength(1);
          expect(
            savedEvents.filter((event) => event.type === 'reasoning.checkpoint_completed'),
          ).toHaveLength(1);
          const job = await prisma.backgroundJob.findFirstOrThrow({
            where: { correlationId: task.id, jobType: 'MSAIDIZI_REASONING_CHECKPOINT' },
          });
          expect(job).toMatchObject({
            status: 'RUNNING',
            attempts: 0,
            maxAttempts: 1,
            leaseOwner: expect.any(String),
            result: null,
          });
          if (decision === 'decision-commit-pause') {
            await api(operator).post(`/msaidizi/tasks/${task.id}/pause`).expect(200);
            await tick(task.id, undefined, undefined, true);
            expect(
              (await api(operator).get(`/msaidizi/tasks/${task.id}`).expect(200)).body.data.status,
            ).toBe('PAUSING');
          }
          await stop();
          expect(await inFlight).toBeInstanceOf(Error);
          await boot(false, true, reasoning);
          await tick(task.id);
          expect(
            await prisma.msaidiziReasoningTurn.findUniqueOrThrow({ where: { id: checkpointId! } }),
          ).toEqual(savedTurn);
          expect(
            await prisma.msaidiziTaskEvent.findMany({
              where: { taskId: task.id, cursor: { in: savedEvents.map((event) => event.cursor) } },
              orderBy: { cursor: 'asc' },
            }),
          ).toEqual(savedEvents);
          expect(
            await prisma.backgroundJob.findUniqueOrThrow({ where: { id: job.id } }),
          ).toMatchObject({ status: 'DEAD_LETTER', attempts: 1, leaseOwner: null });
          expect(
            await prisma.msaidiziTaskEvent.count({
              where: { taskId: task.id, type: 'reasoning.worker_lease_lost' },
            }),
          ).toBe(0);
          if (decision === 'decision-commit-pause') {
            expect(
              (await api(operator).get(`/msaidizi/tasks/${task.id}`).expect(200)).body.data,
            ).toMatchObject({ status: 'PAUSED', modelTurns: 1, executedToolCalls: 1 });
            await api(operator).post(`/msaidizi/tasks/${task.id}/resume`).expect(200);
            await boot(false, true, reasoning);
          }
        }
        if (decision === 'model-pause-live' || decision === 'model-pause-replan') {
          let reached!: () => void;
          const reserved = new Promise<void>((resolve) => {
            reached = resolve;
          });
          const inFlight = tick(task.id, undefined, reached).then(
            () => null,
            (error: Error) => error,
          );
          await Promise.race([
            reserved,
            inFlight.then(() => {
              throw new Error('Model settled before pause checkpoint');
            }),
          ]);
          expect(
            (await api(operator).post(`/msaidizi/tasks/${task.id}/pause`).expect(200)).body.data
              .status,
          ).toBe('PAUSING');
          await tick(task.id, undefined, undefined, true);
          expect(
            (await api(operator).get(`/msaidizi/tasks/${task.id}`).expect(200)).body.data,
          ).toMatchObject({ status: 'PAUSING', modelTurns: 1, executedToolCalls: 1 });
          const held = [...pending.entries()].find(([, value]) => value.afterModelReservation);
          expect(held).toBeDefined();
          child!.send({ command: 'release-model', id: held![0] });
          expect(await inFlight).toBeNull();
          const completed = await prisma.msaidiziReasoningTurn.findUniqueOrThrow({
            where: { id: checkpointId! },
          });
          expect(completed).toMatchObject({
            status: 'SUCCEEDED',
            decision: replanning ? 'REPLAN' : 'CONTINUE',
            inputTokens: 120n,
            outputTokens: 30n,
          });
          await boot(false, true, reasoning);
          await tick(task.id);
          expect(
            (await api(operator).get(`/msaidizi/tasks/${task.id}`).expect(200)).body.data,
          ).toMatchObject({
            status: 'PAUSED',
            modelTurns: 1,
            executedToolCalls: 1,
            activePlanVersion: replanning ? 2 : 1,
          });
          expect(
            await prisma.msaidiziReasoningTurn.findUniqueOrThrow({ where: { id: checkpointId! } }),
          ).toEqual(completed);
          await api(operator).post(`/msaidizi/tasks/${task.id}/resume`).expect(200);
          await boot(false, true, reasoning);
        }
        if (
          decision === 'model-crash' ||
          decision === 'model-pause-crash' ||
          decision === 'model-cancel-crash' ||
          decision === 'model-cancel-live' ||
          decision === 'model-cancel-late'
        ) {
          const cancelled = decision !== 'model-crash' && decision !== 'model-pause-crash';
          const knownUsage = decision === 'model-cancel-late';
          const live = decision === 'model-cancel-live' || decision === 'model-cancel-late';
          let reached!: () => void;
          const checkpoint = new Promise<void>((resolve) => {
            reached = resolve;
          });
          const inFlight = tick(
            task.id,
            undefined,
            reached,
            false,
            decision === 'model-cancel-late',
          ).then(
            () => null,
            (error: Error) => error,
          );
          await Promise.race([
            checkpoint,
            inFlight.then(() => {
              throw new Error('Model settled before interruption checkpoint');
            }),
          ]);
          const reserved = await prisma.msaidiziReasoningTurn.findUniqueOrThrow({
            where: { id: checkpointId! },
          });
          expect(reserved).toMatchObject({ status: 'RUNNING', inputTokens: 0n, outputTokens: 0n });
          expect(reserved.reservedCostUsd.toNumber()).toBeGreaterThan(0);
          expect(reserved.actualCostUsd.toNumber()).toBe(0);
          const running = (await api(operator).get(`/msaidizi/tasks/${task.id}`).expect(200)).body
            .data;
          expect(running).toMatchObject({
            status: 'RUNNING',
            modelTurns: 1,
            attemptedToolCalls: 1,
            executedToolCalls: 1,
          });
          expect(Number(running.modelCostUsd)).toBe(reserved.reservedCostUsd.toNumber());
          if (decision === 'model-pause-crash') {
            await api(operator).post(`/msaidizi/tasks/${task.id}/pause`).expect(200);
            await tick(task.id, undefined, undefined, true);
            expect(
              (await api(operator).get(`/msaidizi/tasks/${task.id}`).expect(200)).body.data.status,
            ).toBe('PAUSING');
          }
          if (cancelled) {
            const cancellation = (
              await api(operator).post(`/msaidizi/tasks/${task.id}/cancel`).expect(200)
            ).body.data;
            expect(cancellation.status).toBe('CANCELLING');
          }
          if (live) {
            await tick(task.id, undefined, undefined, true);
            expect(await inFlight).toBeNull();
          } else {
            await stop();
            expect(await inFlight).toBeInstanceOf(Error);
          }
          await boot(false, true, reasoning);
          await tick(task.id);
          const recovered = (await api(operator).get(`/msaidizi/tasks/${task.id}`).expect(200)).body
            .data;
          expect(recovered).toMatchObject({
            status: cancelled ? 'CANCELLED' : 'NEEDS_ATTENTION',
            failureCode: cancelled ? null : 'REASONING_WORKER_LEASE_LOST',
            modelTurns: 1,
            modelCostUsd: knownUsage ? expect.anything() : running.modelCostUsd,
            attemptedToolCalls: 1,
            executedToolCalls: 1,
            mutations: 0,
          });
          const settled = await prisma.msaidiziReasoningTurn.findUniqueOrThrow({
            where: { id: checkpointId! },
          });
          expect(settled).toMatchObject({
            status: cancelled ? 'CANCELLED' : 'FAILED',
            errorCode: cancelled ? 'REASONING_TASK_CANCELLED' : 'REASONING_WORKER_LEASE_LOST',
            reservedCostUsd: reserved.reservedCostUsd,
            reservedInputTokens: reserved.reservedInputTokens,
            reservedOutputTokens: reserved.reservedOutputTokens,
            inputTokens: knownUsage ? 120n : 0n,
            outputTokens: knownUsage ? 30n : 0n,
            actualCostUsd: knownUsage ? expect.anything() : reserved.actualCostUsd,
            decision: null,
            evaluation: null,
          });
          if (knownUsage) {
            expect(settled.actualCostUsd.toNumber()).toBeGreaterThan(0);
            expect(settled.actualCostUsd.toNumber()).toBeLessThan(
              reserved.reservedCostUsd.toNumber(),
            );
            expect(Number(recovered.modelCostUsd)).toBe(settled.actualCostUsd.toNumber());
            expect(recovered).toMatchObject({ inputTokens: '120', outputTokens: '30' });
          }
          expect(
            await prisma.msaidiziTaskEvent.count({
              where: { taskId: task.id, type: 'reasoning.model_call_accounted' },
            }),
          ).toBe(knownUsage ? 1 : 0);
          await boot(false, true, reasoning);
          await tick(task.id);
          expect(
            await prisma.msaidiziReasoningTurn.findMany({ where: { taskId: task.id } }),
          ).toEqual([settled]);
          expect(await prisma.msaidiziToolAttempt.count({ where: { taskId: task.id } })).toBe(1);
          expect(await prisma.msaidiziToolAttempt.count({ where: { stepId: detail.id } })).toBe(0);
          expect(
            await prisma.msaidiziTaskEvent.count({
              where: {
                taskId: task.id,
                type: cancelled ? 'reasoning.checkpoint_cancelled' : 'reasoning.worker_lease_lost',
              },
            }),
          ).toBe(1);
          expect(
            await prisma.backgroundJob.findMany({
              where: { correlationId: task.id, jobType: 'MSAIDIZI_REASONING_CHECKPOINT' },
            }),
          ).toEqual([
            expect.objectContaining({
              status: cancelled ? 'CANCELLED' : 'DEAD_LETTER',
              maxAttempts: 1,
              attempts: cancelled ? 0 : 1,
              leaseOwner: null,
            }),
          ]);
          return;
        }
        await tick(task.id);
        if (reasoning) {
          const evaluated = await prisma.msaidiziReasoningTurn.findUniqueOrThrow({
            where: { id: checkpointId! },
          });
          expect(evaluated).toMatchObject({
            inputTokens: 120n,
            outputTokens: 30n,
            status: reasoning === 'unplanned' ? 'FAILED' : 'SUCCEEDED',
          });
          expect(evaluated.actualCostUsd.toNumber()).toBeGreaterThan(0);
          if (reasoning === 'unplanned') {
            expect(evaluated.errorCode).toBe('RUNTIME_CRITIC_REJECTED');
            const rejected = (await api(operator).get(`/msaidizi/tasks/${task.id}`).expect(200))
              .body.data;
            expect(rejected).toMatchObject({
              status: 'NEEDS_ATTENTION',
              modelTurns: 1,
              attemptedToolCalls: 1,
              executedToolCalls: 1,
              activePlanVersion: 1,
            });
            expect(await prisma.msaidiziTaskStep.count({ where: { taskId: task.id } })).toBe(2);
            expect(await prisma.msaidiziToolAttempt.count({ where: { stepId: detail.id } })).toBe(
              0,
            );
            await boot(false, true, reasoning);
            await tick(task.id);
            expect(await prisma.msaidiziReasoningTurn.count({ where: { taskId: task.id } })).toBe(
              1,
            );
            return;
          }
          if (replanning) {
            expect(evaluated.decision).toBe('REPLAN');
            const sourceRecord = await prisma.msaidiziToolAttempt.findFirstOrThrow({
              where: { id: sourceAttempt.id, taskId: task.id },
            });
            const oldDetail = detail;
            const plans = await prisma.msaidiziPlanVersion.findMany({
              where: { taskId: task.id },
              orderBy: { version: 'asc' },
              include: { steps: true },
            });
            expect(plans).toHaveLength(2);
            expect(plans[1]).toMatchObject({
              version: 2,
              inputs: planInputReplan ? { page: 1 } : {},
            });
            expect(plans[1].planDigest).not.toBe(plans[0].planDigest);
            expect(plans[1].steps).toHaveLength(1);
            detail = plans[1].steps[0];
            expect(detail.id).not.toBe(oldDetail.id);
            expect(detail).toMatchObject({
              stepKey: 'detail',
              inputBindings: [binding],
              arguments:
                decision === 'binding-fill'
                  ? { path: {}, query: { companyId, page: null, limit: 10 } }
                  : detailArguments,
              dependencies: [],
              dependencyLineage: [
                {
                  version: 1,
                  dependencyStepKey: source.key,
                  sourcePlanVersionId: plans[0].id,
                  sourceStepId: sourceAttempt.stepId,
                  sourceAttemptId: sourceAttempt.id,
                  sourceResultSha256: actionArgumentDigest(sourceAttempt.resultSummary),
                  sourceArgsSha256: sourceRecord.argsDigest,
                  dataClass: 'business_records',
                },
              ],
            });
            await expect(
              prisma.msaidiziTaskStep.update({
                where: { id: detail.id },
                data: { dependencyLineage: [] },
              }),
            ).rejects.toThrow('dependency lineage is immutable');
            expect(plans[0].steps.find((step) => step.id === oldDetail.id)).toMatchObject({
              status: 'SKIPPED',
              inputBindings: [binding],
              arguments: detailArguments,
            });
            expect(
              await prisma.msaidiziToolAttempt.count({ where: { stepId: oldDetail.id } }),
            ).toBe(0);
          }
          // The durable decision releases the reviewed detail step; neither the
          // completed checkpoint nor its provider usage may replay on restart.
          await boot(false, true, reasoning);
          await tick(task.id);
          await tick(task.id);
        }
        const done = (await api(operator).get(`/msaidizi/tasks/${task.id}`).expect(200)).body.data;
        expect(done).toMatchObject({
          status: revoked ? 'NEEDS_ATTENTION' : 'COMPLETED',
          attemptedToolCalls: 2,
          executedToolCalls: revoked ? 1 : 2,
          mutations: 0,
          activePlanVersion: replanning ? 2 : 1,
        });
        expect(done.toolAttempts).toHaveLength(2);
        if (reasoning)
          expect(done).toMatchObject({ modelTurns: 2, inputTokens: '240', outputTokens: '60' });
        expect(
          done.toolAttempts.find((attempt: { id: string }) => attempt.id === sourceAttempt.id),
        ).toEqual(sourceAttempt);
        const successor = await prisma.msaidiziToolAttempt.findFirstOrThrow({
          where: { taskId: task.id, stepId: detail.id },
        });
        expect(successor.resolvedInputProvenance).toMatchObject({
          taskId: task.id,
          stepId: detail.id,
          attemptId: successor.id,
          bindings: [
            {
              targetPath: binding.targetPath,
              trustLevel: planInputReplan ? 'REVIEWED_REFERENCE' : 'UNTRUSTED',
              instructionAuthority: false,
              source: planInputReplan
                ? { kind: 'PLAN_INPUT', sourcePath: '/page', planVersionId: detail.planVersionId }
                : {
                    kind: 'DEPENDENCY_OUTPUT',
                    attemptId: sourceAttempt.id,
                    resultSha256: sourceAttempt.resultSummary.responseSha256,
                    ...(replanning
                      ? {
                          sourcePlanVersionId: (
                            detail.dependencyLineage as Array<{ sourcePlanVersionId: string }>
                          )[0].sourcePlanVersionId,
                          lineageVersion: 1,
                          sourceResultSha256: actionArgumentDigest(sourceAttempt.resultSummary),
                        }
                      : {}),
                  },
            },
          ],
        });
        if (revoked) {
          expect(successor).toMatchObject({
            status: 'REJECTED',
            rejectionReason: 'MANDATE_CAPABILITY_DENIED',
          });
          expect(successor.resultSummary).toBeNull();
        } else {
          expect(successor).toMatchObject({
            status: 'SUCCEEDED',
            resultSummary: {
              ok: true,
              httpStatus: 200,
              observation: {
                value: {
                  data: planInputReplan
                    ? { data: expect.arrayContaining([expect.objectContaining({ companyId })]) }
                    : { id: selectedId, companyId },
                },
              },
            },
          });
        }
        const audit = await prisma.auditLog.findFirstOrThrow({
          where: {
            taskId: task.id,
            stepId: detail.id,
            action: revoked ? 'MSAIDIZI_ERP_ACTION_REJECTED' : 'MSAIDIZI_ERP_ACTION_SUCCEEDED',
          },
        });
        expect(audit).toMatchObject({
          principalType: 'SERVICE',
          principalId: task.principalId,
          mandateId: mandate.id,
          initiatedByUserId: operator.id,
          companyId,
          channel: 'AGENT',
        });
        await tick(task.id);
        expect(await prisma.msaidiziToolAttempt.count({ where: { taskId: task.id } })).toBe(2);
        expect(await prisma.msaidiziTask.count({ where: { scheduleId: routine.id } })).toBe(1);
        if (reasoning) {
          const turns = await prisma.msaidiziReasoningTurn.findMany({
            where: { taskId: task.id },
            orderBy: { createdAt: 'asc' },
          });
          expect(turns).toHaveLength(2);
          expect(turns[0].id).toBe(checkpointId);
          for (const [index, turn] of turns.entries())
            expect(turn).toMatchObject({
              status: 'SUCCEEDED',
              decision: replanning && index === 0 ? 'REPLAN' : 'CONTINUE',
              inputTokens: 120n,
              outputTokens: 30n,
            });
          expect(Number(done.modelCostUsd)).toBeCloseTo(
            turns.reduce((sum, turn) => sum + turn.actualCostUsd.toNumber(), 0),
            6,
          );
          await boot(false, true, reasoning);
          await tick(task.id);
          expect(
            await prisma.msaidiziReasoningTurn.findMany({
              where: { taskId: task.id },
              orderBy: { createdAt: 'asc' },
            }),
          ).toEqual(turns);
          const restored = (await api(operator).get(`/msaidizi/tasks/${task.id}`).expect(200)).body
            .data;
          expect(restored).toMatchObject({
            status: 'COMPLETED',
            modelTurns: 2,
            inputTokens: done.inputTokens,
            outputTokens: done.outputTokens,
            modelCostUsd: done.modelCostUsd,
          });
        }
      } finally {
        const current = (await api(operator).get(`/msaidizi/routines/${routine.id}`).expect(200))
          .body.data;
        if (current.status === 'ACTIVE')
          await api(operator)
            .post(`/msaidizi/routines/${routine.id}/pause`, { expectedVersion: current.version })
            .expect(200);
        if (!revoked)
          await api(operator)
            .post(`/msaidizi/mandates/${mandate.id}/revoke`, { expectedVersion: mandate.version })
            .expect(200);
      }
    },
    180_000,
  );
});
