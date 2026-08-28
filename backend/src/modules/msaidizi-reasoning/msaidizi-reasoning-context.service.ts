import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
  Optional,
  PayloadTooLargeException,
} from '@nestjs/common';
import {
  AccessLevel,
  MsaidiziDeviceStatus,
  MsaidiziEffect,
  MsaidiziExecutionTarget,
  MsaidiziMandateStatus,
  MsaidiziTaskMode,
  Prisma,
} from '@prisma/client';
import { AuthUser } from '../../common/decorators/current-user.decorator';
import { capabilityEffect as erpCapabilityEffect } from '../../common/capabilities/capability-manifest';
import { assertCanAccessCompanyFromUser } from '../../common/services/company-scope.service';
import { sanitizePersistedValue } from '../../common/utils/persistent-secret-redaction';
import { PrismaService } from '../../prisma/prisma.service';
import {
  DraftReasoningAuthority,
  MsaidiziArtifactsService,
} from '../msaidizi-artifacts/msaidizi-artifacts.service';
import {
  capabilityDataClass,
  capabilityEffect,
  capabilityRecovery,
} from '../msaidizi-devices/device-security';
import { MsaidiziTaskBudgetDto } from '../msaidizi-tasks/dto/msaidizi-task.dto';
import { AutonomyConfig } from '../msaidizi-tasks/autonomy.config';
import { narrowCapabilities, tokenize } from '../msaidizi/domain-filter';
import { ManifestProvider } from '../msaidizi/manifest.provider';
import { isUnavailableHostFileContentCapability } from '../msaidizi-devices/host-file-ephemerality.policy';
import { MsaidiziConfig } from '../msaidizi/msaidizi.config';
import { buildRegistry, RegistryEntry } from '../msaidizi/tool-registry';
import { planningArgumentsSchema } from '../msaidizi/planning-capability-schema';
import { ProposeMsaidiziTaskDto } from './dto/msaidizi-reasoning.dto';
import { MsaidiziMemoryRetriever } from './msaidizi-memory-retriever.service';
import {
  generatedUpdateProposalArgumentsSchema,
  proposalDataClass,
  UPDATE_CANDIDATE_GENERATION_CAPABILITY_VERSION,
  UPDATE_CANDIDATE_PROPOSAL_CAPABILITY,
  UPDATE_CANDIDATE_PROPOSAL_SCOPES,
} from '../msaidizi-updates/update-candidate-proposal.port';
import { MSAIDIZI_REASONING_LIMITS } from './msaidizi-reasoning.limits';
import {
  JsonObject,
  MandateCapabilityGrant,
  PolicyViolation,
  ReasoningBudget,
  ReasoningCapability,
  ReasoningContext,
  ReasoningMandateContext,
} from './msaidizi-reasoning.types';
import type { MsaidiziDraftProposalAuthority } from './msaidizi-proposal-lease';

const SUPERVISOR_BOUNDARY_PREFIXES = [
  'supervisor.',
  'trusted-root.',
  'bootstrap.',
  'audit-signer.',
  'recovery-vault.',
  'device-identity.',
  'kill-switch.',
  'update-verifier.',
];

