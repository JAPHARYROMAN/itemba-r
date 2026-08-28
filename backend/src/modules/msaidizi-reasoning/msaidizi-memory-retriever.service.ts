import { ConflictException, Injectable, ServiceUnavailableException } from '@nestjs/common';
import {
  MsaidiziMandateStatus,
  MsaidiziMemoryKind,
  MsaidiziTaskStatus,
  MsaidiziTrustLevel,
  Prisma,
} from '@prisma/client';
import { AuthUser } from '../../common/decorators/current-user.decorator';
import { EncryptionService } from '../../common/services';
import { accessibleCompanyIdsFromUser } from '../../common/services/company-scope.service';
import { sanitizePersistedValue } from '../../common/utils/persistent-secret-redaction';
import { PrismaService } from '../../prisma/prisma.service';
import {
  MSAIDIZI_MEMORY_RETRIEVAL_PROFILE,
  scoreMemoryRelevance,
} from '../msaidizi-memory/msaidizi-memory-semantics';
import {
  GovernedRuntimeMemoryScope,
  MSAIDIZI_RUNTIME_MEMORY_VERSION,
  runtimeMemoryScopeDigest,
  runtimeMemoryScopeKey,
  sha256,
} from '../msaidizi-memory/msaidizi-runtime-memory-scope';
import { AutonomyConfig } from '../msaidizi-tasks/autonomy.config';
import { MSAIDIZI_REASONING_LIMITS } from './msaidizi-reasoning.limits';
import { RetrievedReasoningMemory } from './msaidizi-reasoning.types';

export interface MemoryRetrievalRequest {
  objective: string;
  companyId: string | null;
  scopeKeys?: string[];
  user: AuthUser;
  runtimeAuthority?: RuntimeMemoryRetrievalAuthority;
}

export interface RuntimeMemoryRetrievalAuthority {
  taskId: string;
  principalId: string;
  initiatedByUserId: string;
  companyId: string | null;
  mandateId: string | null;
  deviceId: string | null;
  stateVersion: number;
}

export abstract class MsaidiziMemoryRetriever {
  abstract retrieve(request: MemoryRetrievalRequest): Promise<RetrievedReasoningMemory[]>;
}

/**
 * Caller/company-scoped hybrid concept retrieval over encrypted durable memory.
 * Runtime-authored records additionally require a live exact draft authority
 * and exact mandate/device scope. Human memory semantics remain unchanged.
 */
@Injectable()
export class ScopedMsaidiziMemoryRetriever extends MsaidiziMemoryRetriever {
  constructor(
    private readonly prisma: PrismaService,
    private readonly encryption: EncryptionService,
    private readonly autonomy: AutonomyConfig,
  ) {
    super();
  }

