/**
 * Chat -> real authenticated loopback -> expense -> exact red approval -> GL/AP
 * and audit. Only the cloud model is scripted; no business service, permission,
 * company-scope, conversation, approval store or invoker is replaced.
 * Run only in a dedicated disposable database (see benchmarks/README.md).
 */
import { INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AccessLevel, RoleScope } from '@prisma/client';
import * as argon2 from 'argon2';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { ALL_PERMISSIONS } from '../../database/seeds/permission-matrix';
import { PrismaService } from '../src/prisma/prisma.service';
import { ManifestProvider } from '../src/modules/msaidizi/manifest.provider';
import { ModelClient, ModelRequest, ModelResponse } from '../src/modules/msaidizi/model-client';
import { AskResult } from '../src/modules/msaidizi/dto/ask.dto';
import { createE2eApp } from './e2e-app';
import { MsaidiziConversationsService } from '../src/modules/msaidizi/conversations.service';
import { MsaidiziConfig } from '../src/modules/msaidizi/msaidizi.config';
import { EncryptionService, PersistenceSecretGuard } from '../src/common/services';

class ScriptedModel extends ModelClient {
  script: ModelResponse[] = [];
  seen: ModelRequest[] = [];
  async createMessage(input: ModelRequest): Promise<ModelResponse> {
    this.seen.push(input);
    const response = this.script.shift();
    if (!response) throw new Error('Unexpected extra model turn in the chat workflow');
    return response;
  }
  action(name: string, input: Record<string, unknown>, answer = true) {
    this.script = [
      { content: [{ type: 'tool_use', id: randomUUID(), name, input }], stopReason: 'tool_use' },
    ];
    if (answer)
      this.script.push({
        content: [{ type: 'text', text: 'The requested operation completed.' }],
        stopReason: 'end_turn',
      });
    this.seen = [];
  }
}

const benchmarkCases = [
  ['How many customers do we have on file?', 'CustomersController.findAll'],
  ['List our suppliers.', 'SuppliersController.findAll'],
  ['Who owes us money?', 'ReceivablesController.findAll'],
  ['What do we owe our suppliers?', 'PayablesController.findAll'],
  ['What did we spend money on recently?', 'ExpensesController.findAll'],
  ['Which items are running low and need reordering?', 'InventoryBalancesController.findAll'],
  ['Are there any bills we have not settled yet?', 'PayablesController.findAll'],
] as const;

const describeDisposable =
  process.env.MSAIDIZI_CHAT_DISPOSABLE_DB === '1' ? describe : describe.skip;