@Injectable()
export class MsaidiziReasoningContextService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly manifest: ManifestProvider,
    private readonly msaidizi: MsaidiziConfig,
    private readonly autonomy: AutonomyConfig,
    private readonly memories: MsaidiziMemoryRetriever,
    @Optional() private readonly artifacts?: MsaidiziArtifactsService,
  ) {}

  async resolve(dto: ProposeMsaidiziTaskDto, user: AuthUser): Promise<ReasoningContext> {
    const objective = sanitizePersistedValue(dto.objective.trim());
    const titleHint = dto.titleHint ? sanitizePersistedValue(dto.titleHint.trim()) : undefined;
    const inputs = sanitizePersistedValue(dto.inputs);
    const stopConditions = sanitizePersistedValue(dto.stopConditions);
    const scopeKeys = dto.memoryScopeKeys
      ? sanitizePersistedValue(dto.memoryScopeKeys).value
      : undefined;

    assertByteLimit(
      { inputs: inputs.value, stopConditions: stopConditions.value },
      MSAIDIZI_REASONING_LIMITS.maxStructuredInputBytes,
      'Proposal inputs and stop conditions exceed the reasoning context limit',
    );

    if (dto.artifactIds?.length && !dto.taskId) {
      throw new BadRequestException(
        'Multimodal proposal context requires a caller-owned PLANNING task draft',
      );
    }
    const draft = dto.taskId ? await this.resolveDraft(dto, objective.value, user) : null;
    const companyId = draft?.companyId ?? dto.companyId ?? user.companyId ?? null;
    assertCanAccessCompanyFromUser(user, companyId, AccessLevel.READ);

    const mandate = await this.resolveMandate(draft?.mandateId ?? dto.mandateId, companyId, user);
    const requestedBudgets = draft?.budgets ?? dto.budgets;
    if (draft && dto.budgets && !sameReasoningBudgets(draft.budgets, dto.budgets)) {
      throw new ConflictException('Proposal budgets do not match the immutable task draft');
    }
    const { budgets, violations: budgetViolations } = resolveBudgets(
      requestedBudgets,
      this.autonomy,
      mandate?.budgets,
    );
    if (draft && (!sameReasoningBudgets(draft.budgets, budgets) || budgetViolations.length > 0)) {
      throw new ConflictException(
        'Task draft budgets exceed current deployment or mandate policy; create a new draft',
      );
    }
    const erpCapabilities = boundedCapabilityBytes(
      this.erpCapabilities(objective.value, user),
      MSAIDIZI_REASONING_LIMITS.maxErpCapabilityContextBytes,
    );
    const hostCapabilities = boundedCapabilityBytes(
      this.autonomy.hostExecutionEnabled
        ? await this.hostCapabilities(objective.value, mandate, dto.deviceId)
        : [],
      MSAIDIZI_REASONING_LIMITS.maxHostCapabilityContextBytes,
    );
    const capabilities = [
      ...erpCapabilities,
      ...hostCapabilities,
      ...this.selfImprovementCapabilities(dto.mode, mandate),
    ];
    const retrievedMemories = await this.memories.retrieve({
      objective: objective.value,
      companyId,
      scopeKeys,
      user,
      ...(draft && {
        runtimeAuthority: {
          taskId: draft.id,
          principalId: draft.principalId,
          initiatedByUserId: draft.initiatedByUserId,
          companyId: draft.companyId,
          mandateId: draft.mandateId,
          deviceId: dto.deviceId ?? null,
          stateVersion: draft.stateVersion,
        },
      }),
    });
    const retrievedArtifacts = dto.artifactIds?.length
      ? await this.resolveArtifacts(dto.artifactIds, user, draft!)
      : [];
    try {
      const context: ReasoningContext = {
        ...(draft && {
          draftTaskId: draft.id,
          draftAuthority: draftProposalAuthority(draft),
        }),
        objective: objective.value,
        ...(titleHint?.value && { titleHint: titleHint.value }),
        mode: dto.mode,
        companyId,
        ...((draft?.mandateId ?? dto.mandateId) && {
          requestedMandateId: draft?.mandateId ?? dto.mandateId,
        }),
        ...(dto.deviceId && { requestedDeviceId: dto.deviceId }),
        inputs: inputs.value as JsonObject,
        stopConditions: stopConditions.value as JsonObject,
        budgets,
        budgetViolations,
        mandate,
        capabilities,
        memories: retrievedMemories,
        artifacts: retrievedArtifacts,
        callerPermissions: [...user.permissions],
        principalPermissions: this.autonomy.principalGrants,
        redactionsApplied: Boolean(
          objective.redactionsApplied ||
          titleHint?.redactionsApplied ||
          inputs.redactionsApplied ||
          stopConditions.redactionsApplied ||
          (dto.memoryScopeKeys &&
            JSON.stringify(dto.memoryScopeKeys) !== JSON.stringify(scopeKeys)),
        ),
      };
      assertByteLimit(
        {
          objective: context.objective,
          titleHint: context.titleHint,
          mode: context.mode,
          companyId: context.companyId,
          inputs: context.inputs,
          stopConditions: context.stopConditions,
          budgets: context.budgets,
          mandate: context.mandate,
          capabilities: context.capabilities,
          trustedMemories: context.memories.filter((memory) => memory.trustLevel === 'TRUSTED'),
          artifactProvenance: context.artifacts?.map((artifact) => ({
            id: artifact.id,
            sourceTaskId: artifact.sourceTaskId,
            sha256: artifact.sha256,
            mimeType: artifact.mimeType,
            dataClass: artifact.dataClass,
            trustLevel: artifact.trustLevel,
            provenance: artifact.provenance,
          })),
        },
        MSAIDIZI_REASONING_LIMITS.maxAuthorityModelInputBytes,
        'Resolved capability and memory context exceeds the model input limit',
      );
      return context;
    } catch (error) {
      for (const artifact of retrievedArtifacts) artifact.content.fill(0);
      throw error;
    }
  }

  private async resolveDraft(
    dto: ProposeMsaidiziTaskDto,
    objective: string,
    user: AuthUser,
  ): Promise<{
    id: string;
    principalId: string;
    initiatedByUserId: string;
    companyId: string | null;
    mandateId: string | null;
    mode: MsaidiziTaskMode;
    stateVersion: number;
    budgets: ReasoningBudget;
  }> {
    const draft = await this.prisma.msaidiziTask.findFirst({
      where: { id: dto.taskId, initiatedByUserId: user.id },
      select: {
        id: true,
        principalId: true,
        initiatedByUserId: true,
        companyId: true,
        mandateId: true,
        scheduleId: true,
        mode: true,
        objective: true,
        status: true,
        activePlanVersion: true,
        stateVersion: true,
        statusDetail: true,
        proposalUsageId: true,
        mutations: true,
        attemptedToolCalls: true,
        executedToolCalls: true,
        modelTurns: true,
        inputTokens: true,
        outputTokens: true,
        modelCostUsd: true,
        maxWallTimeSeconds: true,
        maxModelTurns: true,
        maxAttemptedToolCalls: true,
        maxMutations: true,
        maxLocalBytes: true,
        maxExternalEgressBytes: true,
        maxModelCostUsd: true,
        principal: { select: { key: true, status: true } },
        _count: {
          select: {
            planVersions: true,
            steps: true,
            toolAttempts: true,
            deviceLeases: true,
            hostActions: true,
          },
        },
      },
    });
    if (!draft) throw new NotFoundException('Msaidizi task draft not found');
    assertCanAccessCompanyFromUser(user, draft.companyId, AccessLevel.READ);
    if (
      draft.status !== 'PLANNING' ||
      draft.activePlanVersion !== 0 ||
      draft.statusDetail !== null ||
      draft.proposalUsageId !== null ||
      draft.scheduleId !== null ||
      draft.mutations !== 0 ||
      draft.attemptedToolCalls !== 0 ||
      draft.executedToolCalls !== 0 ||
      draft.modelTurns !== 0 ||
      draft.inputTokens !== 0n ||
      draft.outputTokens !== 0n ||
      Number(draft.modelCostUsd) !== 0 ||
      draft.principal.key !== this.autonomy.principalKey ||
      draft.principal.status !== 'ACTIVE' ||
      draft._count.planVersions !== 0 ||
      draft._count.steps !== 0 ||
      draft._count.toolAttempts !== 0 ||
      draft._count.deviceLeases !== 0 ||
      draft._count.hostActions !== 0
    ) {
      throw new ConflictException('Task is not an unused PLANNING draft');
    }
    if (
      dto.mode !== draft.mode ||
      objective !== draft.objective ||
      (dto.companyId !== undefined && dto.companyId !== draft.companyId) ||
      (dto.mandateId ?? null) !== draft.mandateId
    ) {
      throw new ConflictException('Proposal scope does not match the caller-owned task draft');
    }
    return {
      id: draft.id,
      principalId: draft.principalId,
      initiatedByUserId: draft.initiatedByUserId!,
      companyId: draft.companyId,
      mandateId: draft.mandateId,
      mode: draft.mode,
      stateVersion: draft.stateVersion,
      budgets: {
        maxWallTimeSeconds: draft.maxWallTimeSeconds,
        maxModelTurns: draft.maxModelTurns,
        maxAttemptedToolCalls: draft.maxAttemptedToolCalls,
        maxMutations: draft.maxMutations,
        maxLocalBytes: Number(draft.maxLocalBytes),
        maxExternalEgressBytes: Number(draft.maxExternalEgressBytes),
        maxModelCostUsd: Number(draft.maxModelCostUsd),
      },
    };
  }

  private async resolveArtifacts(
    ids: string[],
    user: AuthUser,
    draft: Omit<DraftReasoningAuthority, 'taskId'> & { id: string },
  ) {
    if (!this.artifacts) {
      throw new PayloadTooLargeException('Multimodal artifact reasoning is unavailable');
    }
    const loaded = await this.artifacts.readDraftForReasoning(
      {
        taskId: draft.id,
        principalId: draft.principalId,
        initiatedByUserId: draft.initiatedByUserId,
        companyId: draft.companyId,
        mandateId: draft.mandateId,
        mode: draft.mode,
        stateVersion: draft.stateVersion,
      },
      ids,
      user,
    );
    try {
      return loaded.map((artifact) => ({
        id: artifact.id,
        sourceTaskId: artifact.taskId,
        kind: artifact.kind,
        name: artifact.name,
        mimeType: artifact.mimeType,
        byteSize: Number(artifact.byteSize),
        sha256: artifact.sha256,
        dataClass: artifact.dataClass,
        trustLevel: artifact.trustLevel,
        storedTrustLevel: artifact.storedTrustLevel,
        provenance: jsonObject(artifact.provenance),
        content: artifact.content,
      }));
    } catch (error) {
      for (const artifact of loaded) artifact.content.fill(0);
      throw error;
    }
  }

  private erpCapabilities(objective: string, user: AuthUser): ReasoningCapability[] {
    const registry = buildRegistry(
      this.manifest.capabilities(),
      user.permissions,
      this.msaidizi.allowedTiers,
    );
    const selected =
      registry.length <= MSAIDIZI_REASONING_LIMITS.maxErpCapabilities
        ? registry
        : entriesForCapabilities(
            registry,
            narrowCapabilities(
              registry.map((entry) => entry.capability),
              objective,
              {
                limit: MSAIDIZI_REASONING_LIMITS.maxErpCapabilities,
                floor: 15,
              },
            ).map((capability) => capability.id),
          );

    return selected.map((entry) => {
      const expectedEffect = erpCapabilityEffect(entry.capability) as MsaidiziEffect;
      const read = expectedEffect === MsaidiziEffect.READ;
      return {
        target: MsaidiziExecutionTarget.ERP,
        capability: entry.capability.id,
        capabilityVersion: '1',
        description: entry.tool.description,
        expectedEffect,
        dataClass: 'internal',
        mutation: !read,
        idempotent: read,
        argumentsSchema: planningArgumentsSchema(entry),
        recoveryKind: read
          ? 'NotApplicable'
          : entry.capability.tier === 'red'
            ? 'Irreversible'
            : 'CompensatingAction',
        permissions: [...entry.capability.permissions],
        anyPermissions: [...entry.capability.anyPermissions],
      };
    });
  }

  private async resolveMandate(
    mandateId: string | undefined,
    companyId: string | null,
    user: AuthUser,
  ): Promise<ReasoningMandateContext | null> {
    if (!mandateId) return null;
    const principal = await this.prisma.msaidiziPrincipal.findUnique({
      where: { key: this.autonomy.principalKey },
      select: { id: true },
    });
    if (!principal) return null;
    const now = new Date();
    const mandate = await this.prisma.msaidiziMandate.findFirst({
      where: {
        id: mandateId,
        principalId: principal.id,
        createdByUserId: user.id,
        status: MsaidiziMandateStatus.ACTIVE,
        ...(companyId === null
          ? { companyId: null }
          : { OR: [{ companyId: null }, { companyId }] }),
        AND: [
          { OR: [{ startsAt: null }, { startsAt: { lte: now } }] },
          { OR: [{ expiresAt: null }, { expiresAt: { gt: now } }] },
        ],
      },
      select: { id: true, capabilities: true, deviceIds: true, budgets: true },
    });
    if (!mandate) return null;
    return {
      id: mandate.id,
      principalId: principal.id,
      deviceIds: stringArray(mandate.deviceIds),
      capabilities: mandateGrants(mandate.capabilities),
      budgets: budgetObject(mandate.budgets),
    };
  }

  private async hostCapabilities(
    objective: string,
    mandate: ReasoningMandateContext | null,
    requestedDeviceId?: string,
  ): Promise<ReasoningCapability[]> {
    if (!mandate) return [];
    const eligibleIds = requestedDeviceId ? [requestedDeviceId] : mandate.deviceIds;
    if (eligibleIds.length === 0) return [];
    const devices = await this.prisma.msaidiziDevice.findMany({
      where: {
        id: { in: eligibleIds },
        principalId: mandate.principalId,
        status: MsaidiziDeviceStatus.ACTIVE,
      },
      select: { id: true, name: true, capabilityManifest: true },
    });
    const capabilities: ReasoningCapability[] = [];
    for (const device of devices) {
      const manifest = jsonObject(device.capabilityManifest);
      const manifestSha256 = stringValue(manifest.manifestSha256);
      for (const raw of arrayValue(manifest.capabilities)) {
        const descriptor = jsonObject(raw);
        const capability = stringValue(descriptor.id);
        const capabilityVersion = stringValue(descriptor.version);
        if (
          !capability ||
          !capabilityVersion ||
          isSupervisorBoundaryCapability(capability) ||
          isUnavailableHostFileContentCapability(capability)
        ) {
          continue;
        }
        let expectedEffect: MsaidiziEffect;
        let dataClass: string;
        let recoveryKind: string;
        try {
          expectedEffect = capabilityEffect(descriptor.effect as string | number) as MsaidiziEffect;
          dataClass = capabilityDataClass(descriptor.dataClass as string | number);
          recoveryKind = capabilityRecovery(descriptor.recovery as string | number);
        } catch {
          continue;
        }
        if (
          descriptor.touchesTrustedRoot === true ||
          !grantAllows(
            mandate.capabilities,
            capability,
            capabilityVersion,
            expectedEffect,
            dataClass,
          )
        ) {
          continue;
        }
        const schema = jsonObject(descriptor.argumentsSchema);
        if (schema.type !== 'object' || schema.additionalProperties !== false) continue;
        capabilities.push({
          target: MsaidiziExecutionTarget.HOST,
          capability,
          capabilityVersion,
          description: sanitizePersistedValue(stringValue(descriptor.description) ?? capability)
            .value,
          expectedEffect,
          dataClass,
          mutation: expectedEffect !== MsaidiziEffect.READ,
          idempotent:
            expectedEffect === MsaidiziEffect.READ ||
            descriptor.idempotency === 'Supported' ||
            descriptor.idempotency === 'Required' ||
            descriptor.idempotency === 1 ||
            descriptor.idempotency === 2,
          argumentsSchema: schema,
          recoveryKind,
          permissions: [],
          anyPermissions: [],
          deviceId: device.id,
          deviceName: sanitizePersistedValue(device.name).value,
          ...(manifestSha256 && { manifestSha256 }),
          touchesTrustedRoot: false,
        });
      }
    }

    return capabilities
      .map((capability) => ({ capability, score: lexicalScore(objective, capability) }))
      .sort(
        (left, right) =>
          right.score - left.score ||
          left.capability.capability.localeCompare(right.capability.capability) ||
          (left.capability.deviceId ?? '').localeCompare(right.capability.deviceId ?? ''),
      )
      .slice(0, MSAIDIZI_REASONING_LIMITS.maxHostCapabilities)
      .map((entry) => entry.capability);
  }

  private selfImprovementCapabilities(
    mode: MsaidiziTaskMode,
    mandate: ReasoningMandateContext | null,
  ): ReasoningCapability[] {
    if (mode !== MsaidiziTaskMode.AUTOPILOT || !mandate) return [];
    return UPDATE_CANDIDATE_PROPOSAL_SCOPES.flatMap((scope) => {
      const dataClass = proposalDataClass(scope);
      const explicitlyGranted = mandate.capabilities.some(
        (grant) =>
          grant.capability === UPDATE_CANDIDATE_PROPOSAL_CAPABILITY &&
          grant.version === UPDATE_CANDIDATE_GENERATION_CAPABILITY_VERSION &&
          grant.effects.includes(MsaidiziEffect.WRITE) &&
          grant.dataClasses.includes(dataClass),
      );
      if (!explicitlyGranted) return [];
      return [
        {
          target: MsaidiziExecutionTarget.SELF_IMPROVEMENT,
          capability: UPDATE_CANDIDATE_PROPOSAL_CAPABILITY,
          capabilityVersion: UPDATE_CANDIDATE_GENERATION_CAPABILITY_VERSION,
          description: `Generate a bounded ${scope.toLowerCase()} update for isolated evaluation; this proposes only and cannot approve or deploy`,
          expectedEffect: MsaidiziEffect.WRITE,
          dataClass,
          mutation: true,
          idempotent: true,
          argumentsSchema: generatedUpdateProposalArgumentsSchema(scope),
          recoveryKind: 'SnapshotRollback',
          permissions: [],
          anyPermissions: [],
          touchesTrustedRoot: false,
        },
      ];
    });
  }
}

