import { ServiceUnavailableException } from '@nestjs/common';
import {
  MsaidiziEffect,
  MsaidiziExecutionTarget,
  MsaidiziTaskMode,
  MsaidiziTaskStatus,
} from '@prisma/client';
import { Capability } from '../../common/capabilities/capability-manifest';
import { createHash } from 'node:crypto';
import { AuthUser } from '../../common/decorators/current-user.decorator';
import { PrismaService } from '../../prisma/prisma.service';
import { ManifestProvider } from '../msaidizi/manifest.provider';
import { MsaidiziConfig } from '../msaidizi/msaidizi.config';
import { AutonomyConfig } from './autonomy.config';
import { MsaidiziPlanStepDto } from './dto/msaidizi-task.dto';
import { MsaidiziTasksService } from './msaidizi-tasks.service';
import { msaidiziProposalDigest } from './msaidizi-proposal-digest';
import {
  proposalDataClass,
  UPDATE_CANDIDATE_GENERATION_CAPABILITY_VERSION,
  UPDATE_CANDIDATE_PROPOSAL_CAPABILITY,
} from '../msaidizi-updates/update-candidate-proposal.port';

const USER: AuthUser = {
  id: 'user-1',
  email: 'asha@itemba.local',
  roles: ['manager'],
  roleScopes: ['COMPANY'],
  permissions: ['msaidizi.use'],
  companyId: 'company-1',
  companyAccess: [],
};

function config(overrides: Partial<AutonomyConfig> = {}) {
  return {
    enabled: true,
    hostExecutionEnabled: false,
    autopilotEnabled: false,
    principalKey: 'global-msaidizi',
    principalGrants: ['*'],
    budgetCeilings: {
      maxWallTimeSeconds: 7_200,
      maxModelTurns: 200,
      maxAttemptedToolCalls: 500,
      maxMutations: 100,
      maxLocalBytes: 5_368_709_120n,
      maxExternalEgressBytes: 262_144_000n,
      maxModelCostUsd: 20,
    },
    ...overrides,
  } as AutonomyConfig;
}

const DEFAULT_CAPABILITY: Capability = {
  id: 'ExpensesController.findAll',
  controller: 'ExpensesController',
  handler: 'findAll',
  verb: 'GET',
  path: 'expenses',
  permissions: ['msaidizi.use'],
  anyPermissions: [],
  roles: [],
  apiScopes: [],
  guard: 'permission',
  tier: 'green',
  tierReason: 'verb-default',
  params: { path: [], query: [], freeFormQuery: true, hasBody: false },
  agentExcluded: false,
};

function createService(
  prisma: unknown,
  autonomy: AutonomyConfig = config(),
  capabilities: Capability[] = [DEFAULT_CAPABILITY],
  releaseQualified = true,
  proposalUsage: {
    inspectConsumable: jest.Mock;
    consume: jest.Mock;
  } = {
    inspectConsumable: jest.fn(),
    consume: jest.fn(),
  },
) {
  const manifest = new ManifestProvider();
  manifest.setForTesting(capabilities);
  return new MsaidiziTasksService(
    prisma as PrismaService,
    autonomy,
    manifest,
    {
      allowedTiers: ['green', 'amber', 'red'],
    } as MsaidiziConfig,
    {
      report: () => ({
        releaseGate: {
          status: releaseQualified ? 'passed' : 'failed',
          blockers: releaseQualified ? [] : [{ code: 'eligible_operations_unverified', count: 1 }],
        },
      }),
    } as never,
    proposalUsage as never,
  );
}

function step(overrides: Record<string, unknown> = {}) {
  return {
    key: 'read-expenses',
    name: 'Read expenses',
    target: MsaidiziExecutionTarget.ERP,
    capability: 'ExpensesController.findAll',
    capabilityVersion: '1',
    arguments: { path: {}, query: {} },
    dependsOn: [],
    inputBindings: [],
    expectedEffect: MsaidiziEffect.READ,
    dataClass: 'internal',
    preconditions: {},
    budgets: {},
    stopConditions: {},
    idempotent: true,
    mutation: false,
    ...overrides,
  } as MsaidiziPlanStepDto;
}

function dynamicEmailArgumentsSchema() {
  return {
    type: 'object',
    properties: {
      endpointId: { type: 'string', pattern: '^[A-Za-z0-9._-]{1,80}$' },
      destinationAuthority: { const: 'mandate_dynamic_https_v1' },
      destinationUri: { type: 'string', minLength: 1, maxLength: 2048 },
      serverCertificateSha256: { type: 'string', pattern: '^[a-f0-9]{64}$' },
      vaultReferenceId: { type: 'string', format: 'uuid' },
      vaultRecordSha256: { type: 'string', pattern: '^[a-f0-9]{64}$' },
      headerPrefix: { type: 'string', maxLength: 64 },
      to: {
        type: 'array',
        minItems: 1,
        maxItems: 100,
        items: { type: 'string', maxLength: 320 },
      },
      cc: { type: 'array', maxItems: 100, items: { type: 'string', maxLength: 320 } },
      subject: { type: 'string', minLength: 1, maxLength: 998 },
      text: { type: 'string', minLength: 1, maxLength: 100000 },
    },
    oneOf: [
      {
        not: {
          anyOf: [
            { required: ['destinationAuthority'] },
            { required: ['destinationUri'] },
            { required: ['serverCertificateSha256'] },
            { required: ['vaultReferenceId'] },
            { required: ['vaultRecordSha256'] },
            { required: ['headerPrefix'] },
          ],
        },
      },
      {
        required: [
          'destinationAuthority',
          'destinationUri',
          'serverCertificateSha256',
          'vaultReferenceId',
          'vaultRecordSha256',
          'headerPrefix',
        ],
      },
    ],
    required: ['endpointId', 'to', 'subject', 'text'],
    additionalProperties: false,
  };
}

function browserFileUploadArgumentsSchema() {
  return {
    type: 'object',
    properties: {
      originId: { type: 'string', pattern: '^[A-Za-z0-9._-]{1,80}$' },
      originSha256: { type: 'string', pattern: '^[a-f0-9]{64}$' },
      processId: { type: 'integer', minimum: 1 },
      automationId: { type: 'string', minLength: 1, maxLength: 512 },
      secretReferenceId: { type: 'string', format: 'uuid' },
      uploadRootId: { type: 'string', pattern: '^[A-Za-z0-9._-]{1,80}$' },
    },
    required: [
      'originId',
      'originSha256',
      'processId',
      'automationId',
      'secretReferenceId',
      'uploadRootId',
    ],
    additionalProperties: false,
  };
}

