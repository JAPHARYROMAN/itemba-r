import { ConfigService } from '@nestjs/config';
import { MsaidiziTaskMode } from '@prisma/client';
import { Capability } from '../../common/capabilities/capability-manifest';
import { PrismaService } from '../../prisma/prisma.service';
import { AutonomyConfig } from '../msaidizi-tasks/autonomy.config';
import { ManifestProvider } from '../msaidizi/manifest.provider';
import { MsaidiziConfig } from '../msaidizi/msaidizi.config';
import { MsaidiziMemoryRetriever } from './msaidizi-memory-retriever.service';
import { MsaidiziReasoningContextService } from './msaidizi-reasoning-context.service';
import {
  proposalDataClass,
  UPDATE_CANDIDATE_GENERATION_CAPABILITY_VERSION,
  UPDATE_CANDIDATE_PROPOSAL_CAPABILITY,
} from '../msaidizi-updates/update-candidate-proposal.port';

describe('MsaidiziReasoningContextService', () => {
  it('only exposes ERP metadata admitted by the current caller permission envelope', async () => {
    const service = new MsaidiziReasoningContextService(
      {} as PrismaService,
      {
        capabilities: () => [
          capability('ExpensesController.findAll', 'expenses.read'),
          capability('PayablesController.findAll', 'payables.read'),
        ],
      } as ManifestProvider,
      { allowedTiers: ['green'] } as MsaidiziConfig,
      autonomyConfig(),
      { retrieve: jest.fn().mockResolvedValue([]) } as unknown as MsaidiziMemoryRetriever,
    );

    const context = await service.resolve(
      {
        objective: 'Review expenses',
        mode: MsaidiziTaskMode.COLLABORATIVE,
        inputs: {},
        stopConditions: {},
      },
      {
        id: 'user-1',
        email: 'user@example.com',
        roles: [],
        permissions: ['expenses.read'],
        companyId: 'company-1',
      },
    );

    expect(context.capabilities.map((entry) => entry.capability)).toEqual([
      'ExpensesController.findAll',
    ]);
    expect(context.capabilities[0].argumentsSchema).toMatchObject({
      required: expect.arrayContaining(['path', 'query']),
      additionalProperties: false,
    });
  });

  it('copies an explicit ERP external effect into planning metadata', async () => {
    const external = {
      ...capability('SyntheticExternalController.send', 'synthetic.send'),
      verb: 'POST' as const,
      tier: 'red' as const,
      tierReason: 'metered-external-egress',
      externalEgress: { metering: 'adapter-receipt-v1' as const, reservationBytes: 8192 },
    };
    const service = new MsaidiziReasoningContextService(
      {} as PrismaService,
      { capabilities: () => [external] } as ManifestProvider,
      { allowedTiers: ['red'] } as MsaidiziConfig,
      autonomyConfig(),
      { retrieve: jest.fn().mockResolvedValue([]) } as unknown as MsaidiziMemoryRetriever,
    );

    const context = await service.resolve(
      {
        objective: 'Send the governed payload',
        mode: MsaidiziTaskMode.AUTOPILOT,
        inputs: {},
        stopConditions: {},
      },
      {
        id: 'user-1',
        email: 'user@example.com',
        roles: [],
        permissions: ['synthetic.send'],
        companyId: 'company-1',
      },
    );

    expect(context.capabilities).toEqual([
      expect.objectContaining({
        capability: external.id,
        expectedEffect: 'EXTERNAL',
        mutation: true,
        idempotent: false,
      }),
    ]);
  });

  it('redacts credential-like objective and input values before any model request', async () => {
    const service = new MsaidiziReasoningContextService(
      {} as PrismaService,
      {
        capabilities: () => [capability('ExpensesController.findAll', 'expenses.read')],
      } as ManifestProvider,
      { allowedTiers: ['green'] } as MsaidiziConfig,
      autonomyConfig(),
      { retrieve: jest.fn().mockResolvedValue([]) } as unknown as MsaidiziMemoryRetriever,
    );
    const context = await service.resolve(
      {
        objective: 'Review expenses with api_key=sk-proj-abcdefghijklmnop1234',
        mode: MsaidiziTaskMode.COLLABORATIVE,
        inputs: { password: 'never-store-this' },
        stopConditions: {},
      },
      {
        id: 'user-1',
        email: 'user@example.com',
        roles: [],
        permissions: ['expenses.read'],
        companyId: 'company-1',
      },
    );
    expect(context.objective).not.toContain('sk-proj-');
    expect(context.inputs).toEqual({ password: '[REDACTED SECRET]' });
    expect(context.redactionsApplied).toBe(true);
  });

  it('loads selected encrypted artifacts through the scoped budgeted reader as untrusted data', async () => {
    const retrieve = jest.fn().mockResolvedValue([]);
    const readDraftForReasoning = jest.fn().mockResolvedValue([
      {
        id: '11111111-1111-4111-8111-111111111111',
        taskId: '22222222-2222-4222-8222-222222222222',
        kind: 'SCREENSHOT',
        name: 'screen.png',
        mimeType: 'image/png',
        byteSize: 3n,
        sha256: 'a'.repeat(64),
        dataClass: 'confidential',
        trustLevel: 'UNTRUSTED',
        storedTrustLevel: 'TRUSTED',
        provenance: { sourceType: 'SCREEN' },
        content: Buffer.from([1, 2, 3]),
      },
    ]);
    const service = new MsaidiziReasoningContextService(
      {
        msaidiziTask: {
          findFirst: jest.fn().mockResolvedValue(planningDraft('Read the screenshot')),
        },
      } as unknown as PrismaService,
      { capabilities: () => [] } as unknown as ManifestProvider,
      { allowedTiers: ['green'] } as MsaidiziConfig,
      autonomyConfig(),
      { retrieve } as unknown as MsaidiziMemoryRetriever,
      { readDraftForReasoning } as never,
    );
    const user = {
      id: 'user-1',
      email: 'user@example.com',
      roles: [],
      permissions: ['msaidizi.use'],
      companyId: 'company-1',
    };

    const context = await service.resolve(
      {
        taskId: '22222222-2222-4222-8222-222222222222',
        objective: 'Read the screenshot',
        mode: MsaidiziTaskMode.COLLABORATIVE,
        inputs: {},
        stopConditions: {},
        artifactIds: ['11111111-1111-4111-8111-111111111111'],
      },
      user,
    );

    expect(readDraftForReasoning).toHaveBeenCalledWith(
      {
        taskId: '22222222-2222-4222-8222-222222222222',
        principalId: 'principal-1',
        initiatedByUserId: 'user-1',
        companyId: 'company-1',
        mandateId: null,
        mode: MsaidiziTaskMode.COLLABORATIVE,
        stateVersion: 0,
      },
      ['11111111-1111-4111-8111-111111111111'],
      user,
    );
    expect(retrieve).toHaveBeenCalledWith(
      expect.objectContaining({
        objective: 'Read the screenshot',
        companyId: 'company-1',
        user,
        runtimeAuthority: {
          taskId: '22222222-2222-4222-8222-222222222222',
          principalId: 'principal-1',
          initiatedByUserId: 'user-1',
          companyId: 'company-1',
          mandateId: null,
          deviceId: null,
          stateVersion: 0,
        },
      }),
    );
    expect(context.artifacts).toEqual([
      expect.objectContaining({
        id: '11111111-1111-4111-8111-111111111111',
        sourceTaskId: '22222222-2222-4222-8222-222222222222',
        trustLevel: 'UNTRUSTED',
        storedTrustLevel: 'TRUSTED',
      }),
    ]);
    expect(context.draftTaskId).toBe('22222222-2222-4222-8222-222222222222');
    expect(context.draftAuthority).toEqual(
      expect.objectContaining({
        taskId: '22222222-2222-4222-8222-222222222222',
        principalId: 'principal-1',
        initiatedByUserId: 'user-1',
        stateVersion: 0,
      }),
    );
  });

  it('rejects visual context without an existing caller-owned PLANNING task', async () => {
    const readDraftForReasoning = jest.fn();
    const service = new MsaidiziReasoningContextService(
      {} as PrismaService,
      { capabilities: () => [] } as unknown as ManifestProvider,
      { allowedTiers: ['green'] } as MsaidiziConfig,
      autonomyConfig(),
      { retrieve: jest.fn().mockResolvedValue([]) } as unknown as MsaidiziMemoryRetriever,
      { readDraftForReasoning } as never,
    );

    await expect(
      service.resolve(
        {
          objective: 'Read a screenshot from some earlier task',
          mode: MsaidiziTaskMode.COLLABORATIVE,
          inputs: {},
          stopConditions: {},
          artifactIds: ['11111111-1111-4111-8111-111111111111'],
        },
        {
          id: 'user-1',
          email: 'user@example.com',
          roles: [],
          permissions: ['msaidizi.use'],
          companyId: 'company-1',
        },
      ),
    ).rejects.toThrow('caller-owned PLANNING task draft');
    expect(readDraftForReasoning).not.toHaveBeenCalled();
  });

  it('rejects an artifact from another task before decrypting or charging a reasoning read', async () => {
    const readDraftForReasoning = jest
      .fn()
      .mockRejectedValue(new Error('Reasoning artifact not found'));
    const service = new MsaidiziReasoningContextService(
      {
        msaidiziTask: {
          findFirst: jest.fn().mockResolvedValue(planningDraft('Read my draft screenshot')),
        },
      } as unknown as PrismaService,
      { capabilities: () => [] } as unknown as ManifestProvider,
      { allowedTiers: ['green'] } as MsaidiziConfig,
      autonomyConfig(),
      { retrieve: jest.fn().mockResolvedValue([]) } as unknown as MsaidiziMemoryRetriever,
      { readDraftForReasoning } as never,
    );

    await expect(
      service.resolve(
        {
          taskId: '22222222-2222-4222-8222-222222222222',
          objective: 'Read my draft screenshot',
          mode: MsaidiziTaskMode.COLLABORATIVE,
          inputs: {},
          stopConditions: {},
          artifactIds: ['11111111-1111-4111-8111-111111111111'],
        },
        {
          id: 'user-1',
          email: 'user@example.com',
          roles: [],
          permissions: ['msaidizi.use'],
          companyId: 'company-1',
        },
      ),
    ).rejects.toThrow('Reasoning artifact not found');
    expect(readDraftForReasoning).toHaveBeenCalledWith(
      expect.objectContaining({
        taskId: '22222222-2222-4222-8222-222222222222',
        principalId: 'principal-1',
        initiatedByUserId: 'user-1',
        stateVersion: 0,
      }),
      ['11111111-1111-4111-8111-111111111111'],
      expect.objectContaining({ id: 'user-1' }),
    );
  });

  it('zeroes decrypted draft bytes when post-load authority-context assembly is rejected', async () => {
    const plaintext = Buffer.from('ephemeral-draft-secret');
    const readDraftForReasoning = jest.fn().mockResolvedValue([
      {
        id: '11111111-1111-4111-8111-111111111111',
        taskId: '22222222-2222-4222-8222-222222222222',
        kind: 'FILE',
        name: 'large-provenance.txt',
        mimeType: 'text/plain',
        byteSize: BigInt(plaintext.length),
        sha256: 'a'.repeat(64),
        dataClass: 'confidential',
        trustLevel: 'UNTRUSTED',
        storedTrustLevel: 'UNTRUSTED',
        provenance: { oversized: 'x'.repeat(410_000) },
        content: plaintext,
      },
    ]);
    const service = new MsaidiziReasoningContextService(
      {
        msaidiziTask: {
          findFirst: jest.fn().mockResolvedValue(planningDraft('Read my draft document')),
        },
      } as unknown as PrismaService,
      { capabilities: () => [] } as unknown as ManifestProvider,
      { allowedTiers: ['green'] } as MsaidiziConfig,
      autonomyConfig(),
      { retrieve: jest.fn().mockResolvedValue([]) } as unknown as MsaidiziMemoryRetriever,
      { readDraftForReasoning } as never,
    );

    await expect(
      service.resolve(
        {
          taskId: '22222222-2222-4222-8222-222222222222',
          objective: 'Read my draft document',
          mode: MsaidiziTaskMode.COLLABORATIVE,
          inputs: {},
          stopConditions: {},
          artifactIds: ['11111111-1111-4111-8111-111111111111'],
        },
        {
          id: 'user-1',
          email: 'user@example.com',
          roles: [],
          permissions: ['msaidizi.use'],
          companyId: 'company-1',
        },
      ),
    ).rejects.toThrow('exceeds the model input limit');
    expect(plaintext.every((byte) => byte === 0)).toBe(true);
  });

  it('discovers generated self-improvement only under an explicit exact v2 mandate grant', async () => {
    const dataClass = proposalDataClass('APPLICATION');
    const resolve = async (version: string | undefined) => {
      const prisma = {
        msaidiziPrincipal: { findUnique: jest.fn().mockResolvedValue({ id: 'principal-1' }) },
        msaidiziMandate: {
          findFirst: jest.fn().mockResolvedValue({
            id: 'mandate-1',
            capabilities: [
              {
                capability: UPDATE_CANDIDATE_PROPOSAL_CAPABILITY,
                ...(version && { version }),
                effects: ['WRITE'],
                dataClasses: [dataClass],
              },
            ],
            deviceIds: [],
            budgets: {},
          }),
        },
      };
      const service = new MsaidiziReasoningContextService(
        prisma as never,
        { capabilities: () => [] } as unknown as ManifestProvider,
        { allowedTiers: ['green'] } as MsaidiziConfig,
        autonomyConfig(),
        { retrieve: jest.fn().mockResolvedValue([]) } as unknown as MsaidiziMemoryRetriever,
      );
      return service.resolve(
        {
          objective: 'Prepare a bounded application update',
          mode: MsaidiziTaskMode.AUTOPILOT,
          mandateId: 'f7f5fa86-33d7-4c6f-89aa-5f3bbffcb5ad',
          inputs: {},
          stopConditions: {},
        },
        {
          id: 'user-1',
          email: 'user@example.com',
          roles: [],
          permissions: ['msaidizi.use'],
          companyId: 'company-1',
        },
      );
    };

    const exactV2 = await resolve(UPDATE_CANDIDATE_GENERATION_CAPABILITY_VERSION);
    expect(exactV2.capabilities).toEqual([
      expect.objectContaining({
        target: 'SELF_IMPROVEMENT',
        capability: UPDATE_CANDIDATE_PROPOSAL_CAPABILITY,
        capabilityVersion: UPDATE_CANDIDATE_GENERATION_CAPABILITY_VERSION,
        dataClass,
        argumentsSchema: expect.objectContaining({ additionalProperties: false }),
      }),
    ]);
    await expect(resolve('1')).resolves.toMatchObject({ capabilities: [] });
    await expect(resolve(undefined)).resolves.toMatchObject({ capabilities: [] });
  });

  it('does not expose a forged legacy durable file-read manifest entry to planning', async () => {
    const descriptor = (id: string) => ({
      id,
      version: '1.0.0',
      description: id,
      effect: 'LocalRead',
      dataClass: 'Restricted',
      recovery: 'NotApplicable',
      idempotency: 'NotApplicable',
      touchesTrustedRoot: false,
      argumentsSchema: {
        type: 'object',
        properties: {},
        additionalProperties: false,
      },
    });
    const prisma = {
      msaidiziPrincipal: { findUnique: jest.fn().mockResolvedValue({ id: 'principal-1' }) },
      msaidiziMandate: {
        findFirst: jest.fn().mockResolvedValue({
          id: 'mandate-1',
          capabilities: [
            {
              capability: 'filesystem.file.read',
              version: '1.0.0',
              effects: ['READ'],
              dataClasses: ['Restricted'],
            },
            {
              capability: 'filesystem.file.disclose.ephemeral',
              version: '1.0.0',
              effects: ['READ'],
              dataClasses: ['Restricted'],
            },
            {
              capability: 'filesystem.entry.stat',
              version: '1.0.0',
              effects: ['READ'],
              dataClasses: ['Restricted'],
            },
          ],
          deviceIds: ['device-1'],
          budgets: {},
        }),
      },
      msaidiziDevice: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: 'device-1',
            name: 'VM',
            capabilityManifest: {
              manifestSha256: 'a'.repeat(64),
              capabilities: [
                descriptor('filesystem.file.read'),
                descriptor('filesystem.file.disclose.ephemeral'),
                descriptor('filesystem.entry.stat'),
              ],
            },
          },
        ]),
      },
    };
    const service = new MsaidiziReasoningContextService(
      prisma as never,
      { capabilities: () => [] } as unknown as ManifestProvider,
      { allowedTiers: ['green'] } as MsaidiziConfig,
      new AutonomyConfig(
        new ConfigService({
          MSAIDIZI_HOST_EXECUTION_ENABLED: 'true',
          MSAIDIZI_GLOBAL_PRINCIPAL_KEY: 'global-msaidizi',
          MSAIDIZI_GLOBAL_PRINCIPAL_GRANTS: '*',
        }),
      ),
      { retrieve: jest.fn().mockResolvedValue([]) } as unknown as MsaidiziMemoryRetriever,
    );

    const context = await service.resolve(
      {
        objective: 'Inspect the credential file metadata',
        mode: MsaidiziTaskMode.AUTOPILOT,
        mandateId: 'f7f5fa86-33d7-4c6f-89aa-5f3bbffcb5ad',
        deviceId: 'device-1',
        inputs: {},
        stopConditions: {},
      },
      {
        id: 'user-1',
        email: 'user@example.com',
        roles: [],
        permissions: ['msaidizi.use'],
        companyId: 'company-1',
      },
    );

    expect(context.capabilities.map((entry) => entry.capability)).toContain(
      'filesystem.entry.stat',
    );
    expect(context.capabilities.map((entry) => entry.capability)).not.toContain(
      'filesystem.file.read',
    );
    expect(context.capabilities.map((entry) => entry.capability)).not.toContain(
      'filesystem.file.disclose.ephemeral',
    );
  });
});