export function isSupervisorBoundaryCapability(capability: string): boolean {
  const normalized = capability.toLowerCase();
  return SUPERVISOR_BOUNDARY_PREFIXES.some((prefix) => normalized.startsWith(prefix));
}

function draftProposalAuthority(draft: {
  id: string;
  principalId: string;
  initiatedByUserId: string;
  companyId: string | null;
  mandateId: string | null;
  mode: MsaidiziTaskMode;
  stateVersion: number;
}): MsaidiziDraftProposalAuthority {
  return {
    taskId: draft.id,
    principalId: draft.principalId,
    initiatedByUserId: draft.initiatedByUserId,
    companyId: draft.companyId,
    mandateId: draft.mandateId,
    mode: draft.mode,
    stateVersion: draft.stateVersion,
  };
}

function entriesForCapabilities(entries: RegistryEntry[], ids: string[]): RegistryEntry[] {
  const byId = new Map(entries.map((entry) => [entry.capability.id, entry]));
  return ids.map((id) => byId.get(id)).filter((entry): entry is RegistryEntry => Boolean(entry));
}

function resolveBudgets(
  requested: MsaidiziTaskBudgetDto | undefined,
  autonomy: AutonomyConfig,
  mandate?: Partial<ReasoningBudget>,
): { budgets: ReasoningBudget; violations: PolicyViolation[] } {
  const ceiling = autonomy.budgetCeilings;
  const deployment: ReasoningBudget = {
    maxWallTimeSeconds: ceiling.maxWallTimeSeconds,
    maxModelTurns: ceiling.maxModelTurns,
    maxAttemptedToolCalls: ceiling.maxAttemptedToolCalls,
    maxMutations: ceiling.maxMutations,
    maxLocalBytes: Number(ceiling.maxLocalBytes),
    maxExternalEgressBytes: Number(ceiling.maxExternalEgressBytes),
    maxModelCostUsd: ceiling.maxModelCostUsd,
  };
  const violations: PolicyViolation[] = [];
  const result = {} as ReasoningBudget;
  for (const key of Object.keys(deployment) as Array<keyof ReasoningBudget>) {
    const explicit = requested?.[key];
    const deploymentLimit = deployment[key];
    const mandateLimit = mandate?.[key];
    if (explicit !== undefined && explicit > deploymentLimit) {
      violations.push({
        code: 'DEPLOYMENT_BUDGET_EXCEEDED',
        message: `${key} exceeds the deployment-owned ceiling`,
      });
    }
    if (explicit !== undefined && mandateLimit !== undefined && explicit > mandateLimit) {
      violations.push({
        code: 'MANDATE_BUDGET_EXCEEDED',
        message: `${key} exceeds the active mandate ceiling`,
      });
    }
    result[key] = explicit ?? Math.min(deploymentLimit, mandateLimit ?? deploymentLimit);
  }
  return { budgets: result, violations };
}