function task(overrides: Record<string, unknown> = {}) {
  const now = new Date();
  return {
    id: 'task-1',
    principalId: 'principal-1',
    initiatedByUserId: USER.id,
    companyId: USER.companyId,
    mandateId: null,
    scheduleId: null,
    idempotencyKey: null,
    mode: MsaidiziTaskMode.COLLABORATIVE,
    title: 'Review expenses',
    objective: 'Review expenses',
    status: MsaidiziTaskStatus.READY,
    activePlanVersion: 1,
    stateVersion: 0,
    hostExecutionAllowed: false,
    maxWallTimeSeconds: 7_200,
    maxModelTurns: 200,
    maxAttemptedToolCalls: 500,
    maxMutations: 100,
    maxLocalBytes: 5_368_709_120n,
    maxExternalEgressBytes: 262_144_000n,
    maxModelCostUsd: 20,
    modelTurns: 0,
    attemptedToolCalls: 0,
    executedToolCalls: 0,
    mutations: 0,
    inputTokens: 0n,
    outputTokens: 0n,
    modelCostUsd: 0,
    bytesRead: 0n,
    bytesWritten: 0n,
    externalEgressBytes: 0n,
    consumedWallTimeMs: 0n,
    wallTimeCheckpointAt: null,
    statusDetail: null,
    failureCode: null,
    queuedAt: null,
    startedAt: null,
    lastCheckpointAt: null,
    pauseRequestedAt: null,
    cancelRequestedAt: null,
    endedAt: null,
    createdAt: now,
    updatedAt: now,
    principal: { status: 'ACTIVE' },
    mandate: null,
    schedule: null,
    toolAttempts: [],
    artifacts: [],
    deviceLeases: [],
    hostActions: [],
    planVersions: [
      {
        id: 'plan-1',
        taskId: 'task-1',
        version: 1,
        createdByUserId: USER.id,
        summary: 'Review expenses',
        objective: 'Review expenses',
        inputs: {},
        stopConditions: {},
        budgetSnapshot: {},
        planDigest: 'digest',
        createdAt: now,
        steps: [
          {
            id: 'step-1',
            target: MsaidiziExecutionTarget.ERP,
            sequence: 1,
          },
        ],
      },
    ],
    ...overrides,
  };
}

function databaseUser(
  overrides: Partial<{
    status: string;
    scopes: string[];
    permissions: string[];
    companyId: string | null;
    companyAccess: Array<{ companyId: string; accessLevel: string }>;
  }> = {},
) {
  const scopes = overrides.scopes ?? ['COMPANY'];
  const permissions = overrides.permissions ?? ['msaidizi.use'];
  return {
    id: USER.id,
    email: USER.email,
    fullName: 'Asha',
    status: overrides.status ?? 'ACTIVE',
    companyId: overrides.companyId === undefined ? USER.companyId : overrides.companyId,
    companyAccess: overrides.companyAccess ?? [],
    userRoles: scopes.map((scope, index) => ({
      role: {
        name: `role-${index + 1}`,
        scope,
        rolePermissions: (index === 0 ? permissions : []).map((code) => ({
          permission: { code },
        })),
      },
    })),
  };
}