describeDisposable('Msaidizi chat business workflow (real HTTP and PostgreSQL)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let config: ConfigService;
  let companyId: string;
  let otherCompanyId: string;
  let categoryId: string;
  let userId: string;
  let token: string;
  let readerToken: string;
  let expenseAccountId: string;
  let payableAccountId: string;
  const model = new ScriptedModel();
  const tools = new Map<string, string>();
  const suffix = randomUUID().slice(0, 8);
  const description = `Chat workflow expense ${suffix}`;
  const password = 'DisposableChatProof123!';

  beforeAll(async () => {
    const target = new URL(process.env.DATABASE_URL!);
    if (
      !['localhost', '127.0.0.1'].includes(target.hostname) ||
      !/^\/msaidizi_chat_proof(?:_[a-z0-9]+)?$/.test(target.pathname)
    ) {
      throw new Error('This fixture requires a local database named msaidizi_chat_proof[_suffix].');
    }
    app = await createE2eApp({
      useProductionPipeline: true,
      modelClient: model,
      logLevels: ['error'],
    });
    await app.listen(0, '127.0.0.1');
    prisma = app.get(PrismaService);
    config = app.get(ConfigService);
    config.set('MSAIDIZI_ENABLED', 'true');
    config.set('MSAIDIZI_WRITE_MODE', 'red');
    config.set('MSAIDIZI_TOOL_SEARCH', 'true');
    config.set('MSAIDIZI_LOOPBACK_URL', `${await app.getUrl()}/api/v1`);

    const manifest = app.get(ManifestProvider).capabilities();
    const ids = new Set<string>([
      ...benchmarkCases.map((entry) => entry[1]),
      'ExpensesController.create',
      'ExpensesController.submit',
      'ExpensesController.approve',
    ]);
    const selected = manifest.filter((entry) => ids.has(entry.id));
    expect(selected).toHaveLength(ids.size);
    const permissionCodes = new Set([
      'msaidizi.use',
      ...selected.flatMap((entry) => entry.permissions),
    ]);
    const permissions = await Promise.all(
      ALL_PERMISSIONS.filter((entry) => permissionCodes.has(entry.code)).map((entry) =>
        prisma.permission.upsert({ where: { code: entry.code }, update: {}, create: entry }),
      ),
    );
    expect(permissions).toHaveLength(permissionCodes.size);
    expect(permissions.every((entry) => !entry.isGroupControl)).toBe(true);
    const group = await prisma.group.create({
      data: { code: `CG${suffix}`, name: `Chat proof ${suffix}` },
    });
    const company = await prisma.company.create({
      data: { groupId: group.id, code: `CA${suffix}`, name: `Chat proof A ${suffix}` },
    });
    companyId = company.id;
    otherCompanyId = (
      await prisma.company.create({
        data: { groupId: group.id, code: `CB${suffix}`, name: `Chat proof B ${suffix}` },
      })
    ).id;
    const passwordHash = await argon2.hash(password);
    async function actor(name: string, codes: Set<string>) {
      const role = await prisma.role.create({
        data: {
          name: `${name}-${suffix}`,
          displayName: name,
          scope: RoleScope.COMPANY,
          rolePermissions: {
            create: permissions
              .filter((entry) => codes.has(entry.code))
              .map((entry) => ({ permissionId: entry.id })),
          },
        },
      });
      const user = await prisma.user.create({
        data: {
          email: `${name}-${suffix}@itemba.invalid`,
          passwordHash,
          fullName: name,
          companyId,
          userRoles: { create: { roleId: role.id } },
          companyAccess: { create: { companyId, accessLevel: AccessLevel.MANAGE } },
        },
      });
      const login = await request(app.getHttpServer())
        .post('/api/v1/auth/login')
        .send({ email: user.email, password })
        .expect(200);
      return { user, token: login.body.data.accessToken as string };
    }
    const operator = await actor('chat-operator', permissionCodes);
    userId = operator.user.id;
    token = operator.token;
    readerToken = (await actor('chat-reader', new Set(['msaidizi.use', 'expenses.view']))).token;
    const caps = await request(app.getHttpServer())
      .get('/api/v1/msaidizi/capabilities')
      .auth(token, { type: 'bearer' })
      .expect(200);
    for (const entry of caps.body.data.capabilities) tools.set(entry.capabilityId, entry.name);
    for (const id of ids) expect(tools.has(id)).toBe(true);
    const expenseAccount = await prisma.chartOfAccount.create({
      data: {
        companyId,
        accountCode: '5000',
        accountName: 'Expense',
        accountType: 'EXPENSE',
        accountSubType: 'general_expense',
      },
    });
    const payableAccount = await prisma.chartOfAccount.create({
      data: {
        companyId,
        accountCode: '2000',
        accountName: 'Accounts payable',
        accountType: 'LIABILITY',
        accountSubType: 'ap_control',
      },
    });
    expenseAccountId = expenseAccount.id;
    payableAccountId = payableAccount.id;
    categoryId = (
      await prisma.expenseCategory.create({
        data: { companyId, name: 'Transport', linkedAccountId: expenseAccountId },
      })
    ).id;
    const fiscalYear = await prisma.fiscalYear.create({
      data: {
        companyId,
        name: '2026',
        startDate: new Date('2026-01-01'),
        endDate: new Date('2026-12-31T23:59:59Z'),
      },
    });
    await prisma.accountingPeriod.create({
      data: {
        companyId,
        fiscalYearId: fiscalYear.id,
        name: 'September',
        startDate: new Date('2026-09-01'),
        endDate: new Date('2026-09-30T23:59:59Z'),
      },
    });
  }, 180_000);

  afterAll(async () => {
    if (app) await app.close();
  });

  async function ask(
    message: string,
    body: Record<string, unknown> = {},
    bearer = token,
  ): Promise<AskResult> {
    const response = await request(app.getHttpServer())
      .post('/api/v1/msaidizi/ask')
      .auth(bearer, { type: 'bearer' })
      .send({ message, ...body })
      .expect(201);
    return response.body.data;
  }
  function expectDispatch(result: AskResult, id: string) {
    expect(result.reason).toBe('end_turn');
    expect(result.events.filter((entry) => entry.type === 'tool_call')).toEqual([
      expect.objectContaining({ capabilityId: id }),
    ]);
    expect(result.events.filter((entry) => entry.type === 'tool_result')).toEqual([
      expect.objectContaining({ ok: true, status: expect.any(Number) }),
    ]);
    expect(model.script).toHaveLength(0);
  }
  const payload = () => ({
    companyId,
    expenseCategoryId: categoryId,
    amount: 12500,
    expenseDate: '2026-09-04',
    description,
  });

  it.each(benchmarkCases)(
    '%s reaches its resident endpoint through real guards',
    async (prompt, id) => {
      model.action(tools.get(id)!, { query: { companyId } });
      const result = await ask(prompt);
      expectDispatch(result, id);
      expect(model.seen).toHaveLength(2);
      const resident = model.seen[0].tools.find((tool) => tool.name === tools.get(id));
      expect(resident).toBeDefined();
      expect(resident).not.toHaveProperty('defer_loading', true);
      if (id === 'ExpensesController.findAll') {
        expect(model.seen[0].toolChoice).toMatchObject({ type: 'tool', name: tools.get(id) });
        expect(model.seen[1].toolChoice).toEqual({ type: 'none' });
      }
    },
  );

  it('refuses writes in read-only mode, without permission, and outside company scope', async () => {
    const count = await prisma.expense.count();
    config.set('MSAIDIZI_WRITE_MODE', 'read-only');
    model.action(tools.get('ExpensesController.create')!, { body: payload() });
    try {
      const result = await ask('Record this transport expense.');
      expect(result.events.filter((event) => event.type === 'tool_call')).toHaveLength(0);
    } finally {
      config.set('MSAIDIZI_WRITE_MODE', 'red');
    }
    model.action(tools.get('ExpensesController.create')!, { body: payload() });
    const denied = await ask('Record this transport expense.', {}, readerToken);
    expect(denied.events.filter((event) => event.type === 'tool_call')).toHaveLength(0);
    model.action(tools.get('ExpensesController.create')!, {
      body: { ...payload(), companyId: otherCompanyId },
    });
    const outside = await ask('Record this transport expense in company B.');
    expect(outside.events).toContainEqual(
      expect.objectContaining({ type: 'tool_result', ok: false, status: 403 }),
    );
    expect(await prisma.expense.count()).toBe(count);
  });

  it.each(['Africa/Nairobi', 'UTC', 'America/Los_Angeles'])(
    'sweeps only expired state with database timezone %s',
    async (timezone) => {
      await prisma.$transaction(async (tx) => {
        await tx.$executeRaw`SELECT set_config('TimeZone', ${timezone}, true)`;
        const now = Date.now();
        const halfHour = 30 * 60 * 1000;
        const future = new Date(now + halfHour);
        const past = new Date(now - halfHour);
        const grace = app.get(MsaidiziConfig).deletedGraceHours * 3_600_000;
        const encryption = app.get(EncryptionService);
        const base = {
          userId,
          companyId,
          expiresAt: future,
          resumeExpiresAt: future,
          resumeState: encryption.encrypt('[]'),
          resumeBytes: 2,
        };
        async function conversation(
          overrides: { expiresAt?: Date; resumeExpiresAt?: Date; deletedAt?: Date } = {},
        ) {
          return tx.msaidiziConversation.create({
            data: { ...base, ...overrides, agentSessionId: `ms_${randomUUID().replace(/-/g, '')}` },
          });
        }
        const live = await conversation();
        const staleResume = await conversation({ resumeExpiresAt: past });
        const expired = await conversation({ expiresAt: past });
        const recentlyDeleted = await conversation({ deletedAt: new Date(now - grace + halfHour) });
        const oldDeleted = await conversation({ deletedAt: new Date(now - grace - halfHour) });
        const grant = {
          conversationId: live.id,
          userId,
          turnSequence: 1,
          toolName: 'Expenses_approve',
          argsDigest: 'a'.repeat(64),
        };
        const validGrant = await tx.msaidiziApprovalGrant.create({
          data: { ...grant, id: `grt_${randomUUID().replace(/-/g, '')}`, expiresAt: future },
        });
        const expiredGrant = await tx.msaidiziApprovalGrant.create({
          data: { ...grant, id: `grt_${randomUUID().replace(/-/g, '')}`, expiresAt: past },
        });
        // Bind the real service to this real transaction so SET LOCAL applies to
        // all three statements; no fake SQL evaluator or mocked clock is involved.
        const store = new MsaidiziConversationsService(
          tx as PrismaService,
          app.get(MsaidiziConfig),
          encryption,
          app.get(PersistenceSecretGuard),
        );
        await store.sweep();
        expect(
          (await tx.msaidiziConversation.findFirstOrThrow({ where: { id: live.id } })).resumeState,
        ).toBe(base.resumeState);
        expect(
          (await tx.msaidiziConversation.findFirstOrThrow({ where: { id: staleResume.id } }))
            .resumeState,
        ).toBeNull();
        expect(await tx.msaidiziConversation.count({ where: { id: expired.id } })).toBe(0);
        expect(
          await tx.msaidiziConversation.count({
            where: { id: recentlyDeleted.id, deletedAt: { not: null } },
          }),
        ).toBe(1);
        expect(
          await tx.msaidiziConversation.count({
            where: { id: oldDeleted.id, deletedAt: { not: null } },
          }),
        ).toBe(0);
        expect(await tx.msaidiziApprovalGrant.count({ where: { id: validGrant.id } })).toBe(1);
        expect(await tx.msaidiziApprovalGrant.count({ where: { id: expiredGrant.id } })).toBe(0);
      });
    },
  );

  it('creates a draft, confirms submission and approval, posts once and attributes the audit', async () => {
    model.action(tools.get('ExpensesController.create')!, { body: payload() });
    const created = await ask('Record a TZS 12,500 transport expense dated 4 September 2026.');
    expectDispatch(created, 'ExpensesController.create');
    const expense = await prisma.expense.findFirstOrThrow({ where: { companyId, description } });
    expect(expense.status).toBe('DRAFT');
    expect(Number(expense.amount)).toBe(12500);
    expect(expense.createdById).toBe(userId);
    expect(expense.journalEntryId).toBeNull();
    const sessions = [created.sessionId];
    let approvalResult: AskResult | undefined;
    let approvalGrant = '';
    for (const [action, before, after] of [
      ['submit', 'DRAFT', 'PENDING_APPROVAL'],
      ['approve', 'PENDING_APPROVAL', 'APPROVED'],
    ] as const) {
      const id = `ExpensesController.${action}`;
      const input = { path: { id: expense.id } };
      model.action(tools.get(id)!, input, false);
      const proposal = await ask(`${action} expense ${expense.expenseNumber}.`);
      expect(proposal.reason).toBe('awaiting_confirmation');
      expect(proposal.events.filter((entry) => entry.type === 'tool_call')).toHaveLength(0);
      expect((await prisma.expense.findUniqueOrThrow({ where: { id: expense.id } })).status).toBe(
        before,
      );
      expect(await prisma.journalEntry.count({ where: { referenceId: expense.id } })).toBe(0);
      const grant = proposal.events.find((entry) => entry.type === 'confirmation_required');
      if (grant?.type !== 'confirmation_required') throw new Error('Missing exact-action approval');
      model.action(tools.get(id)!, input);
      const approved = await ask('Confirm this exact action.', {
        conversationId: proposal.conversationId,
        sequence: proposal.sequence,
        confirmed: [grant.grantId],
      });
      expectDispatch(approved, id);
      expect((await prisma.expense.findUniqueOrThrow({ where: { id: expense.id } })).status).toBe(
        after,
      );
      sessions.push(approved.sessionId);
      approvalResult = approved;
      approvalGrant = grant.grantId;
    }
    const journals = await prisma.journalEntry.findMany({
      where: { referenceId: expense.id },
      include: { lines: true },
    });
    expect(journals).toHaveLength(1);
    expect(journals[0].status).toBe('POSTED');
    expect(
      journals[0].lines.map((line) => ({
        accountId: line.accountId,
        debit: Number(line.debit),
        credit: Number(line.credit),
      })),
    ).toEqual(
      expect.arrayContaining([
        { accountId: expenseAccountId, debit: 12500, credit: 0 },
        { accountId: payableAccountId, debit: 0, credit: 12500 },
      ]),
    );
    expect(journals[0].lines).toHaveLength(2);
    const payables = await prisma.payable.findMany({
      where: { sourceType: 'Expense', sourceId: expense.id },
    });
    expect(payables).toHaveLength(1);
    expect(Number(payables[0].outstandingAmount)).toBe(12500);

    // A used approval in a later turn must not reach the endpoint a second time.
    model.action(tools.get('ExpensesController.approve')!, { path: { id: expense.id } }, false);
    const replay = await ask('Approve it again.', {
      conversationId: approvalResult!.conversationId,
      sequence: approvalResult!.sequence,
      confirmed: [approvalGrant],
    });
    expect(replay.reason).toBe('awaiting_confirmation');
    expect(replay.events.filter((entry) => entry.type === 'tool_call')).toHaveLength(0);
    expect(await prisma.journalEntry.count({ where: { referenceId: expense.id } })).toBe(1);
    expect(
      await prisma.payable.count({ where: { sourceType: 'Expense', sourceId: expense.id } }),
    ).toBe(1);
    const audits = await prisma.auditLog.findMany({
      where: {
        entityId: expense.id,
        action: { in: ['EXPENSE_CREATE', 'EXPENSE_SUBMIT', 'EXPENSE_APPROVE'] },
      },
      orderBy: { createdAt: 'asc' },
    });
    expect(audits.map((entry) => entry.action)).toEqual([
      'EXPENSE_CREATE',
      'EXPENSE_SUBMIT',
      'EXPENSE_APPROVE',
    ]);
    audits.forEach((entry, index) =>
      expect(entry).toMatchObject({
        userId,
        companyId,
        channel: 'AGENT',
        agentSessionId: sessions[index],
      }),
    );

    // Read back the created business record through the measured spending path,
    // and check what the model actually received, not its scripted prose.
    model.action(tools.get('ExpensesController.findAll')!, { query: { companyId } });
    const spending = await ask('What did we spend money on recently?');
    expectDispatch(spending, 'ExpensesController.findAll');
    expect(model.seen).toHaveLength(2);
    const responseMessages = model.seen[1].messages.filter(
      (entry) => entry.role === 'user' && Array.isArray(entry.content),
    );
    expect(JSON.stringify(responseMessages)).toContain(description);
    expect(JSON.stringify(responseMessages)).toContain(expense.id);
  });
});