function capability(id: string, permission: string): Capability {
  const [controller, handler] = id.split('.');
  return {
    id,
    controller,
    handler,
    verb: 'GET',
    path: controller.replace(/Controller$/, '').toLowerCase(),
    permissions: [permission],
    anyPermissions: [],
    roles: [],
    apiScopes: [],
    guard: 'permission',
    tier: 'green',
    tierReason: 'verb-default',
    params: { path: [], query: [], freeFormQuery: false, hasBody: false },
    agentExcluded: false,
  };
}

function autonomyConfig(): AutonomyConfig {
  return {
    hostExecutionEnabled: false,
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
  } as AutonomyConfig;
}

function planningDraft(objective: string) {
  return {
    id: '22222222-2222-4222-8222-222222222222',
    principalId: 'principal-1',
    initiatedByUserId: 'user-1',
    companyId: 'company-1',
    mandateId: null,
    scheduleId: null,
    mode: MsaidiziTaskMode.COLLABORATIVE,
    objective,
    status: 'PLANNING',
    activePlanVersion: 0,
    stateVersion: 0,
    statusDetail: null,
    proposalUsageId: null,
    mutations: 0,
    attemptedToolCalls: 0,
    executedToolCalls: 0,
    modelTurns: 0,
    inputTokens: 0n,
    outputTokens: 0n,
    modelCostUsd: 0,
    maxWallTimeSeconds: 7_200,
    maxModelTurns: 200,
    maxAttemptedToolCalls: 500,
    maxMutations: 100,
    maxLocalBytes: 5_368_709_120n,
    maxExternalEgressBytes: 262_144_000n,
    maxModelCostUsd: 20,
    principal: { key: 'global-msaidizi', status: 'ACTIVE' },
    _count: {
      planVersions: 0,
      steps: 0,
      toolAttempts: 0,
      deviceLeases: 0,
      hostActions: 0,
    },
  };
}