describe('MsaidiziTasksService safety boundaries', () => {
  it('uses the same lossless opaque secret-reference mapping for create and replan step rows', () => {
    const service = createService({});
    const secretReferenceId = '10000000-0000-4000-8000-000000000010';
    const binding = {
      targetPath: '/secretReferenceId',
      source: {
        kind: 'SECRET_REFERENCE' as const,
        path: '',
        secretReferenceId,
        secretReferenceSha256: createHash('sha256').update(secretReferenceId, 'utf8').digest('hex'),
        scope: {
          capability: 'browser.secret.set',
          capabilityVersion: '1',
          dataClass: 'restricted',
          deviceId: '10000000-0000-4000-8000-000000000008',
        },
      },
      dataClass: 'restricted',
      expectedType: 'string' as const,
      expectedSchema: { type: 'string', minLength: 36, maxLength: 36 },
      transform: { name: 'IDENTITY' as const, version: '1' as const },
    };
    const mappedStep = step({
      key: 'browser-secret',
      target: MsaidiziExecutionTarget.HOST,
      capability: 'browser.secret.set',
      arguments: { secretReferenceId: null },
      dataClass: 'restricted',
      preconditions: { deviceId: binding.source.scope.deviceId },
      inputBindings: [binding],
    });
    const mapper = service as unknown as {
      stepRows: (
        taskId: string,
        planVersionId: string,
        steps: MsaidiziPlanStepDto[],
        createdAt: Date,
      ) => Array<{ inputBindings: unknown }>;
    };

    // plan() and replan() both use this mapper immediately before createMany.
    const rows = mapper.stepRows('task-1', 'plan-1', [mappedStep], new Date());

    expect(rows[0].inputBindings).toEqual([binding]);
    expect(JSON.stringify(rows[0].inputBindings)).toContain(secretReferenceId);
    expect(JSON.stringify(rows[0].inputBindings)).not.toContain('[REDACTED');
  });

  it('validates and preserves a reviewed browser.file.upload binding through task save', async () => {
    const createdSteps = jest.fn();
    const tx = {
      msaidiziTask: { create: jest.fn(), findFirst: jest.fn().mockResolvedValue(task()) },
      msaidiziPlanVersion: { create: jest.fn() },
      msaidiziTaskStep: { createMany: createdSteps },
      msaidiziTaskEvent: { create: jest.fn() },
    };
    const mandateId = 'f7f5fa86-33d7-4c6f-89aa-5f3bbffcb5ad';
    const deviceId = '10000000-0000-4000-8000-000000000008';
    const secretReferenceId = '10000000-0000-4000-8000-000000000010';
    const secretReferenceSha256 = createHash('sha256')
      .update(secretReferenceId, 'utf8')
      .digest('hex');
    const scope = {
      capability: 'browser.file.upload',
      capabilityVersion: '1.0.0',
      dataClass: 'Restricted',
      deviceId,
    };
    const binding = {
      targetPath: '/secretReferenceId',
      source: {
        kind: 'SECRET_REFERENCE' as const,
        path: '',
        secretReferenceId,
        secretReferenceSha256,
        scope,
      },
      dataClass: 'Restricted',
      expectedType: 'string' as const,
      expectedSchema: { type: 'string', minLength: 36, maxLength: 36 },
      transform: { name: 'IDENTITY' as const, version: '1' as const },
    };
    const prisma = {
      msaidiziTask: { findUnique: jest.fn().mockResolvedValue(null) },
      msaidiziPrincipal: {
        upsert: jest.fn().mockResolvedValue({ id: 'principal-1', status: 'ACTIVE' }),
      },
      msaidiziMandate: {
        findFirst: jest.fn().mockResolvedValue({
          id: mandateId,
          principalId: 'principal-1',
          createdByUserId: USER.id,
          status: 'ACTIVE',
          startsAt: null,
          expiresAt: null,
          deviceIds: [deviceId],
          capabilities: [
            {
              capability: 'browser.file.upload',
              version: '1.0.0',
              effects: [MsaidiziEffect.IRREVERSIBLE],
              dataClasses: ['Restricted'],
            },
          ],
          budgets: {},
        }),
      },
      msaidiziDevice: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: deviceId,
            capabilityManifest: {
              capabilities: [
                {
                  id: 'browser.file.upload',
                  version: '1.0.0',
                  dataClass: 'Restricted',
                  effect: 'Irreversible',
                  argumentsSchema: browserFileUploadArgumentsSchema(),
                },
              ],
            },
          },
        ]),
      },
      $transaction: jest.fn((work: (client: typeof tx) => unknown) => work(tx)),
    };
    const service = createService(
      prisma,
      config({ autopilotEnabled: true, hostExecutionEnabled: true }),
    );

    await service.plan(
      {
        title: 'Upload an approved file',
        objective: 'Use the reviewed scoped reference in the approved browser upload field',
        mode: MsaidiziTaskMode.AUTOPILOT,
        mandateId,
        inputs: {
          _msaidiziReferenceAuthority: [
            { id: secretReferenceId, sha256: secretReferenceSha256, scope },
          ],
        },
        stopConditions: {},
        steps: [
          step({
            key: 'upload-approved-file',
            name: 'Upload approved file',
            target: MsaidiziExecutionTarget.HOST,
            capability: 'browser.file.upload',
            capabilityVersion: '1.0.0',
            arguments: {
              originId: 'itemba',
              originSha256: 'a'.repeat(64),
              processId: 7,
              automationId: 'approved-upload-field',
              secretReferenceId: null,
              uploadRootId: 'exports',
            },
            inputBindings: [binding],
            expectedEffect: MsaidiziEffect.IRREVERSIBLE,
            dataClass: 'Restricted',
            preconditions: { deviceId, expectedPreStateSha256: 'c'.repeat(64) },
            recovery: { strategy: 'irreversible' },
            mutation: true,
          }),
        ],
      },
      USER,
    );

    expect(createdSteps.mock.calls[0][0].data[0]).toMatchObject({
      arguments: expect.objectContaining({ secretReferenceId: null }),
      inputBindings: [binding],
    });
    expect(JSON.stringify(createdSteps.mock.calls[0][0].data[0].inputBindings)).not.toContain(
      '[REDACTED',
    );
  });

  it('stops including group-level tasks when the caller loses GROUP scope', async () => {
    const findMany = jest.fn().mockResolvedValue([]);
    const prisma = {
      msaidiziTask: { findMany, count: jest.fn().mockResolvedValue(0) },
    };
    const service = createService(prisma);
    const groupUser: AuthUser = {
      ...USER,
      roleScopes: ['GROUP'],
      companyId: null,
      companyAccess: [{ companyId: 'company-1', accessLevel: 'READ' }],
    };

    await service.list({ page: 1, limit: 20 }, groupUser);
    await service.list({ page: 1, limit: 20 }, { ...groupUser, roleScopes: ['COMPANY'] });

    expect(findMany.mock.calls[0][0].where.OR).toEqual([
      { companyId: null },
      { companyId: { in: ['company-1'] } },
    ]);
    expect(findMany.mock.calls[1][0].where).toMatchObject({
      initiatedByUserId: USER.id,
      companyId: { in: ['company-1'] },
    });
    expect(findMany.mock.calls[1][0].where.OR).toBeUndefined();
  });

  it('reloads event authorization so GROUP-scope revocation denies the next poll', async () => {
    const userFindUnique = jest
      .fn()
      .mockResolvedValueOnce(databaseUser({ scopes: ['GROUP'], companyId: null }))
      .mockResolvedValueOnce(
        databaseUser({ scopes: ['COMPANY'], companyId: null, companyAccess: [] }),
      );
    const taskFindFirst = jest
      .fn()
      .mockImplementation(({ where }) =>
        Promise.resolve(Array.isArray(where.OR) ? { id: 'task-1' } : null),
      );
    const eventFindMany = jest
      .fn()
      .mockResolvedValue([{ cursor: 1n, type: 'task.created', payload: {} }]);
    const service = createService({
      user: { findUnique: userFindUnique },
      msaidiziTask: { findFirst: taskFindFirst },
      msaidiziTaskEvent: { findMany: eventFindMany },
    });
    const capturedGroupUser: AuthUser = {
      ...USER,
      roleScopes: ['GROUP'],
      companyId: null,
      companyAccess: [],
    };

    await expect(
      service.events('task-1', { after: '0', limit: 100 }, capturedGroupUser),
    ).resolves.toMatchObject({ data: [{ cursor: '1' }] });
    await expect(
      service.events('task-1', { after: '1', limit: 100 }, capturedGroupUser),
    ).rejects.toThrow('Msaidizi task not found');

    expect(userFindUnique).toHaveBeenCalledTimes(2);
    expect(eventFindMany).toHaveBeenCalledTimes(1);
    expect(taskFindFirst.mock.calls[1][0].where.OR).toBeUndefined();
  });

  it('reloads current company grants before every event poll', async () => {
    const userFindUnique = jest
      .fn()
      .mockResolvedValueOnce(
        databaseUser({
          companyId: null,
          companyAccess: [{ companyId: 'company-1', accessLevel: 'READ' }],
        }),
      )
      .mockResolvedValueOnce(databaseUser({ companyId: null, companyAccess: [] }));
    const taskFindFirst = jest
      .fn()
      .mockImplementation(({ where }) =>
        Promise.resolve(where.companyId?.in?.includes('company-1') ? { id: 'task-1' } : null),
      );
    const eventFindMany = jest
      .fn()
      .mockResolvedValue([{ cursor: 1n, type: 'task.created', payload: {} }]);
    const service = createService({
      user: { findUnique: userFindUnique },
      msaidiziTask: { findFirst: taskFindFirst },
      msaidiziTaskEvent: { findMany: eventFindMany },
    });

    await expect(service.events('task-1', { after: '0', limit: 100 }, USER)).resolves.toMatchObject(
      { data: [{ cursor: '1' }] },
    );
    await expect(service.events('task-1', { after: '1', limit: 100 }, USER)).rejects.toThrow(
      'Msaidizi task not found',
    );

    expect(userFindUnique).toHaveBeenCalledTimes(2);
    expect(eventFindMany).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['inactive account', databaseUser({ status: 'INACTIVE' })],
    ['revoked msaidizi.use', databaseUser({ permissions: [] })],
  ])('denies event polling for a live %s', async (_reason, currentUser) => {
    const taskFindFirst = jest.fn();
    const eventFindMany = jest.fn();
    const service = createService({
      user: { findUnique: jest.fn().mockResolvedValue(currentUser) },
      msaidiziTask: { findFirst: taskFindFirst },
      msaidiziTaskEvent: { findMany: eventFindMany },
    });

    await expect(service.events('task-1', { after: '0', limit: 100 }, USER)).rejects.toThrow(
      'Msaidizi event access is no longer authorized',
    );
    expect(taskFindFirst).not.toHaveBeenCalled();
    expect(eventFindMany).not.toHaveBeenCalled();
  });

  it('does not touch persistence when the feature is off', async () => {
    const prisma = { msaidiziTask: { findUnique: jest.fn() } };
    const service = createService(prisma, config({ enabled: false }));

    await expect(
      service.plan(
        {
          title: 'Review expenses',
          objective: 'Review expenses',
          mode: MsaidiziTaskMode.COLLABORATIVE,
          inputs: {},
          stopConditions: {},
          steps: [step()],
        },
        USER,
      ),
    ).rejects.toBeInstanceOf(ServiceUnavailableException);
    expect(prisma.msaidiziTask.findUnique).not.toHaveBeenCalled();
  });

  it('does not persist or queue durable work while signed CRUD coverage is incomplete', async () => {
    const prisma = { msaidiziTask: { findUnique: jest.fn() } };
    const service = createService(prisma, config(), [DEFAULT_CAPABILITY], false);

    await expect(
      service.plan(
        {
          title: 'Review expenses',
          objective: 'Review expenses',
          mode: MsaidiziTaskMode.COLLABORATIVE,
          inputs: {},
          stopConditions: {},
          steps: [step()],
        },
        USER,
      ),
    ).rejects.toMatchObject({
      response: expect.objectContaining({ code: 'MSAIDIZI_CRUD_RELEASE_GATE_BLOCKED' }),
    });
    expect(prisma.msaidiziTask.findUnique).not.toHaveBeenCalled();
  });

  it('persists clamped budgets and redacts credentials from non-executable plan metadata', async () => {
    const createdTask = jest.fn();
    const createdPlan = jest.fn();
    const createdSteps = jest.fn();
    const tx = {
      msaidiziTask: { create: createdTask, findFirst: jest.fn().mockResolvedValue(task()) },
      msaidiziPlanVersion: { create: createdPlan },
      msaidiziTaskStep: { createMany: createdSteps },
      msaidiziTaskEvent: { create: jest.fn() },
    };
    const prisma = {
      msaidiziTask: { findUnique: jest.fn().mockResolvedValue(null) },
      msaidiziPrincipal: {
        upsert: jest.fn().mockResolvedValue({ id: 'principal-1', status: 'ACTIVE' }),
      },
      $transaction: jest.fn((work: (client: typeof tx) => unknown) => work(tx)),
    };
    const service = createService(prisma);

    await service.plan(
      {
        title: 'Review expenses password=hunter2',
        objective: 'Review expenses using apiKey=sk-proj-abcdefghijklmnopqrstuv',
        mode: MsaidiziTaskMode.COLLABORATIVE,
        inputs: { note: 'password=hunter2' },
        stopConditions: {},
        budgets: {
          maxModelTurns: 9_999,
          maxMutations: 5,
          maxLocalBytes: 9_999_999_999,
        },
        steps: [step({ arguments: { path: {}, query: { idempotencyKey: 'expense-report-123' } } })],
      },
      USER,
    );

    expect(createdTask.mock.calls[0][0].data).toMatchObject({
      maxModelTurns: 200,
      maxMutations: 5,
      maxLocalBytes: 5_368_709_120n,
      consumedWallTimeMs: 0n,
      wallTimeCheckpointAt: null,
    });
    expect(createdTask.mock.calls[0][0].data.objective).not.toContain('sk-proj-');
    expect(JSON.stringify(createdPlan.mock.calls[0][0].data.inputs)).not.toContain('hunter2');
    expect(createdTask.mock.calls[0][0].data.createdAt).toBeInstanceOf(Date);
    expect(createdSteps.mock.calls[0][0].data[0].createdAt).toBe(
      createdTask.mock.calls[0][0].data.createdAt,
    );
    expect(createdSteps.mock.calls[0][0].data[0].arguments).toEqual({
      path: {},
      query: { idempotencyKey: 'expense-report-123' },
    });
  });

  it('persists an explicitly mandated dynamic HTTPS action without DLP rewriting its exact authority', async () => {
    const createdSteps = jest.fn();
    const tx = {
      msaidiziTask: { create: jest.fn(), findFirst: jest.fn().mockResolvedValue(task()) },
      msaidiziPlanVersion: { create: jest.fn() },
      msaidiziTaskStep: { createMany: createdSteps },
      msaidiziTaskEvent: { create: jest.fn() },
    };
    const mandateId = 'f7f5fa86-33d7-4c6f-89aa-5f3bbffcb5ad';
    const deviceId = '10000000-0000-4000-8000-000000000008';
    const dynamicArguments = {
      destinationAuthority: 'mandate_dynamic_https_v1',
      endpointId: 'dynamic-mail-v1',
      destinationUri: 'https://mail-api.example.net/v1/messages',
      serverCertificateSha256: 'a'.repeat(64),
      vaultReferenceId: '3c5e3dba-c528-4b0a-937e-bdb9be90e347',
      vaultRecordSha256: 'b'.repeat(64),
      headerPrefix: 'Bearer ',
      to: ['finance@example.net'],
      subject: 'Approved report',
      text: 'The approved report is attached.',
    };
    const prisma = {
      msaidiziTask: { findUnique: jest.fn().mockResolvedValue(null) },
      msaidiziPrincipal: {
        upsert: jest.fn().mockResolvedValue({ id: 'principal-1', status: 'ACTIVE' }),
      },
      msaidiziMandate: {
        findFirst: jest.fn().mockResolvedValue({
          id: mandateId,
          principalId: 'principal-1',
          createdByUserId: USER.id,
          status: 'ACTIVE',
          deviceIds: [deviceId],
          startsAt: null,
          expiresAt: null,
          capabilities: [
            {
              capability: 'external.email.send',
              version: '1.0.0',
              effects: [MsaidiziEffect.EXTERNAL],
              dataClasses: ['Confidential'],
              externalDestinationAuthorities: ['mandate_dynamic_https_v1'],
            },
          ],
          budgets: {},
        }),
      },
      msaidiziDevice: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: deviceId,
            capabilityManifest: {
              capabilities: [
                {
                  id: 'external.email.send',
                  version: '1.0.0',
                  dataClass: 'Confidential',
                  effect: 'ExternalWrite',
                  argumentsSchema: dynamicEmailArgumentsSchema(),
                },
              ],
            },
          },
        ]),
      },
      $transaction: jest.fn((work: (client: typeof tx) => unknown) => work(tx)),
    };
    const service = createService(
      prisma,
      config({ autopilotEnabled: true, hostExecutionEnabled: true }),
    );

    await service.plan(
      {
        title: 'Send the approved report',
        objective: 'Send one report through the exact mandate-authorized API',
        mode: MsaidiziTaskMode.AUTOPILOT,
        mandateId,
        inputs: {},
        stopConditions: {},
        steps: [
          step({
            key: 'send-report',
            name: 'Send approved report',
            target: MsaidiziExecutionTarget.HOST,
            capability: 'external.email.send',
            capabilityVersion: '1.0.0',
            arguments: dynamicArguments,
            expectedEffect: MsaidiziEffect.EXTERNAL,
            dataClass: 'Confidential',
            preconditions: { deviceId, expectedPreStateSha256: 'c'.repeat(64) },
            mutation: true,
          }),
        ],
      },
      USER,
    );

    expect(createdSteps.mock.calls[0][0].data[0].arguments).toEqual(dynamicArguments);
  });

  it('persists only a semantically validated generated changeset and rejects decoded secrets', async () => {
    const createdSteps = jest.fn();
    const tx = {
      msaidiziTask: { create: jest.fn(), findFirst: jest.fn().mockResolvedValue(task()) },
      msaidiziPlanVersion: { create: jest.fn() },
      msaidiziTaskStep: { createMany: createdSteps },
      msaidiziTaskEvent: { create: jest.fn() },
    };
    const mandateId = 'e7f5fa86-33d7-4c6f-89aa-5f3bbffcb5ad';
    const dataClass = proposalDataClass('APPLICATION');
    const source = [
      'export function computeBoundedTotal(values: readonly number[]): number {',
      '  return values.reduce((sum, value) => sum + value, 0);',
      '}',
      '',
    ].join('\n');
    const generatedArguments = generatedTaskArguments(source);
    const prisma = {
      msaidiziTask: { findUnique: jest.fn().mockResolvedValue(null) },
      msaidiziPrincipal: {
        upsert: jest.fn().mockResolvedValue({ id: 'principal-1', status: 'ACTIVE' }),
      },
      msaidiziMandate: {
        findFirst: jest.fn().mockResolvedValue({
          id: mandateId,
          principalId: 'principal-1',
          createdByUserId: USER.id,
          status: 'ACTIVE',
          startsAt: null,
          expiresAt: null,
          capabilities: [
            {
              capability: UPDATE_CANDIDATE_PROPOSAL_CAPABILITY,
              version: UPDATE_CANDIDATE_GENERATION_CAPABILITY_VERSION,
              effects: [MsaidiziEffect.WRITE],
              dataClasses: [dataClass],
            },
          ],
          budgets: {},
        }),
      },
      $transaction: jest.fn((work: (client: typeof tx) => unknown) => work(tx)),
    };
    const service = createService(
      prisma,
      config({ autopilotEnabled: true, principalGrants: ['*'] } as never),
    );
    const generatedStep = step({
      key: 'generate-update',
      name: 'Generate bounded update',
      target: MsaidiziExecutionTarget.SELF_IMPROVEMENT,
      capability: UPDATE_CANDIDATE_PROPOSAL_CAPABILITY,
      capabilityVersion: UPDATE_CANDIDATE_GENERATION_CAPABILITY_VERSION,
      arguments: generatedArguments,
      expectedEffect: MsaidiziEffect.WRITE,
      dataClass,
      mutation: true,
    });

    await service.plan(
      {
        title: 'Generate bounded candidate',
        objective: 'Generate and isolate one bounded candidate',
        mode: MsaidiziTaskMode.AUTOPILOT,
        mandateId,
        inputs: {},
        stopConditions: {},
        steps: [generatedStep],
      },
      USER,
    );

    expect(createdSteps.mock.calls[0][0].data[0].arguments).toEqual(generatedArguments);

    const rejectedPersistence = jest.fn();
    const rejectedService = createService(
      { $transaction: rejectedPersistence },
      config({ autopilotEnabled: true } as never),
    );
    const secretArguments = generatedTaskArguments(
      'export const credential = "sk-proj-abcdefghijklmnop123456";\n',
    );
    await expect(
      rejectedService.plan(
        {
          title: 'Unsafe generated candidate',
          objective: 'Unsafe generated candidate',
          mode: MsaidiziTaskMode.AUTOPILOT,
          mandateId,
          inputs: {},
          stopConditions: {},
          steps: [{ ...generatedStep, arguments: secretArguments }],
        },
        USER,
      ),
    ).rejects.toThrow('credential-like data');
    expect(rejectedPersistence).not.toHaveBeenCalled();
  });

  it('atomically consumes one proposal receipt and seeds its spend into the task ledger', async () => {
    const createdTask = jest.fn();
    const createdPlan = jest.fn();
    const tx = {
      msaidiziTask: { create: createdTask, findFirst: jest.fn().mockResolvedValue(task()) },
      msaidiziPlanVersion: { create: createdPlan },
      msaidiziTaskStep: { createMany: jest.fn() },
      msaidiziTaskEvent: { create: jest.fn() },
      $executeRawUnsafe: jest.fn(),
    };
    const prisma = {
      msaidiziTask: { findUnique: jest.fn().mockResolvedValue(null) },
      msaidiziPrincipal: {
        upsert: jest.fn().mockResolvedValue({ id: 'principal-1', status: 'ACTIVE' }),
      },
      $transaction: jest.fn((work: (client: typeof tx) => unknown) => work(tx)),
    };
    const receipt = {
      id: '22222222-2222-4222-8222-222222222222',
      expiresAt: new Date('2026-08-27T00:00:00.000Z'),
      proposalDigest: msaidiziProposalDigest({
        title: 'Review expenses',
        objective: 'Review expenses',
        summary: 'Review expenses',
        mode: MsaidiziTaskMode.COLLABORATIVE,
        companyId: USER.companyId,
        inputs: {},
        stopConditions: {},
        budgets: {
          maxWallTimeSeconds: 7_200,
          maxModelTurns: 200,
          maxAttemptedToolCalls: 500,
          maxMutations: 100,
          maxLocalBytes: 5_368_709_120,
          maxExternalEgressBytes: 262_144_000,
          maxModelCostUsd: 20,
        },
        steps: [step()],
      }),
      modelTurns: 2,
      inputTokens: 1_250n,
      outputTokens: 300n,
      estimatedCostUsd: '0.082500',
    };
    const proposalUsage = {
      inspectConsumable: jest.fn().mockResolvedValue(receipt),
      consume: jest.fn().mockResolvedValue(undefined),
    };
    const service = createService(prisma, config(), [DEFAULT_CAPABILITY], true, proposalUsage);

    await service.plan(
      {
        title: 'Review expenses',
        objective: 'Review expenses',
        mode: MsaidiziTaskMode.COLLABORATIVE,
        proposalUsageId: receipt.id,
        proposalDigest: receipt.proposalDigest,
        inputs: {},
        stopConditions: {},
        steps: [step()],
      },
      USER,
    );

    expect(proposalUsage.inspectConsumable).toHaveBeenCalledWith({
      receiptId: receipt.id,
      proposalDigest: receipt.proposalDigest,
      userId: USER.id,
      companyId: USER.companyId,
      mode: MsaidiziTaskMode.COLLABORATIVE,
    });
    expect(proposalUsage.consume).toHaveBeenCalledWith(tx, receipt.id, receipt.proposalDigest);
    expect(proposalUsage.consume.mock.invocationCallOrder[0]).toBeLessThan(
      createdTask.mock.invocationCallOrder[0],
    );
    expect(createdTask.mock.calls[0][0].data).toMatchObject({
      proposalUsageId: receipt.id,
      modelTurns: 2,
      inputTokens: 1_250n,
      outputTokens: 300n,
      modelCostUsd: '0.082500',
    });
    expect(createdPlan.mock.calls[0][0].data.sourceProposalDigest).toBe(receipt.proposalDigest);
    expect(tx.$executeRawUnsafe).toHaveBeenCalledWith(
      'SET CONSTRAINTS "msaidizi_tasks_proposal_receipt_guard" IMMEDIATE',
    );
  });

  it('rejects credential-like execution arguments instead of persisting a changed action', async () => {
    const prisma = { msaidiziPrincipal: { upsert: jest.fn() } };
    const service = createService(prisma);

    await expect(
      service.plan(
        {
          title: 'Use a secret',
          objective: 'Use a secret ephemerally',
          mode: MsaidiziTaskMode.COLLABORATIVE,
          inputs: {},
          stopConditions: {},
          steps: [
            step({
              arguments: {
                path: {},
                query: {},
                body: { password: 'hunter2' },
              },
            }),
          ],
        },
        USER,
      ),
    ).rejects.toThrow('use a supervisor-owned secret reference');
    expect(prisma.msaidiziPrincipal.upsert).not.toHaveBeenCalled();
  });

  it('rejects raw microphone capabilities and legacy audio-bearing STT arguments before persistence', async () => {
    const prisma = { msaidiziPrincipal: { upsert: jest.fn() } };
    const service = createService(
      prisma,
      config({ autopilotEnabled: true, hostExecutionEnabled: true }),
    );
    const request = (capability: string, argumentsValue: Record<string, unknown>) => ({
      title: 'Capture a review note',
      objective: 'Transcribe a short local review note',
      mode: MsaidiziTaskMode.AUTOPILOT,
      inputs: {},
      stopConditions: {},
      steps: [
        step({
          target: MsaidiziExecutionTarget.HOST,
          capability,
          capabilityVersion: '1.0.0',
          arguments: argumentsValue,
          expectedEffect: MsaidiziEffect.READ,
          dataClass: 'Biometric',
          mutation: false,
        }),
      ],
    });

    await expect(
      service.plan(request('audio.microphone.capture', { durationMilliseconds: 1_000 }), USER),
    ).rejects.toThrow('cannot serialize or broker raw microphone audio');
    await expect(
      service.plan(
        request('speech.audio.transcribe', {
          recognizerId: 'offline-en-US',
          durationMilliseconds: 1_000,
          maxCharacters: 2_048,
          contentBase64: 'UklGRg==',
        }),
        USER,
      ),
    ).rejects.toThrow('exact governed local transcription contract');
    expect(prisma.msaidiziPrincipal.upsert).not.toHaveBeenCalled();
  });

  it('refuses to queue a host plan while host execution is disabled', async () => {
    const hostTask = task({
      planVersions: [
        {
          ...task().planVersions[0],
          steps: [{ id: 'host-step', target: MsaidiziExecutionTarget.HOST, sequence: 1 }],
        },
      ],
    });
    const prisma = {
      msaidiziTask: { findFirst: jest.fn().mockResolvedValue(hostTask) },
      $transaction: jest.fn(),
    };
    const service = createService(prisma, config({ hostExecutionEnabled: false }));

    await expect(service.create(hostTask.id, USER)).rejects.toThrow(
      'Privileged host execution is disabled',
    );
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('requires exact one-use consent and appends its action-bound event in the queue CAS', async () => {
    const localSpeechArguments = {
      durationMilliseconds: 1_000,
      maxCharacters: 2_048,
      recognizerId: 'offline-en-US',
    };
    const localSpeechStep = {
      id: '22222222-2222-4222-8222-222222222222',
      target: MsaidiziExecutionTarget.HOST,
      sequence: 1,
      capability: 'speech.audio.transcribe',
      capabilityVersion: '1.0.0',
      arguments: localSpeechArguments,
    };
    const ready = task({
      hostExecutionAllowed: true,
      planVersions: [
        {
          ...task().planVersions[0],
          id: '11111111-1111-4111-8111-111111111111',
          steps: [localSpeechStep],
        },
      ],
    });
    const queued = { ...ready, status: MsaidiziTaskStatus.QUEUED, stateVersion: 1 };
    const eventCreate = jest.fn().mockResolvedValue({});
    const tx = {
      msaidiziTask: {
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        findFirst: jest.fn().mockResolvedValue(queued),
      },
      msaidiziTaskEvent: { create: eventCreate },
    };
    const prisma = {
      msaidiziTask: { findFirst: jest.fn().mockResolvedValue(ready) },
      $transaction: jest.fn((work: (client: typeof tx) => unknown) => work(tx)),
    };
    const service = createService(prisma, config({ hostExecutionEnabled: true }));

    await expect(service.create(ready.id, USER)).rejects.toThrow(
      'One-shot host capabilities require explicit one-use consent',
    );
    await expect(
      service.create(ready.id, USER, [localSpeechStep.id, localSpeechStep.id]),
    ).rejects.toThrow('One-shot host capabilities require explicit one-use consent');
    await service.create(ready.id, USER, [localSpeechStep.id]);

    const expectedDigest = createHash('sha256')
      .update(JSON.stringify(localSpeechArguments))
      .digest('hex')
      .toUpperCase();
    expect(eventCreate).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        data: expect.objectContaining({
          taskId: ready.id,
          type: 'task.one_shot_consent_granted',
          actorType: 'HUMAN',
          actorId: USER.id,
          payload: {
            protocol: 'msaidizi-one-shot-step-consent/v1',
            planVersionId: ready.planVersions[0].id,
            planVersion: ready.planVersions[0].version,
            stepId: localSpeechStep.id,
            capability: localSpeechStep.capability,
            capabilityVersion: localSpeechStep.capabilityVersion,
            argumentsSha256: expectedDigest,
            consentGrant: 'one_shot_approval',
            instructionAuthority: 'NONE',
          },
        }),
      }),
    );
  });

  it('binds privileged command one-shot consent to the exact active-plan step and arguments', async () => {
    const commandArguments = {
      executable: 'cmd',
      argv: ['/d', '/s', '/c', 'whoami'],
      timeoutSeconds: 30,
      maximumOutputBytes: 65_536,
    };
    const commandStep = {
      id: '33333333-3333-4333-8333-333333333333',
      target: MsaidiziExecutionTarget.HOST,
      sequence: 1,
      capability: 'command.privileged.execute',
      capabilityVersion: '1.0.0',
      arguments: commandArguments,
    };
    const ready = task({
      hostExecutionAllowed: true,
      planVersions: [
        {
          ...task().planVersions[0],
          id: '44444444-4444-4444-8444-444444444444',
          steps: [commandStep],
        },
      ],
    });
    const queued = { ...ready, status: MsaidiziTaskStatus.QUEUED, stateVersion: 1 };
    const eventCreate = jest.fn().mockResolvedValue({});
    const tx = {
      msaidiziTask: {
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        findFirst: jest.fn().mockResolvedValue(queued),
      },
      msaidiziTaskEvent: { create: eventCreate },
    };
    const prisma = {
      msaidiziTask: { findFirst: jest.fn().mockResolvedValue(ready) },
      $transaction: jest.fn((work: (client: typeof tx) => unknown) => work(tx)),
    };
    const service = createService(prisma, config({ hostExecutionEnabled: true }));

    await expect(service.create(ready.id, USER)).rejects.toThrow(
      'One-shot host capabilities require explicit one-use consent',
    );
    await service.create(ready.id, USER, [commandStep.id]);

    const expectedDigest = createHash('sha256')
      .update(
        JSON.stringify({
          argv: commandArguments.argv,
          executable: commandArguments.executable,
          maximumOutputBytes: commandArguments.maximumOutputBytes,
          timeoutSeconds: commandArguments.timeoutSeconds,
        }),
      )
      .digest('hex')
      .toUpperCase();
    expect(eventCreate).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        data: expect.objectContaining({
          taskId: ready.id,
          type: 'task.one_shot_consent_granted',
          actorType: 'HUMAN',
          actorId: USER.id,
          payload: {
            protocol: 'msaidizi-one-shot-step-consent/v1',
            planVersionId: ready.planVersions[0].id,
            planVersion: ready.planVersions[0].version,
            stepId: commandStep.id,
            capability: commandStep.capability,
            capabilityVersion: commandStep.capabilityVersion,
            argumentsSha256: expectedDigest,
            consentGrant: 'one_shot_approval',
            instructionAuthority: 'NONE',
          },
        }),
      }),
    );
  });

  it('uses status and stateVersion in the same CAS that requests cancellation', async () => {
    const running = task({ status: MsaidiziTaskStatus.RUNNING, stateVersion: 7 });
    const cancelling = task({ status: MsaidiziTaskStatus.CANCELLING, stateVersion: 8 });
    const updateMany = jest.fn().mockResolvedValue({ count: 1 });
    const tx = {
      msaidiziTask: { updateMany, findFirst: jest.fn().mockResolvedValue(cancelling) },
      msaidiziTaskEvent: { create: jest.fn() },
    };
    const prisma = {
      msaidiziTask: { findFirst: jest.fn().mockResolvedValue(running) },
      $transaction: jest.fn((work: (client: typeof tx) => unknown) => work(tx)),
    };
    const service = createService(prisma);

    await service.cancel(running.id, USER);

    expect(updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: running.id, status: MsaidiziTaskStatus.RUNNING, stateVersion: 7 },
        data: expect.objectContaining({
          status: MsaidiziTaskStatus.CANCELLING,
          stateVersion: { increment: 1 },
        }),
      }),
    );
  });

  it('routes paused broker-staged work through CANCELLING before terminal cancellation', async () => {
    const paused = task({
      status: MsaidiziTaskStatus.PAUSED,
      stateVersion: 11,
      hostActions: [{ status: 'QUEUED', uncertainOutcome: false }],
    });
    const cancelling = task({ status: MsaidiziTaskStatus.CANCELLING, stateVersion: 12 });
    const updateMany = jest.fn().mockResolvedValue({ count: 1 });
    const tx = {
      msaidiziTask: { updateMany, findFirst: jest.fn().mockResolvedValue(cancelling) },
      msaidiziTaskEvent: { create: jest.fn().mockResolvedValue({}) },
    };
    const prisma = {
      msaidiziTask: { findFirst: jest.fn().mockResolvedValue(paused) },
      $transaction: jest.fn((work: (client: typeof tx) => unknown) => work(tx)),
    };

    await createService(prisma).cancel(paused.id, USER);

    expect(updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: paused.id, status: MsaidiziTaskStatus.PAUSED, stateVersion: 11 },
        data: expect.objectContaining({ status: MsaidiziTaskStatus.CANCELLING }),
      }),
    );
  });

  it('rejects cyclic plans before creating a principal or task', async () => {
    const prisma = { msaidiziPrincipal: { upsert: jest.fn() } };
    const service = createService(prisma);
    await expect(
      service.plan(
        {
          title: 'Cycle',
          objective: 'Cycle',
          mode: MsaidiziTaskMode.COLLABORATIVE,
          inputs: {},
          stopConditions: {},
          steps: [step({ key: 'a', dependsOn: ['b'] }), step({ key: 'b', dependsOn: ['a'] })],
        },
        USER,
      ),
    ).rejects.toThrow('Task plan must be acyclic');
    expect(prisma.msaidiziPrincipal.upsert).not.toHaveBeenCalled();
  });

  it('does not let a collaborative task borrow a permission held only by the service principal', async () => {
    const prisma = {
      msaidiziPrincipal: {
        upsert: jest.fn().mockResolvedValue({ id: 'principal-1', status: 'ACTIVE' }),
      },
    };
    const capability = {
      ...DEFAULT_CAPABILITY,
      permissions: ['expenses.read'],
    } satisfies Capability;
    const service = createService(prisma, config(), [capability]);

    await expect(
      service.plan(
        {
          title: 'Review expenses',
          objective: 'Review expenses',
          mode: MsaidiziTaskMode.COLLABORATIVE,
          inputs: {},
          stopConditions: {},
          steps: [step()],
        },
        USER,
      ),
    ).rejects.toThrow('not permitted for the initiating user');
    expect(prisma.msaidiziPrincipal.upsert).not.toHaveBeenCalled();
  });

  it('keeps red collaborative work on the existing exact one-shot approval path', async () => {
    const prisma = {
      msaidiziPrincipal: {
        upsert: jest.fn().mockResolvedValue({ id: 'principal-1', status: 'ACTIVE' }),
      },
    };
    const capability = {
      ...DEFAULT_CAPABILITY,
      id: 'ExpensesController.remove',
      handler: 'remove',
      verb: 'DELETE' as const,
      tier: 'red' as const,
      permissions: ['expenses.delete'],
    } satisfies Capability;
    const service = createService(prisma, config(), [capability]);

    await expect(
      service.plan(
        {
          title: 'Delete expense',
          objective: 'Delete one expense',
          mode: MsaidiziTaskMode.COLLABORATIVE,
          inputs: {},
          stopConditions: {},
          steps: [
            step({
              capability: capability.id,
              expectedEffect: MsaidiziEffect.IRREVERSIBLE,
              mutation: true,
            }),
          ],
        },
        { ...USER, permissions: [...USER.permissions, 'expenses.delete'] },
      ),
    ).rejects.toThrow('existing exact one-shot approval flow');
    expect(prisma.msaidiziPrincipal.upsert).not.toHaveBeenCalled();
  });

  it('refuses replanning after any mutation or uncertain outcome', async () => {
    const unsafeTask = task({
      status: MsaidiziTaskStatus.NEEDS_ATTENTION,
      mutations: 1,
      toolAttempts: [{ uncertainOutcome: true }],
    });
    const prisma = {
      msaidiziTask: { findFirst: jest.fn().mockResolvedValue(unsafeTask) },
      $transaction: jest.fn(),
    };
    const service = createService(prisma);

    await expect(
      service.replan(
        unsafeTask.id,
        {
          summary: 'Try a different plan',
          inputs: {},
          stopConditions: {},
          steps: [step()],
        },
        USER,
      ),
    ).rejects.toThrow('cannot be replanned after a mutation or uncertain outcome');
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('persists an explicit UTC creation instant for every replanned step', async () => {
    const current = task({ status: MsaidiziTaskStatus.READY });
    const replanned = task({ status: MsaidiziTaskStatus.READY, activePlanVersion: 2 });
    const createdSteps = jest.fn();
    const tx = {
      msaidiziTask: {
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        findFirst: jest.fn().mockResolvedValue(replanned),
      },
      msaidiziPlanVersion: { create: jest.fn() },
      msaidiziTaskStep: { createMany: createdSteps },
      msaidiziTaskEvent: { create: jest.fn() },
    };
    const prisma = {
      msaidiziTask: { findFirst: jest.fn().mockResolvedValue(current) },
      $transaction: jest.fn((work: (client: typeof tx) => unknown) => work(tx)),
    };
    const service = createService(prisma);

    await service.replan(
      current.id,
      {
        summary: 'Use the narrowed read plan',
        inputs: {},
        stopConditions: {},
        steps: [step()],
      },
      USER,
    );

    expect(createdSteps.mock.calls[0][0].data[0].createdAt).toBeInstanceOf(Date);
    expect(createdSteps.mock.calls[0][0].data[0].createdAt.toISOString()).toMatch(/Z$/);
  });

  it('revalidates bound targets against the exact capability schema before replan persistence', async () => {
    const current = task({ status: MsaidiziTaskStatus.READY });
    const prisma = {
      msaidiziTask: { findFirst: jest.fn().mockResolvedValue(current) },
      $transaction: jest.fn(),
    };
    const service = createService(prisma);

    await expect(
      service.replan(
        current.id,
        {
          summary: 'Attempt a binding to a nonexistent query field',
          inputs: { invented: 'not-authorized' },
          stopConditions: {},
          steps: [
            step({
              arguments: { path: {}, query: { invented: null } },
              inputBindings: [
                {
                  targetPath: '/query/invented',
                  source: { kind: 'PLAN_INPUT', path: '/invented' },
                  dataClass: 'internal',
                  expectedType: 'string',
                  expectedSchema: { type: 'string', minLength: 1, maxLength: 64 },
                  transform: { name: 'IDENTITY', version: '1' },
                },
              ],
            }),
          ],
        },
        USER,
      ),
    ).rejects.toMatchObject({
      response: expect.objectContaining({ code: 'BINDING_TARGET_SCHEMA_MISSING' }),
    });
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('keeps an uncertain write in NEEDS_ATTENTION instead of relabelling it cancelled', async () => {
    const unsafeTask = task({
      status: MsaidiziTaskStatus.NEEDS_ATTENTION,
      toolAttempts: [{ uncertainOutcome: true }],
      hostActions: [{ uncertainOutcome: true }],
    });
    const prisma = {
      msaidiziTask: { findFirst: jest.fn().mockResolvedValue(unsafeTask) },
      $transaction: jest.fn(),
    };
    const service = createService(prisma);

    await expect(service.cancel(unsafeTask.id, USER)).rejects.toThrow(
      'must remain NEEDS_ATTENTION until it is reconciled',
    );
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('constrains a manual Autopilot plan to its caller-owned mandate capability scope', async () => {
    const redCapability = {
      ...DEFAULT_CAPABILITY,
      id: 'ExpensesController.remove',
      handler: 'remove',
      verb: 'DELETE' as const,
      tier: 'red' as const,
      permissions: ['expenses.delete'],
    } satisfies Capability;
    const prisma = {
      msaidiziTask: { findUnique: jest.fn().mockResolvedValue(null) },
      msaidiziPrincipal: {
        upsert: jest.fn().mockResolvedValue({ id: 'principal-1', status: 'ACTIVE' }),
      },
      msaidiziMandate: {
        findFirst: jest.fn().mockResolvedValue({
          id: 'mandate-1',
          principalId: 'principal-1',
          createdByUserId: USER.id,
          status: 'ACTIVE',
          startsAt: null,
          expiresAt: null,
          capabilities: [
            {
              capability: DEFAULT_CAPABILITY.id,
              version: '1',
              effects: [MsaidiziEffect.READ],
              dataClasses: ['internal'],
            },
          ],
          budgets: {},
        }),
      },
      $transaction: jest.fn(),
    };
    const service = createService(
      prisma,
      config({ autopilotEnabled: true, principalGrants: ['expenses.delete'] } as never),
      [redCapability],
    );

    await expect(
      service.plan(
        {
          title: 'Delete expense',
          objective: 'Delete one expense',
          mode: MsaidiziTaskMode.AUTOPILOT,
          mandateId: 'f7f5fa86-33d7-4c6f-89aa-5f3bbffcb5ad',
          inputs: {},
          stopConditions: {},
          steps: [
            step({
              capability: redCapability.id,
              expectedEffect: MsaidiziEffect.IRREVERSIBLE,
              mutation: true,
            }),
          ],
        },
        USER,
      ),
    ).rejects.toThrow('outside the selected mandate scope');
    expect(prisma.msaidiziMandate.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ createdByUserId: USER.id }),
      }),
    );
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('clamps manual Autopilot budgets to the selected mandate and rejects oversized plans', async () => {
    const prisma = {
      msaidiziTask: { findUnique: jest.fn().mockResolvedValue(null) },
      msaidiziPrincipal: {
        upsert: jest.fn().mockResolvedValue({ id: 'principal-1', status: 'ACTIVE' }),
      },
      msaidiziMandate: {
        findFirst: jest.fn().mockResolvedValue({
          id: 'mandate-1',
          capabilities: [
            {
              capability: DEFAULT_CAPABILITY.id,
              version: '1',
              effects: [MsaidiziEffect.READ],
              dataClasses: ['internal'],
            },
          ],
          budgets: { maxAttemptedToolCalls: 1, maxMutations: 0 },
        }),
      },
      $transaction: jest.fn(),
    };
    const service = createService(
      prisma,
      config({ autopilotEnabled: true, principalGrants: ['*'] } as never),
    );

    await expect(
      service.plan(
        {
          title: 'Read twice',
          objective: 'Read twice',
          mode: MsaidiziTaskMode.AUTOPILOT,
          mandateId: 'f7f5fa86-33d7-4c6f-89aa-5f3bbffcb5ad',
          inputs: {},
          stopConditions: {},
          steps: [step({ key: 'first' }), step({ key: 'second' })],
        },
        USER,
      ),
    ).rejects.toThrow('exceeds the mandate tool-attempt budget');
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });
});

function generatedTaskArguments(source: string) {
  const content = Buffer.from(source, 'utf8');
  return {
    name: 'Bounded generated task candidate',
    version: '2.0.0',
    scope: 'APPLICATION',
    rollbackVersion: '1.9.0',
    rationale: 'Generate a bounded source candidate for isolated evaluation.',
    baseRevisionSha256: 'a'.repeat(64),
    changes: [
      {
        relativePath: 'backend/src/modules/orders/bounded-total.ts',
        operation: 'ADD',
        expectedPreSha256: null,
        contentBase64: content.toString('base64'),
        contentSha256: createHash('sha256').update(content).digest('hex'),
      },
    ],
    evaluationBudget: {
      maxWallTimeSeconds: 600,
      maxCpuTimeSeconds: 1_200,
      maxBytesRead: '10485760',
      maxBytesWritten: '10485760',
      maxExternalEgressBytes: '1048576',
      maxModelTurns: 4,
      maxModelInputTokens: '10000',
      maxModelOutputTokens: '5000',
      maxModelCostMicrousd: '1000000',
    },
  };
}