function sameReasoningBudgets(
  expected: ReasoningBudget,
  actual: Partial<ReasoningBudget>,
): boolean {
  return (Object.keys(actual) as Array<keyof ReasoningBudget>).every(
    (key) => actual[key] === undefined || Math.abs(expected[key] - actual[key]!) < 0.0000001,
  );
}

function mandateGrants(value: Prisma.JsonValue): MandateCapabilityGrant[] {
  return arrayValue(value).flatMap((raw) => {
    const grant = jsonObject(raw);
    const capability = stringValue(grant.capability);
    if (!capability) return [];
    const effects = stringArray(grant.effects).filter((effect): effect is MsaidiziEffect =>
      Object.values(MsaidiziEffect).includes(effect as MsaidiziEffect),
    );
    const dataClasses = stringArray(grant.dataClasses);
    if (effects.length === 0 || dataClasses.length === 0) return [];
    return [
      {
        capability,
        ...(stringValue(grant.version) && { version: stringValue(grant.version) }),
        effects,
        dataClasses,
        ...(stringArray(grant.externalDestinationAuthorities).length > 0 && {
          externalDestinationAuthorities: stringArray(grant.externalDestinationAuthorities),
        }),
      },
    ];
  });
}

function budgetObject(value: Prisma.JsonValue): Partial<ReasoningBudget> {
  const raw = jsonObject(value);
  const result: Partial<ReasoningBudget> = {};
  for (const key of [
    'maxWallTimeSeconds',
    'maxModelTurns',
    'maxAttemptedToolCalls',
    'maxMutations',
    'maxLocalBytes',
    'maxExternalEgressBytes',
    'maxModelCostUsd',
  ] as const) {
    const item = raw[key];
    if (typeof item === 'number' && Number.isFinite(item) && item >= 0) result[key] = item;
  }
  return result;
}