  async retrieve(request: MemoryRetrievalRequest): Promise<RetrievedReasoningMemory[]> {
    const principal = await this.prisma.msaidiziPrincipal.findUnique({
      where: { key: this.autonomy.principalKey },
      select: { id: true },
    });
    if (!principal) return [];

    const accessibleIds = new Set(accessibleCompanyIdsFromUser(request.user));
    if (request.companyId && !accessibleIds.has(request.companyId)) return [];
    const runtimeAuthority = request.runtimeAuthority;
    const runtimeAuthorityValid = runtimeAuthority
      ? await this.validateRuntimeAuthority(runtimeAuthority, principal.id, request.user)
      : false;
    const companyScope: Prisma.MsaidiziMemoryWhereInput = request.companyId
      ? { OR: [{ companyId: null }, { companyId: request.companyId }] }
      : { companyId: null };
    const requestedScope = request.scopeKeys?.length ? new Set(request.scopeKeys) : null;
    const humanScope: Prisma.MsaidiziMemoryWhereInput = {
      sourceTaskId: null,
      AND: [companyScope, ...(requestedScope ? [{ scopeKey: { in: [...requestedScope] } }] : [])],
    };
    const runtimeKeys =
      runtimeAuthority && runtimeAuthorityValid
        ? allowedRuntimeScopeKeys(runtimeAuthority).filter(
            (scopeKey) => !requestedScope || requestedScope.has(scopeKey),
          )
        : [];
    const visibility: Prisma.MsaidiziMemoryWhereInput[] = [humanScope];
    if (runtimeAuthority && runtimeAuthorityValid && runtimeKeys.length > 0) {
      visibility.push({
        sourceTaskId: { not: null },
        companyId: runtimeAuthority.companyId,
        scopeKey: { in: runtimeKeys },
        sourceTask: {
          is: {
            principalId: runtimeAuthority.principalId,
            initiatedByUserId: runtimeAuthority.initiatedByUserId,
            companyId: runtimeAuthority.companyId,
            mandateId: runtimeAuthority.mandateId,
            status: { in: [...RUNTIME_SOURCE_STATUSES] },
          },
        },
      });
    }

    const rows = await this.prisma.msaidiziMemory.findMany({
      where: {
        principalId: principal.id,
        createdByUserId: request.user.id,
        deletedAt: null,
        AND: [{ OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }] }],
        OR: visibility,
      },
      select: {
        id: true,
        principalId: true,
        companyId: true,
        sourceTaskId: true,
        createdByUserId: true,
        kind: true,
        scopeKey: true,
        contentCiphertext: true,
        contentDigest: true,
        trustLevel: true,
        sourceProvenance: true,
        metadata: true,
        updatedAt: true,
        sourceTask: {
          select: {
            principalId: true,
            initiatedByUserId: true,
            companyId: true,
            mandateId: true,
            status: true,
          },
        },
      },
      orderBy: { updatedAt: 'desc' },
      take: MSAIDIZI_REASONING_LIMITS.maxMemoryCandidates,
    });

    const visibleRows = rows.filter(
      (row) =>
        !row.sourceTaskId ||
        (runtimeAuthorityValid &&
          runtimeAuthority !== undefined &&
          verifiedRuntimeRow(row, runtimeAuthority)),
    );
    const memories = visibleRows.map((row) => {
      let plaintext: string;
      try {
        plaintext = this.encryption.decrypt(row.contentCiphertext);
      } catch {
        throw new ServiceUnavailableException(
          'A scoped memory failed integrity verification; proposal generation stopped',
        );
      }
      if (row.sourceTaskId && sha256(plaintext) !== row.contentDigest) {
        throw new ServiceUnavailableException(
          'A runtime memory failed provenance verification; proposal generation stopped',
        );
      }
      const sanitizedContent = sanitizePersistedValue(plaintext);
      if (row.sourceTaskId && sanitizedContent.redactionsApplied) {
        throw new ServiceUnavailableException(
          'A runtime memory was rejected by the secret-persistence boundary',
        );
      }
      const content = sanitizedContent.value.slice(0, MSAIDIZI_REASONING_LIMITS.maxMemoryCharsEach);
      const provenance = sanitizedObject(row.sourceProvenance);
      const sourceType =
        typeof provenance.sourceType === 'string' ? provenance.sourceType.toUpperCase() : 'UNKNOWN';
      // Trust is an internal attestation, never a caller-selected label. Public
      // memory writes are server-stamped USER/UNTRUSTED and cannot set these
      // verification fields. Legacy, external, or corrupted rows are therefore
      // downgraded before the planner's authority phase.
      const trustLevel =
        row.trustLevel === MsaidiziTrustLevel.TRUSTED && authorityProvenanceVerified(provenance)
          ? MsaidiziTrustLevel.TRUSTED
          : MsaidiziTrustLevel.UNTRUSTED;
      const relevance = scoreMemoryRelevance(
        request.objective,
        `${row.scopeKey} ${JSON.stringify(row.metadata)} ${content.slice(0, 2_000)}`,
      );
      return {
        score: relevance.score,
        updatedAt: row.updatedAt,
        value: {
          id: row.id,
          scopeKey: sanitizePersistedValue(row.scopeKey).value,
          content,
          contentDigest: row.contentDigest,
          trustLevel,
          sourceType,
          sourceProvenance: provenance,
        } satisfies RetrievedReasoningMemory,
      };
    });

    if (
      runtimeAuthority &&
      runtimeAuthorityValid &&
      !(await this.validateRuntimeAuthority(runtimeAuthority, principal.id, request.user))
    ) {
      throw new ConflictException('Task draft authority changed during memory retrieval');
    }

    return memories
      .sort(
        (left, right) =>
          right.score - left.score || right.updatedAt.getTime() - left.updatedAt.getTime(),
      )
      .slice(0, MSAIDIZI_REASONING_LIMITS.maxMemories)
      .map((entry) => entry.value);
  }

  private async validateRuntimeAuthority(
    authority: RuntimeMemoryRetrievalAuthority,
    principalId: string,
    user: AuthUser,
  ): Promise<boolean> {
    if (authority.principalId !== principalId || authority.initiatedByUserId !== user.id) {
      return false;
    }
    const task = await this.prisma.msaidiziTask.findFirst({
      where: {
        id: authority.taskId,
        principalId,
        principal: { key: this.autonomy.principalKey, status: 'ACTIVE' },
        initiatedByUserId: user.id,
        companyId: authority.companyId,
        mandateId: authority.mandateId,
        status: MsaidiziTaskStatus.PLANNING,
        statusDetail: null,
        activePlanVersion: 0,
        stateVersion: authority.stateVersion,
        proposalUsageId: null,
        scheduleId: null,
        mutations: 0,
        attemptedToolCalls: 0,
        executedToolCalls: 0,
        modelTurns: 0,
        inputTokens: 0n,
        outputTokens: 0n,
        modelCostUsd: 0,
        planVersions: { none: {} },
        steps: { none: {} },
        toolAttempts: { none: {} },
        deviceLeases: { none: {} },
        hostActions: { none: {} },
      },
      select: { id: true },
    });
    if (!task) return false;
    if (!authority.mandateId) return authority.deviceId === null;
    const now = new Date();
    const mandate = await this.prisma.msaidiziMandate.findFirst({
      where: {
        id: authority.mandateId,
        principalId,
        createdByUserId: user.id,
        companyId: authority.companyId,
        status: MsaidiziMandateStatus.ACTIVE,
        AND: [
          { OR: [{ startsAt: null }, { startsAt: { lte: now } }] },
          { OR: [{ expiresAt: null }, { expiresAt: { gt: now } }] },
        ],
      },
      select: { deviceIds: true },
    });
    if (!mandate) return false;
    return !authority.deviceId || stringArray(mandate.deviceIds).includes(authority.deviceId);
  }
}

function sanitizedObject(value: Prisma.JsonValue): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return sanitizePersistedValue(value).value as Record<string, unknown>;
}

function authorityProvenanceVerified(provenance: Record<string, unknown>): boolean {
  return (
    (provenance.sourceType === 'TASK' || provenance.sourceType === 'SYSTEM') &&
    provenance.authorityVerified === true &&
    provenance.verificationVersion === 1 &&
    typeof provenance.sourceId === 'string' &&
    provenance.sourceId.length > 0
  );
}

const RUNTIME_SOURCE_STATUSES = [
  MsaidiziTaskStatus.COMPLETED,
  MsaidiziTaskStatus.PARTIAL,
  MsaidiziTaskStatus.FAILED,
  MsaidiziTaskStatus.CANCELLED,
  MsaidiziTaskStatus.NEEDS_ATTENTION,
] as const;

interface RuntimeCandidateRow {
  principalId: string;
  companyId: string | null;
  sourceTaskId: string | null;
  createdByUserId: string | null;
  kind: MsaidiziMemoryKind;
  scopeKey: string;
  contentDigest: string;
  trustLevel: MsaidiziTrustLevel;
  sourceProvenance: Prisma.JsonValue;
  metadata: Prisma.JsonValue;
  sourceTask: {
    principalId: string;
    initiatedByUserId: string | null;
    companyId: string | null;
    mandateId: string | null;
    status: MsaidiziTaskStatus;
  } | null;
}

function allowedRuntimeScopeKeys(authority: RuntimeMemoryRetrievalAuthority): string[] {
  const deviceScopes = authority.deviceId ? [null, authority.deviceId] : [null];
  return deviceScopes.flatMap((deviceId) =>
    Object.values(MsaidiziMemoryKind).map((kind) =>
      runtimeMemoryScopeKey(kind, { ...authority, deviceId }),
    ),
  );
}

function verifiedRuntimeRow(
  row: RuntimeCandidateRow,
  authority: RuntimeMemoryRetrievalAuthority,
): boolean {
  if (!row.sourceTaskId || !row.sourceTask) return false;
  const provenance = sanitizedObject(row.sourceProvenance);
  const metadata = sanitizedObject(row.metadata);
  const source = row.sourceTask;
  const provenanceDeviceId = nullableString(provenance.deviceId);
  const allowedDevice = provenanceDeviceId === null || provenanceDeviceId === authority.deviceId;
  const scope: GovernedRuntimeMemoryScope = {
    principalId: source.principalId,
    initiatedByUserId: source.initiatedByUserId ?? '',
    companyId: source.companyId,
    mandateId: source.mandateId,
    deviceId: provenanceDeviceId,
  };
  return (
    allowedDevice &&
    row.principalId === authority.principalId &&
    row.createdByUserId === authority.initiatedByUserId &&
    row.companyId === authority.companyId &&
    source.principalId === authority.principalId &&
    source.initiatedByUserId === authority.initiatedByUserId &&
    source.companyId === authority.companyId &&
    source.mandateId === authority.mandateId &&
    RUNTIME_SOURCE_STATUSES.includes(source.status as (typeof RUNTIME_SOURCE_STATUSES)[number]) &&
    row.scopeKey === runtimeMemoryScopeKey(row.kind, scope) &&
    provenance.sourceType === 'TASK' &&
    provenance.sourceId === row.sourceTaskId &&
    provenance.authorityVerified === true &&
    provenance.verificationVersion === 1 &&
    provenance.runtimeMemoryVersion === MSAIDIZI_RUNTIME_MEMORY_VERSION &&
    provenance.instructionAuthority === false &&
    provenance.principalId === scope.principalId &&
    provenance.initiatedByUserId === scope.initiatedByUserId &&
    nullableString(provenance.companyId) === scope.companyId &&
    nullableString(provenance.mandateId) === scope.mandateId &&
    metadata.runtimeMemoryVersion === MSAIDIZI_RUNTIME_MEMORY_VERSION &&
    metadata.retrievalProfile === MSAIDIZI_MEMORY_RETRIEVAL_PROFILE &&
    metadata.instructionAuthority === false &&
    provenance.scopeDigest ===
      runtimeMemoryScopeDigest(row.sourceTaskId, row.kind, row.contentDigest, scope)
  );
}

function nullableString(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string')
    : [];
}