function grantAllows(
  grants: MandateCapabilityGrant[],
  capability: string,
  version: string,
  effect: MsaidiziEffect,
  dataClass: string,
): boolean {
  return grants.some(
    (grant) =>
      grant.capability === capability &&
      (grant.version === undefined || grant.version === version) &&
      grant.effects.includes(effect) &&
      grant.dataClasses.includes(dataClass),
  );
}

function lexicalScore(objective: string, capability: ReasoningCapability): number {
  const wanted = tokenize(objective);
  const available = tokenize(`${capability.capability} ${capability.description}`);
  let score = 0;
  for (const token of wanted) if (available.has(token)) score += 1;
  return score;
}

function jsonObject(value: unknown): JsonObject {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as JsonObject) : {};
}

function arrayValue(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function stringArray(value: unknown): string[] {
  return arrayValue(value).filter((item): item is string => typeof item === 'string');
}

function stringValue(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function boundedCapabilityBytes(
  capabilities: ReasoningCapability[],
  maximumBytes: number,
): ReasoningCapability[] {
  const selected: ReasoningCapability[] = [];
  let used = 2;
  for (const capability of capabilities) {
    const bytes = Buffer.byteLength(JSON.stringify(capability), 'utf8') + 1;
    if (bytes > maximumBytes - used) continue;
    selected.push(capability);
    used += bytes;
  }
  return selected;
}

function assertByteLimit(value: unknown, maximumBytes: number, message: string): void {
  if (Buffer.byteLength(JSON.stringify(value), 'utf8') > maximumBytes) {
    throw new PayloadTooLargeException(message);
  }
}
