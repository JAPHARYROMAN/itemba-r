import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
  PayloadTooLargeException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  AuditChannel,
  AuditSeverity,
  MsaidiziArtifactKind,
  MsaidiziPrincipalStatus,
  MsaidiziTaskMode,
  MsaidiziTaskStatus,
  MsaidiziTaskStepStatus,
  MsaidiziToolAttemptStatus,
  MsaidiziTrustedArtifactPurpose,
  MsaidiziTrustLevel,
  Prisma,
} from '@prisma/client';
import { createCipheriv, createDecipheriv, createHash, randomBytes, randomUUID } from 'node:crypto';
import { createReadStream, createWriteStream, promises as fs, ReadStream } from 'node:fs';
import path from 'node:path';
import { Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { AuthUser } from '../../common/decorators/current-user.decorator';
import {
  companyWhereForUser,
  isGroupScopedUser,
} from '../../common/services/company-scope.service';
import {
  redactPersistedSecrets,
  sanitizePersistedValue,
} from '../../common/utils/persistent-secret-redaction';
import { PrismaService } from '../../prisma/prisma.service';
import {
  ArtifactAttestationClaims,
  CanonicalAttestation,
  isGeneratedEvaluationBinding,
} from '../msaidizi-updates/msaidizi-evaluator-attestation.protocol';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { stepLocalIoState } from '../msaidizi-task-runtime/msaidizi-step-controls';
import { MsaidiziEvaluatorKeyRegistry } from '../msaidizi-updates/msaidizi-evaluator-key-registry.service';
import {
  assertUpdateCandidateProposalStep,
  GENERATED_UPDATE_POLICY_VERSION,
  GENERATED_UPDATE_PROTECTED_PATH_POLICY_SHA256,
  isGeneratedUpdateCandidateProposal,
  mandateAuthorizesUpdateCandidateProposal,
} from '../msaidizi-updates/update-candidate-proposal.port';
import type { HostFileObservationBinding } from '../msaidizi-devices/host-file-observation';
import {
  isUnavailableHostFileContentCapability,
  REASONING_FILE_EPHEMERAL_CHANNEL_NOT_READY,
} from '../msaidizi-devices/host-file-ephemerality.policy';
import type {
  HostActionArtifactMaterialization,
  HostActionArtifactMaterializationRequest,
} from '../msaidizi-tasks/msaidizi-input-bindings';
import { CreateMsaidiziArtifactDto, QueryMsaidiziArtifactDto } from './dto/msaidizi-artifact.dto';
import { AdaptiveHostFileExtension, AdaptiveHostFileMimeType } from './host-file-content-policy';

const ARTIFACT_MAGIC = Buffer.from('MSA1', 'ascii');
const IV_BYTES = 12;
const TAG_BYTES = 16;
const HEADER_BYTES = ARTIFACT_MAGIC.length + IV_BYTES;

export interface DecryptedArtifact {
  stream: ReadStream | Transform;
  mimeType: string;
  name: string;
  byteSize: bigint;
  sha256: string;
  /** Broker-observed transfer counters the evaluator must include in later cumulative heartbeats. */
  evaluationUsageFloor?: {
    bytesRead: bigint;
    externalEgressBytes: bigint;
  };
}

export interface ReasoningArtifactContent {
  id: string;
  taskId: string;
  kind: string;
  name: string;
  mimeType: string;
  byteSize: bigint;
  sha256: string;
  dataClass: string;
  /** Always UNTRUSTED at the model boundary, regardless of storage metadata. */
  trustLevel: 'UNTRUSTED';
  storedTrustLevel: string;
  provenance: Prisma.JsonValue;
  content: Buffer;
}

/** Immutable authority coordinates captured while resolving a PLANNING draft. */
export interface DraftReasoningAuthority {
  taskId: string;
  principalId: string;
  initiatedByUserId: string;
  companyId: string | null;
  mandateId: string | null;
  mode: MsaidiziTaskMode;
  stateVersion: number;
}

export interface AdaptiveReasoningImageBinding {
  taskId: string;
  planVersionId: string;
  planVersion: number;
  stepId: string;
  attemptId: string;
  artifactId: string;
  capability: 'screen.primary.capture' | 'camera.photo.capture';
  mimeType: 'image/png' | 'image/jpeg';
  sha256: string;
  byteSize: number;
  dataClass: string;
}

export interface AdaptiveReasoningFileBinding {
  taskId: string;
  planVersionId: string;
  planVersion: number;
  stepId: string;
  attemptId: string;
  artifactId: string;
  capability: 'filesystem.file.read';
  mimeType: AdaptiveHostFileMimeType;
  extension: AdaptiveHostFileExtension;
  sha256: string;
  byteSize: number;
  dataClass: string;
  /** Digest of the immutable, reviewed filesystem.file.read arguments. */
  argsDigest: string;
  /** Hash of the managed root and canonical relative path; the raw path is never persisted. */
  sourceIdentifierHash: string;
}

type GeneratedArtifactEvaluationRun = Prisma.MsaidiziUpdateEvaluationRunGetPayload<{
  include: { step: true; candidate: true };
}>;

type TrustedArtifactAuthorityTask = Prisma.MsaidiziTaskGetPayload<{
  include: { principal: true; mandate: true };
}>;

interface ReasoningArtifactRow {
  id: string;
  taskId: string;
  kind: MsaidiziArtifactKind;
  name: string;
  mimeType: string;
  storageKey: string;
  sha256: string;
  byteSize: bigint;
  encrypted: boolean;
  dataClass: string;
  trustLevel: MsaidiziTrustLevel;
  provenance: Prisma.JsonValue;
  step: StepLocalIoRow | null;
  task: {
    initiatedByUserId: string | null;
    bytesRead: bigint;
    bytesWritten: bigint;
    externalEgressBytes: bigint;
    reservedExternalEgressBytes: bigint;
    maxLocalBytes: bigint;
    maxExternalEgressBytes: bigint;
  };
}

export interface ToolObservationArtifactInput {
  taskId: string;
  stepId: string;
  attemptId: string;
  dataClass: string;
  sourceType: 'ERP_RESULT' | 'HOST_RESULT' | 'UPDATE_GENERATION';
  sourceSha256: string;
  sourceBytes: number;
  persistedSha256: string;
  persistedBytes: number;
  redactionsApplied: boolean;
  /**
   * Caller-owned redacted JSON or validated media buffer. Raw JSON tool
   * output is never accepted here; host media is bound to an exact capability.
   */
  content: Buffer;
  /** Mutually exclusive with `file`; enforced again at the runtime trust boundary. */
  media?: HostObservationMediaBinding;
  /** Mutually exclusive with `media`; enforced again at the runtime trust boundary. */
  file?: HostFileObservationBinding;
  /**
   * Host-local usage can be committed with the deterministic result artifact.
   * This closes the crash window between artifact persistence and host-action
   * settlement. ERP results leave both values absent because their read
   * reservation has already been reconciled by the task worker.
   */
  accountedLocalBytesRead?: bigint;
  accountedLocalBytesWritten?: bigint;
}

/**
 * Opaque, process-local preparation returned before an observation is
 * published. The public fields are sufficient to build a result reference;
 * the encrypted payload and commit state remain in a private WeakMap so a
 * caller cannot forge a publishable handle.
 */
export interface PreparedToolObservationArtifact {
  readonly artifact: Readonly<{
    id: string;
    sha256: string;
    mimeType: string;
    kind: MsaidiziArtifactKind;
    trustLevel: MsaidiziTrustLevel;
  }>;
  readonly replay: boolean;
}

type ToolObservationArtifactMetadata = Omit<ToolObservationArtifactInput, 'content'>;

type PreparedToolObservationPhase =
  | 'PREPARED'
  | 'COMMITTING'
  | 'COMMIT_SUCCEEDED'
  | 'COMMIT_FAILED'
  | 'FINISHED';

interface PreparedToolObservationState {
  owner: object;
  artifactId: string;
  storageKey: string;
  input: ToolObservationArtifactMetadata;
  descriptor: ReturnType<typeof toolObservationDescriptor>;
  artifactData: Prisma.MsaidiziArtifactUncheckedCreateInput | null;
  replayResult: Record<string, unknown> | null;
  encryptedEnvelope: Buffer | null;
  encryptedEnvelopeSha256: string | null;
  destination: string | null;
  wroteFile: boolean;
  phase: PreparedToolObservationPhase;
  finishedCommitted: boolean | null;
}

interface StepLocalIoRow {
  id: string;
  taskId: string;
  budgets: Prisma.JsonValue;
  bytesRead: bigint;
  bytesWritten: bigint;
  localIoAccountingValid: boolean;
  status: MsaidiziTaskStepStatus;
}

export type HostObservationMediaBinding =
  | { capability: 'screen.primary.capture'; mimeType: 'image/png' }
  | { capability: 'camera.photo.capture'; mimeType: 'image/jpeg' }
  | { capability: 'audio.microphone.capture'; mimeType: 'audio/wav' }
  | { capability: 'speech.text.synthesize'; mimeType: 'audio/wav' };

const MAX_REASONING_ARTIFACTS = 5;
const MAX_REASONING_ARTIFACT_BYTES = 12 * 1024 * 1024;
export const MAX_HOST_ACTION_ARTIFACT_BYTES = 128 * 1024;
const REASONING_MIME_TYPES = new Set([
  'application/json',
  'application/pdf',
  'image/gif',
  'image/jpeg',
  'image/png',
  'image/webp',
  'text/csv',
  'text/markdown',
  'text/plain',
]);
const UPDATE_ARCHIVE_MIME_TYPES = new Set([
  'application/gzip',
  'application/octet-stream',
  'application/x-tar',
  'application/zip',
]);
const MAX_TRUSTED_UPDATE_BYTES = 250 * 1024 * 1024;
const MAX_TRUSTED_REPORT_BYTES = 16 * 1024 * 1024;
const MAX_TOOL_OBSERVATION_BYTES = 16 * 1024 * 1024;
const TOOL_OBSERVATION_TASK_STATUSES = [
  MsaidiziTaskStatus.RUNNING,
  MsaidiziTaskStatus.PAUSING,
  MsaidiziTaskStatus.CANCELLING,
] as const;
const preparedToolObservationStates = new WeakMap<
  PreparedToolObservationArtifact,
  PreparedToolObservationState
>();

/**
 * Encrypted, task-scoped artifact storage.
 *
 * The encryption key is deployment-owned and never stored beside an artifact.
 * Each object receives a random AES-256-GCM IV and is addressed by a server-only
 * UUID. User supplied names never participate in a filesystem path.
 */
@Injectable()
export class MsaidiziArtifactsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly evaluatorKeys: MsaidiziEvaluatorKeyRegistry,
    private readonly audit: AuditLogsService,
  ) {}

  async upload(
    file: Express.Multer.File | undefined,
    dto: CreateMsaidiziArtifactDto,
    user: AuthUser,
  ) {
    if (!file) throw new BadRequestException('Artifact file is required');
    let destination: string | undefined;
    let encrypted = false;
    try {
      this.assertEnabled();
      const key = this.encryptionKey();
      const task = await this.scopedTask(dto.taskId, user);
      const step = dto.stepId
        ? await this.prisma.msaidiziTaskStep.findFirst({
            where: { id: dto.stepId, taskId: task.id },
            select: stepLocalIoSelect,
          })
        : null;
      if (dto.stepId && !step) {
        throw new BadRequestException('Artifact step does not belong to task');
      }
      if (
        step &&
        (step.status === MsaidiziTaskStepStatus.LEASED ||
          step.status === MsaidiziTaskStepStatus.RUNNING)
      ) {
        throw new ConflictException('Cannot attach a human artifact while the step is executing');
      }

      const byteSize = BigInt(file.size);
      if (task.bytesRead + task.bytesWritten + byteSize > task.maxLocalBytes) {
        throw new ConflictException('Task local I/O budget would be exceeded');
      }

      const storageKey = `${randomUUID()}.msa`;
      destination = await this.storagePath(storageKey);
      const sha256 = await encryptFile(file.path, destination, key);
      encrypted = true;
      const artifact = await this.prisma.$transaction(async (tx) => {
        const budget = await tx.msaidiziTask.updateMany({
          where: {
            id: task.id,
            initiatedByUserId: user.id,
            bytesRead: task.bytesRead,
            bytesWritten: task.bytesWritten,
          },
          data: { bytesWritten: { increment: byteSize }, lastCheckpointAt: new Date() },
        });
        if (budget.count !== 1) throw new ConflictException('Task budget changed; retry upload');
        if (step) await reserveStepLocalIo(tx, step, 0n, byteSize);
        const created = await tx.msaidiziArtifact.create({
          data: {
            taskId: task.id,
            stepId: dto.stepId ?? null,
            kind: dto.kind,
            name: redactPersistedSecrets(dto.name),
            mimeType: safeMimeType(file.mimetype),
            storageKey,
            sha256,
            byteSize,
            encrypted: true,
            dataClass: redactPersistedSecrets(dto.dataClass),
            trustLevel: MsaidiziTrustLevel.UNTRUSTED,
            provenance: persistedJson({
              ...dto.provenance,
              uploadSource: 'human',
              initiatedByUserId: user.id,
            }),
          },
        });
        await tx.msaidiziTaskEvent.create({
          data: {
            taskId: task.id,
            type: 'artifact.created',
            actorType: 'HUMAN',
            actorId: user.id,
            payload: {
              artifactId: created.id,
              stepId: dto.stepId ?? null,
              kind: dto.kind,
              byteSize: byteSize.toString(),
              sha256,
            },
          },
        });
        return created;
      });
      return jsonSafe(artifact);
    } catch (error) {
      if (encrypted && destination) {
        await fs.rm(destination, { force: true }).catch(() => undefined);
      }
      throw error;
    } finally {
      await fs.rm(file.path, { force: true }).catch(() => undefined);
    }
  }

  /**
   * Promotes a large, already-redacted tool observation to encrypted storage.
   * The artifact ID is deterministic per attempt/content so worker replay is
   * idempotent and can never double-charge the task's local-I/O budget.
   */
  async ingestToolObservation(input: ToolObservationArtifactInput) {
    const prepared = await this.prepareToolObservation(input);
    if (prepared.replay) {
      const replayResult = this.preparedToolObservationState(prepared).replayResult;
      await this.finishPreparedToolObservation(prepared, true);
      if (!replayResult) {
        throw new ConflictException('Prepared tool observation replay is unavailable');
      }
      return replayResult;
    }

    let committed = false;
    try {
      const result = await this.prisma.$transaction((tx) =>
        this.commitPreparedToolObservation(tx, prepared),
      );
      committed = true;
      return result;
    } catch (error) {
      const state = this.preparedToolObservationState(prepared);
      const racedReplay = await this.toolObservationReplay(state.artifactId, state.input).catch(
        () => null,
      );
      if (racedReplay) return racedReplay;
      await this.prisma.msaidiziTaskStep
        .updateMany({
          where: { id: input.stepId, taskId: input.taskId },
          data: { localIoAccountingValid: false, checkpointedAt: new Date() },
        })
        .catch(() => undefined);
      throw error;
    } finally {
      await this.finishPreparedToolObservation(prepared, committed);
    }
  }

  /**
   * Validates and encrypts an observation in memory without publishing a file,
   * charging a budget, creating a row, or emitting an event. A caller can use
   * the immutable preview in a host-result summary before attempting its own
   * settlement CAS.
   */
  async prepareToolObservation(
    input: ToolObservationArtifactInput,
  ): Promise<PreparedToolObservationArtifact> {
    this.assertEnabled();
    if (input.file != null) {
      throw new BadRequestException(REASONING_FILE_EPHEMERAL_CHANNEL_NOT_READY);
    }
    const descriptor = toolObservationDescriptor(input);
    const accountedLocalBytesRead = input.accountedLocalBytesRead ?? 0n;
    const accountedLocalBytesWritten = input.accountedLocalBytesWritten ?? 0n;
    if (
      input.content.length <= 0 ||
      input.content.length > MAX_TOOL_OBSERVATION_BYTES ||
      input.persistedBytes !== input.content.length ||
      !Number.isSafeInteger(input.sourceBytes) ||
      input.sourceBytes < 0 ||
      !isSha256(input.sourceSha256) ||
      !isSha256(input.persistedSha256) ||
      createHash('sha256').update(input.content).digest('hex') !== input.persistedSha256 ||
      (input.media != null && !mediaSignatureMatches(input.content, input.media.mimeType)) ||
      accountedLocalBytesRead < 0n ||
      accountedLocalBytesWritten < 0n ||
      (input.sourceType !== 'HOST_RESULT' &&
        (accountedLocalBytesRead !== 0n || accountedLocalBytesWritten !== 0n))
    ) {
      throw new BadRequestException('Tool observation artifact metadata is invalid');
    }

    const artifactId = deterministicObservationArtifactId(input);
    const replay = await this.toolObservationReplay(artifactId, input);
    const metadata = Object.freeze({
      taskId: input.taskId,
      stepId: input.stepId,
      attemptId: input.attemptId,
      dataClass: input.dataClass,
      sourceType: input.sourceType,
      sourceSha256: input.sourceSha256,
      sourceBytes: input.sourceBytes,
      persistedSha256: input.persistedSha256,
      persistedBytes: input.persistedBytes,
      redactionsApplied: input.redactionsApplied,
      ...(input.media ? { media: Object.freeze({ ...input.media }) } : {}),
      ...(input.accountedLocalBytesRead === undefined
        ? {}
        : { accountedLocalBytesRead: input.accountedLocalBytesRead }),
      ...(input.accountedLocalBytesWritten === undefined
        ? {}
        : { accountedLocalBytesWritten: input.accountedLocalBytesWritten }),
    }) as ToolObservationArtifactMetadata;
    if (replay) {
      const artifact = preparedArtifactPreview(replay.artifact);
      const prepared = Object.freeze({ artifact, replay: true });
      preparedToolObservationStates.set(prepared, {
        owner: this,
        artifactId,
        storageKey: `${artifactId}.msa`,
        input: metadata,
        descriptor,
        artifactData: null,
        replayResult: replay,
        encryptedEnvelope: null,
        encryptedEnvelopeSha256: null,
        destination: null,
        wroteFile: false,
        phase: 'PREPARED',
        finishedCommitted: null,
      });
      return prepared;
    }
    const context = await this.prisma.msaidiziToolAttempt.findFirst({
      where: {
        id: input.attemptId,
        taskId: input.taskId,
        stepId: input.stepId,
        status: MsaidiziToolAttemptStatus.RUNNING,
      },
      include: {
        step: { select: stepLocalIoSelect },
        task: {
          select: {
            status: true,
            bytesRead: true,
            bytesWritten: true,
            maxLocalBytes: true,
          },
        },
      },
    });
    if (
      !context ||
      !TOOL_OBSERVATION_TASK_STATUSES.includes(
        context.task.status as (typeof TOOL_OBSERVATION_TASK_STATUSES)[number],
      )
    ) {
      throw new ConflictException('Tool observation attempt is no longer running');
    }
    const byteSize = BigInt(input.content.length);
    const totalTaskRead = accountedLocalBytesRead;
    const totalTaskWritten = byteSize + accountedLocalBytesWritten;
    if (
      context.task.bytesRead + context.task.bytesWritten + totalTaskRead + totalTaskWritten >
      context.task.maxLocalBytes
    ) {
      throw new ConflictException('Task local I/O budget would be exceeded');
    }

    const storageKey = `${artifactId}.msa`;
    const key = this.encryptionKey();
    let encryptedEnvelope: Buffer;
    try {
      const encrypted = encryptBufferInMemory(input.content, key);
      encryptedEnvelope = encrypted.envelope;
      const sha256 = encrypted.sha256;
      if (sha256 !== input.persistedSha256) {
        encryptedEnvelope.fill(0);
        throw new BadRequestException('Tool observation content digest changed before storage');
      }
    } finally {
      key.fill(0);
    }

    const artifactData: Prisma.MsaidiziArtifactUncheckedCreateInput = {
      id: artifactId,
      taskId: input.taskId,
      stepId: input.stepId,
      kind: descriptor.kind,
      name: descriptor.name,
      mimeType: descriptor.mimeType,
      storageKey,
      sha256: input.persistedSha256,
      byteSize,
      encrypted: true,
      dataClass: redactPersistedSecrets(input.dataClass),
      trustLevel: MsaidiziTrustLevel.UNTRUSTED,
      provenance: persistedJson({
        uploadSource: 'tool-observation',
        attemptId: input.attemptId,
        sourceType: input.sourceType,
        sourceSha256: input.sourceSha256,
        sourceBytes: input.sourceBytes,
        persistedSha256: input.persistedSha256,
        persistedBytes: input.persistedBytes,
        redactionsApplied: input.redactionsApplied,
        accountedLocalBytesRead: accountedLocalBytesRead.toString(),
        accountedLocalBytesWritten: accountedLocalBytesWritten.toString(),
        capability: descriptor.capability,
        mimeType: descriptor.mimeType,
        extension: descriptor.extension,
        argumentsSha256: descriptor.argumentsSha256,
        sourceIdentifierSha256: descriptor.sourceIdentifierHash,
        trustLevel: 'UNTRUSTED',
      }),
    };
    const artifact = preparedArtifactPreview(artifactData);
    const prepared = Object.freeze({ artifact, replay: false });
    preparedToolObservationStates.set(prepared, {
      owner: this,
      artifactId,
      storageKey,
      input: metadata,
      descriptor,
      artifactData,
      replayResult: null,
      encryptedEnvelope,
      encryptedEnvelopeSha256: createHash('sha256').update(encryptedEnvelope).digest('hex'),
      destination: null,
      wroteFile: false,
      phase: 'PREPARED',
      finishedCommitted: null,
    });
    return prepared;
  }

  /**
   * Publishes a prepared observation through the caller's transaction. Every
   * database mutation and event uses `tx`; callers must invoke this only after
   * winning the host-action settlement CAS in that same transaction.
   */
  async commitPreparedToolObservation(
    tx: Prisma.TransactionClient,
    prepared: PreparedToolObservationArtifact,
  ): Promise<Record<string, unknown>> {
    const state = this.preparedToolObservationState(prepared);
    if (state.phase !== 'PREPARED') {
      throw new ConflictException('Prepared tool observation has already been committed');
    }
    state.phase = 'COMMITTING';
    try {
      await this.lockToolObservationArtifact(tx, state.artifactId);
      const racedReplay = await this.toolObservationReplay(state.artifactId, state.input, tx);
      if (racedReplay) {
        state.replayResult = racedReplay;
        state.phase = 'COMMIT_SUCCEEDED';
        return racedReplay;
      }
      if (state.replayResult) {
        throw new ConflictException('Prepared tool observation replay disappeared');
      }
      if (!state.artifactData || !state.encryptedEnvelope) {
        throw new ConflictException('Prepared tool observation payload is unavailable');
      }
      const context = await tx.msaidiziToolAttempt.findFirst({
        where: {
          id: state.input.attemptId,
          taskId: state.input.taskId,
          stepId: state.input.stepId,
          status: MsaidiziToolAttemptStatus.RUNNING,
        },
        include: {
          step: { select: stepLocalIoSelect },
          task: {
            select: {
              status: true,
              bytesRead: true,
              bytesWritten: true,
              maxLocalBytes: true,
            },
          },
        },
      });
      if (
        !context ||
        !TOOL_OBSERVATION_TASK_STATUSES.includes(
          context.task.status as (typeof TOOL_OBSERVATION_TASK_STATUSES)[number],
        )
      ) {
        throw new ConflictException('Tool observation attempt is no longer running');
      }
      const byteSize = BigInt(state.input.persistedBytes);
      const accountedLocalBytesRead = state.input.accountedLocalBytesRead ?? 0n;
      const accountedLocalBytesWritten = state.input.accountedLocalBytesWritten ?? 0n;
      const totalTaskRead = accountedLocalBytesRead;
      const totalTaskWritten = byteSize + accountedLocalBytesWritten;
      if (
        context.task.bytesRead + context.task.bytesWritten + totalTaskRead + totalTaskWritten >
        context.task.maxLocalBytes
      ) {
        throw new ConflictException('Task local I/O budget would be exceeded');
      }

      const destination = await this.storagePath(state.storageKey);
      state.destination = destination;
      await removeSerializedArtifactOrphan(destination);
      await writeNewFileDurably(destination, state.encryptedEnvelope);
      state.wroteFile = true;

      const budget = await tx.msaidiziTask.updateMany({
        where: {
          id: state.input.taskId,
          status: { in: [...TOOL_OBSERVATION_TASK_STATUSES] },
          bytesRead: context.task.bytesRead,
          bytesWritten: context.task.bytesWritten,
          toolAttempts: {
            some: {
              id: state.input.attemptId,
              stepId: state.input.stepId,
              status: MsaidiziToolAttemptStatus.RUNNING,
            },
          },
        },
        data: {
          bytesRead: { increment: totalTaskRead },
          bytesWritten: { increment: totalTaskWritten },
          lastCheckpointAt: new Date(),
        },
      });
      if (budget.count !== 1) {
        throw new ConflictException('Task or tool-attempt state changed during artifact storage');
      }
      await reserveStepLocalIo(
        tx,
        context.step,
        accountedLocalBytesRead,
        byteSize + accountedLocalBytesWritten,
      );
      const created = await tx.msaidiziArtifact.create({ data: state.artifactData });
      await tx.msaidiziTaskEvent.create({
        data: {
          taskId: state.input.taskId,
          type: 'artifact.tool_observation_created',
          actorType: 'SERVICE',
          payload: {
            artifactId: state.artifactId,
            stepId: state.input.stepId,
            attemptId: state.input.attemptId,
            byteSize: byteSize.toString(),
            sha256: state.input.persistedSha256,
            kind: state.descriptor.kind,
            mimeType: state.descriptor.mimeType,
            capability: state.descriptor.capability,
            extension: state.descriptor.extension,
            argumentsSha256: state.descriptor.argumentsSha256,
            sourceIdentifierSha256: state.descriptor.sourceIdentifierHash,
            trustLevel: 'UNTRUSTED',
          },
        },
      });
      state.phase = 'COMMIT_SUCCEEDED';
      return jsonSafe({ artifact: created, replay: false });
    } catch (error) {
      state.phase = 'COMMIT_FAILED';
      throw error;
    }
  }

  /**
   * Completes the lifecycle after the caller's outer transaction resolves.
   * A rollback or lost CAS removes only the file written by this opaque handle;
   * committed/replayed artifacts are retained. Repeating the same finish is a
   * no-op, while contradictory completion claims fail closed.
   */
  async finishPreparedToolObservation(
    prepared: PreparedToolObservationArtifact,
    committed: boolean,
  ): Promise<void> {
    const state = this.preparedToolObservationState(prepared);
    if (state.phase === 'FINISHED') {
      if (state.finishedCommitted !== committed) {
        throw new ConflictException('Prepared tool observation finish state conflicts');
      }
      return;
    }
    if (state.phase === 'COMMITTING') {
      throw new ConflictException('Prepared tool observation commit is still running');
    }
    if (committed && state.phase !== 'COMMIT_SUCCEEDED' && !state.replayResult) {
      throw new ConflictException('Prepared tool observation was not committed');
    }
    try {
      if (!committed && state.wroteFile && state.destination) {
        await this.prisma.$transaction(async (tx) => {
          await this.lockToolObservationArtifact(tx, state.artifactId);
          const existing = await this.toolObservationReplay(state.artifactId, state.input, tx);
          if (existing) return;
          await removeOwnedArtifactFile(state.destination!, state.encryptedEnvelopeSha256);
        });
        state.wroteFile = false;
      }
    } finally {
      state.encryptedEnvelope?.fill(0);
      state.encryptedEnvelope = null;
    }
    state.phase = 'FINISHED';
    state.finishedCommitted = committed;
  }

  /**
   * Creates a new TRUSTED artifact from verifier-signed evidence. This method
   * has no update branch: ordinary UNTRUSTED rows can never be promoted.
   */
  async ingestTrustedUpdateArtifact(
    file: Express.Multer.File | undefined,
    attestation: CanonicalAttestation<ArtifactAttestationClaims>,
  ) {
    if (!file) throw new BadRequestException('Trusted artifact file is required');
    const claims = attestation.claims;
    let destination: string | undefined;
    let encrypted = false;
    try {
      this.assertEnabled();
      const verificationClock = await this.databaseNow();
      this.evaluatorKeys.verify(attestation, 'ARTIFACT_VERIFIER', verificationClock);
      const earlyReplay = await this.trustedArtifactReplay(claims.artifactId, attestation);
      if (earlyReplay) return earlyReplay;

      const maximum =
        claims.artifactPurpose === 'REPORT' ? MAX_TRUSTED_REPORT_BYTES : MAX_TRUSTED_UPDATE_BYTES;
      if (
        file.size <= 0 ||
        file.size > maximum ||
        BigInt(file.size).toString() !== claims.byteSize ||
        safeMimeType(file.mimetype) !== claims.mimeType ||
        !trustedMimeAllowed(claims.artifactPurpose, claims.mimeType)
      ) {
        throw new BadRequestException(
          'Trusted artifact size or media type does not match evidence',
        );
      }

      const context = await this.trustedArtifactContext(claims);
      const storageKey = `${randomUUID()}.msa`;
      destination = await this.storagePath(storageKey);
      const actualSha256 = await encryptFile(file.path, destination, this.encryptionKey());
      encrypted = true;
      if (actualSha256 !== claims.sha256) {
        throw new BadRequestException('Trusted artifact content digest does not match evidence');
      }

      const created = await this.prisma.$transaction(async (tx) => {
        let lockedCandidate: {
          id: string;
          principalId: string;
          taskId: string | null;
        } | null = null;
        if (context.generatedEvaluationRun) {
          const candidateLocks = await tx.$queryRaw<
            Array<{ id: string; principalId: string; taskId: string | null }>
          >`
            SELECT "id", "principalId", "proposedByTaskId" AS "taskId"
            FROM "msaidizi_update_candidates"
            WHERE "id" = ${context.generatedEvaluationRun.candidateId}
              AND "status" = 'EVALUATING'
            FOR UPDATE
          `;
          if (candidateLocks.length !== 1) {
            throw new ConflictException('Generated evaluation candidate is no longer eligible');
          }
          lockedCandidate = candidateLocks[0];
          if (
            lockedCandidate.principalId !== context.principalId ||
            lockedCandidate.taskId !== claims.taskId
          ) {
            throw new ConflictException('Generated evaluation candidate authority changed');
          }
        }
        const principalLocks = await tx.$queryRaw<
          Array<{ id: string; status: MsaidiziPrincipalStatus }>
        >`
          SELECT "id", "status"
          FROM "msaidizi_principals"
          WHERE "id" = ${context.principalId}
          FOR SHARE
        `;
        if (
          principalLocks.length !== 1 ||
          principalLocks[0].status !== MsaidiziPrincipalStatus.ACTIVE
        ) {
          throw new ConflictException('Trusted artifact principal is no longer active');
        }
        const taskLocks = await tx.$queryRaw<
          Array<{ id: string; principalId: string; mandateId: string | null }>
        >`
          SELECT "id", "principalId", "mandateId"
          FROM "msaidizi_tasks"
          WHERE "id" = ${claims.taskId}
            AND "principalId" = ${context.principalId}
          FOR UPDATE
        `;
        if (taskLocks.length !== 1 || !taskLocks[0].mandateId) {
          throw new ConflictException('Trusted artifact task is no longer eligible');
        }
        const mandateLocks = await tx.$queryRaw<Array<{ id: string }>>`
          SELECT "id"
          FROM "msaidizi_mandates"
          WHERE "id" = ${taskLocks[0].mandateId}
            AND "principalId" = ${context.principalId}
          FOR SHARE
        `;
        if (mandateLocks.length !== 1) {
          throw new ConflictException('Trusted artifact mandate is no longer eligible');
        }
        const stepLocks = await tx.$queryRaw<Array<{ id: string }>>`
          SELECT "id"
          FROM "msaidizi_task_steps"
          WHERE "id" = ${claims.stepId}
            AND "taskId" = ${claims.taskId}
            AND "planVersionId" = ${claims.planVersionId}
          FOR UPDATE
        `;
        if (stepLocks.length !== 1) {
          throw new ConflictException('Trusted artifact step is no longer eligible');
        }
        const liveTask = await tx.msaidiziTask.findUnique({
          where: { id: claims.taskId },
          include: { principal: true, mandate: true },
        });
        if (!liveTask || !trustedArtifactTaskStatus(liveTask.status)) {
          throw new ConflictException('Trusted artifact task is no longer eligible');
        }
        const byteSize = BigInt(claims.byteSize);
        let generatedReservation:
          | {
              run: GeneratedArtifactEvaluationRun;
            }
          | undefined;
        if (context.generatedEvaluationRun) {
          const runLocks = await tx.$queryRaw<Array<{ id: string }>>`
            SELECT "id" FROM "msaidizi_update_evaluation_runs"
            WHERE "id" = ${context.generatedEvaluationRun.id} FOR UPDATE
          `;
          if (runLocks.length !== 1) {
            throw new ConflictException('Generated evaluation artifact budget is unavailable');
          }
          const run = await tx.msaidiziUpdateEvaluationRun.findUnique({
            where: { id: context.generatedEvaluationRun.id },
            include: { step: true, candidate: true },
          });
          const now = await this.transactionDatabaseNow(tx);
          this.evaluatorKeys.verify(attestation, 'ARTIFACT_VERIFIER', now);
          if (
            !this.autonomousEvaluationExecutionAllowed() ||
            !run ||
            !lockedCandidate ||
            !this.generatedArtifactReservationAllowed(
              run,
              liveTask,
              lockedCandidate,
              context.generatedEvaluationRun.candidateId,
              byteSize,
              now,
            )
          ) {
            throw new ConflictException('Generated evaluation artifact budget is unavailable');
          }
          generatedReservation = { run };
        } else {
          const now = await this.transactionDatabaseNow(tx);
          this.evaluatorKeys.verify(attestation, 'ARTIFACT_VERIFIER', now);
          if (liveTask.bytesRead + liveTask.bytesWritten + byteSize > liveTask.maxLocalBytes) {
            throw new ConflictException('Task local I/O budget would be exceeded');
          }
          const reserved = await tx.msaidiziTask.updateMany({
            where: {
              id: claims.taskId,
              status: liveTask.status,
              bytesRead: liveTask.bytesRead,
              bytesWritten: liveTask.bytesWritten,
            },
            data: { bytesWritten: { increment: byteSize }, lastCheckpointAt: now },
          });
          if (reserved.count !== 1) throw new ConflictException('Task budget changed');
          const liveStep = await tx.msaidiziTaskStep.findFirst({
            where: { id: claims.stepId, taskId: claims.taskId },
            select: stepLocalIoSelect,
          });
          if (!liveStep) throw new ConflictException('Trusted artifact step changed');
          await reserveStepLocalIo(tx, liveStep, 0n, byteSize);
        }

        const artifact = await tx.msaidiziArtifact.create({
          data: {
            id: claims.artifactId,
            taskId: claims.taskId,
            stepId: claims.stepId,
            kind: MsaidiziArtifactKind.FILE,
            name: claims.name,
            mimeType: claims.mimeType,
            storageKey,
            sha256: claims.sha256,
            byteSize,
            encrypted: true,
            dataClass: claims.dataClass,
            trustLevel: MsaidiziTrustLevel.TRUSTED,
            trustedPurpose: claims.artifactPurpose as MsaidiziTrustedArtifactPurpose,
            provenance: persistedJson({
              uploadSource: 'signed-update-verifier',
              claimsDigest: attestation.claimsDigest,
              signerKeyId: claims.signerKeyId,
              evaluationRunId: claims.evaluationRunId,
              cleanSnapshotId: claims.cleanSnapshotId,
              toolchainVersions: claims.toolchainVersions,
            }),
          },
        });
        await tx.msaidiziTrustedArtifactEvidence.create({
          data: {
            artifactId: artifact.id,
            taskId: claims.taskId,
            planVersionId: claims.planVersionId,
            stepId: claims.stepId,
            candidateId: claims.candidateId,
            purpose: claims.artifactPurpose as MsaidiziTrustedArtifactPurpose,
            signerKeyId: claims.signerKeyId,
            claimsDigest: attestation.claimsDigest,
            nonce: claims.nonce,
            canonicalClaims: JSON.parse(attestation.claimsJson) as Prisma.InputJsonObject,
            signature: attestation.signature,
            evaluationRunId: claims.evaluationRunId,
            cleanSnapshotId: claims.cleanSnapshotId,
            toolchainVersions: claims.toolchainVersions,
            issuedAt: new Date(claims.issuedAt),
            expiresAt: new Date(claims.expiresAt),
          },
        });
        const evidence = persistedJson({
          artifactId: artifact.id,
          purpose: claims.artifactPurpose,
          sha256: claims.sha256,
          byteSize: claims.byteSize,
          claimsDigest: attestation.claimsDigest,
          signerKeyId: claims.signerKeyId,
          planVersionId: claims.planVersionId,
          stepId: claims.stepId,
          candidateId: claims.candidateId,
        }) as Prisma.InputJsonObject;
        await tx.msaidiziTaskEvent.create({
          data: {
            taskId: claims.taskId,
            type: 'artifact.trusted_ingested',
            actorType: 'VERIFIER',
            actorId: claims.signerKeyId,
            payload: evidence,
          },
        });
        await this.audit.logStrictInTransaction(tx, {
          action: 'MSAIDIZI_TRUSTED_ARTIFACT_INGESTED',
          entityType: 'MsaidiziArtifact',
          entityId: artifact.id,
          userId: context.initiatedByUserId ?? undefined,
          companyId: context.companyId,
          newValue: evidence,
          severity: AuditSeverity.HIGH,
          channel: AuditChannel.AGENT,
          agentSessionId: `task_${claims.taskId.replace(/-/g, '')}`,
          principalType: 'VERIFIER',
          principalId: claims.signerKeyId,
          mandateId: context.mandateId ?? undefined,
          initiatedByUserId: context.initiatedByUserId ?? undefined,
          taskId: claims.taskId,
          stepId: claims.stepId,
        });
        if (generatedReservation && lockedCandidate && context.generatedEvaluationRun) {
          // Artifact/evidence inserts may wait on uniqueness locks. Refresh the
          // database clock only after those waits, then make the exact run
          // reservation the final transaction gate so every earlier write rolls
          // back if principal, mandate, lease, wall time, or budget has expired.
          const now = await this.transactionDatabaseNow(tx);
          this.evaluatorKeys.verify(attestation, 'ARTIFACT_VERIFIER', now);
          const run = generatedReservation.run;
          if (
            !this.autonomousEvaluationExecutionAllowed() ||
            !this.generatedArtifactReservationAllowed(
              run,
              liveTask,
              lockedCandidate,
              context.generatedEvaluationRun.candidateId,
              byteSize,
              now,
            )
          ) {
            throw new ConflictException('Generated evaluation artifact budget is unavailable');
          }
          const runWon = await tx.msaidiziUpdateEvaluationRun.updateMany({
            where: {
              id: run.id,
              status: 'RUNNING',
              leaseId: run.leaseId,
              leaseGeneration: run.leaseGeneration,
              leaseExpiresAt: run.leaseExpiresAt,
              deadlineAt: run.deadlineAt,
              startedAt: run.startedAt,
              usedCpuTimeSeconds: run.usedCpuTimeSeconds,
              usedBytesRead: run.usedBytesRead,
              usedBytesWritten: run.usedBytesWritten,
              usedExternalEgressBytes: run.usedExternalEgressBytes,
              usedModelTurns: run.usedModelTurns,
              usedModelInputTokens: run.usedModelInputTokens,
              usedModelOutputTokens: run.usedModelOutputTokens,
              usedModelCostMicrousd: run.usedModelCostMicrousd,
              candidate: {
                id: lockedCandidate.id,
                principalId: lockedCandidate.principalId,
                status: 'EVALUATING',
                principal: { status: MsaidiziPrincipalStatus.ACTIVE },
              },
              task: {
                id: liveTask.id,
                principalId: lockedCandidate.principalId,
                status: { in: [MsaidiziTaskStatus.RUNNING, MsaidiziTaskStatus.COMPLETED] },
                principal: { status: MsaidiziPrincipalStatus.ACTIVE },
              },
            },
            data: { usedBytesWritten: { increment: byteSize } },
          });
          if (runWon.count !== 1) {
            throw new ConflictException('Generated evaluation artifact usage changed');
          }
        }
        return artifact;
      });
      return jsonSafe({ artifact: created, replay: false, claimsDigest: attestation.claimsDigest });
    } catch (error) {
      if (encrypted && destination) {
        await fs.rm(destination, { force: true }).catch(() => undefined);
      }
      const replay = await this.trustedArtifactReplay(claims.artifactId, attestation).catch(
        () => null,
      );
      if (replay) return replay;
      throw error;
    } finally {
      await fs.rm(file.path, { force: true }).catch(() => undefined);
    }
  }

  async list(query: QueryMsaidiziArtifactDto, user: AuthUser) {
    await this.scopedTask(query.taskId, user);
    return jsonSafe(
      await this.prisma.msaidiziArtifact.findMany({
        where: {
          taskId: query.taskId,
          ...(query.stepId ? { stepId: query.stepId } : {}),
          ...(query.kind ? { kind: query.kind } : {}),
        },
        select: {
          id: true,
          taskId: true,
          stepId: true,
          kind: true,
          name: true,
          mimeType: true,
          sha256: true,
          byteSize: true,
          encrypted: true,
          dataClass: true,
          trustLevel: true,
          provenance: true,
          createdAt: true,
        },
        orderBy: { createdAt: 'desc' },
      }),
    );
  }

  /**
   * Decrypt a bounded set for one ephemeral multimodal reasoning request.
   *
   * This is not a general download shortcut: it keeps caller/task scope,
   * reserves local-read and cloud-egress budgets before opening ciphertext,
   * requires every artifact to belong to the same source task, and refuses
   * media that the configured model path cannot consume safely. Audio must be
   * transcribed locally and attached as text; raw audio never leaves here.
   */
  async readForReasoning(ids: string[], user: AuthUser): Promise<ReasoningArtifactContent[]> {
    return this.readScopedForReasoning(ids, user);
  }

  /**
   * Opens task-level draft attachments only when every artifact belongs to the
   * exact caller-owned task that will receive the reviewed plan. The task ID is
   * present in both the artifact lookup and the budget reservation predicate so
   * a valid artifact from another caller-owned task cannot be decrypted or
   * charged while planning this draft.
   */
  async readDraftForReasoning(
    authority: DraftReasoningAuthority,
    ids: string[],
    user: AuthUser,
  ): Promise<ReasoningArtifactContent[]> {
    return this.readScopedForReasoning(ids, user, authority);
  }

  private async readScopedForReasoning(
    ids: string[],
    user: AuthUser,
    draftAuthority?: DraftReasoningAuthority,
  ): Promise<ReasoningArtifactContent[]> {
    this.assertEnabled();
    const uniqueIds = Array.from(new Set(ids));
    if (uniqueIds.length === 0) return [];
    if (uniqueIds.length !== ids.length || uniqueIds.length > MAX_REASONING_ARTIFACTS) {
      throw new BadRequestException(
        `Reasoning accepts 1-${MAX_REASONING_ARTIFACTS} distinct artifact IDs`,
      );
    }
    const rows = await this.prisma.msaidiziArtifact.findMany({
      where: {
        id: { in: uniqueIds },
        ...(draftAuthority
          ? {
              taskId: draftAuthority.taskId,
              stepId: null,
              trustLevel: MsaidiziTrustLevel.UNTRUSTED,
            }
          : {}),
        task: {
          initiatedByUserId: user.id,
          ...taskCompanyScope(user),
          ...(draftAuthority && draftReasoningTaskScope(draftAuthority)),
        },
      },
      include: {
        step: { select: stepLocalIoSelect },
        task: {
          select: {
            initiatedByUserId: true,
            bytesRead: true,
            bytesWritten: true,
            externalEgressBytes: true,
            reservedExternalEgressBytes: true,
            maxLocalBytes: true,
            maxExternalEgressBytes: true,
          },
        },
      },
    });
    if (rows.length !== uniqueIds.length)
      throw new NotFoundException('Reasoning artifact not found');
    const byId = new Map(rows.map((row) => [row.id, row]));
    const ordered = uniqueIds.map((id) => byId.get(id)!);
    const taskIds = new Set(ordered.map((row) => row.taskId));
    if (taskIds.size !== 1) {
      throw new BadRequestException('Reasoning artifacts must belong to one source task');
    }
    return this.reserveAndLoadReasoningArtifacts(ordered, {
      initiatedByUserId: user.id,
      ...taskCompanyScope(user),
      ...(draftAuthority && draftReasoningTaskScope(draftAuthority)),
    });
  }

  /**
   * Opens only the native image produced by the exact, already-settled host
   * attempt that triggered an adaptive checkpoint. This internal path does not
   * grant general artifact access: the current AUTOPILOT task, immutable plan,
   * succeeded step/attempt, media capability, ciphertext metadata and
   * UNTRUSTED provenance must all agree before the normal reasoning budgets are
   * charged and plaintext is opened.
   */
  async readSettledImageForAdaptiveReasoning(
    binding: AdaptiveReasoningImageBinding,
  ): Promise<ReasoningArtifactContent> {
    this.assertEnabled();
    const expectedMimeType =
      binding.capability === 'screen.primary.capture' ? 'image/png' : 'image/jpeg';
    if (
      binding.mimeType !== expectedMimeType ||
      !isSha256(binding.sha256) ||
      !Number.isSafeInteger(binding.byteSize) ||
      binding.byteSize <= 0 ||
      binding.byteSize > MAX_REASONING_ARTIFACT_BYTES
    ) {
      throw new BadRequestException('Adaptive image binding is invalid');
    }
    const artifact = await this.prisma.msaidiziArtifact.findFirst({
      where: {
        id: binding.artifactId,
        taskId: binding.taskId,
        stepId: binding.stepId,
        kind: MsaidiziArtifactKind.SCREENSHOT,
        mimeType: binding.mimeType,
        sha256: binding.sha256,
        byteSize: BigInt(binding.byteSize),
        encrypted: true,
        dataClass: binding.dataClass,
        trustLevel: MsaidiziTrustLevel.UNTRUSTED,
        task: {
          mode: MsaidiziTaskMode.AUTOPILOT,
          status: MsaidiziTaskStatus.RUNNING,
          activePlanVersion: binding.planVersion,
          hostExecutionAllowed: true,
        },
        step: {
          is: {
            id: binding.stepId,
            taskId: binding.taskId,
            planVersionId: binding.planVersionId,
            status: MsaidiziTaskStepStatus.SUCCEEDED,
            toolAttempts: {
              some: {
                id: binding.attemptId,
                taskId: binding.taskId,
                status: MsaidiziToolAttemptStatus.SUCCEEDED,
              },
            },
          },
        },
      },
      include: {
        step: { select: stepLocalIoSelect },
        task: {
          select: {
            initiatedByUserId: true,
            bytesRead: true,
            bytesWritten: true,
            externalEgressBytes: true,
            reservedExternalEgressBytes: true,
            maxLocalBytes: true,
            maxExternalEgressBytes: true,
          },
        },
      },
    });
    if (!artifact) throw new NotFoundException('Adaptive image artifact not found');
    if (!adaptiveImageProvenanceMatches(artifact.provenance, binding)) {
      throw new BadRequestException('Adaptive image provenance does not match its host attempt');
    }
    const [loaded] = await this.reserveAndLoadReasoningArtifacts([artifact], {
      mode: MsaidiziTaskMode.AUTOPILOT,
      status: MsaidiziTaskStatus.RUNNING,
      activePlanVersion: binding.planVersion,
      hostExecutionAllowed: true,
      steps: {
        some: {
          id: binding.stepId,
          planVersionId: binding.planVersionId,
          status: MsaidiziTaskStepStatus.SUCCEEDED,
          toolAttempts: {
            some: {
              id: binding.attemptId,
              status: MsaidiziToolAttemptStatus.SUCCEEDED,
            },
          },
        },
      },
    });
    return loaded;
  }

  /** Legacy encrypted file observations are quarantined from model access. */
  async readSettledFileForAdaptiveReasoning(
    binding: AdaptiveReasoningFileBinding,
  ): Promise<ReasoningArtifactContent> {
    void binding;
    throw new ServiceUnavailableException(REASONING_FILE_EPHEMERAL_CHANNEL_NOT_READY);
  }

  /**
   * Opens a small dependency artifact only for the exact active host attempt
   * named by an immutable input binding. The returned Base64 is ephemeral: the
   * caller puts it in the broker-signed action payload and must never persist it
   * in arguments, events, journals, resume state, or provenance.
   */
  async materializeForHostAction(
    binding: HostActionArtifactMaterializationRequest,
  ): Promise<HostActionArtifactMaterialization> {
    this.assertEnabled();
    assertHostActionArtifactBinding(binding);
    const target = await this.prisma.msaidiziTaskStep.findFirst({
      where: {
        id: binding.targetStepId,
        taskId: binding.taskId,
        planVersionId: binding.planVersionId,
        status: MsaidiziTaskStepStatus.RUNNING,
        task: {
          mode: MsaidiziTaskMode.AUTOPILOT,
          status: MsaidiziTaskStatus.RUNNING,
          hostExecutionAllowed: true,
        },
        toolAttempts: {
          some: {
            id: binding.targetAttemptId,
            taskId: binding.taskId,
            stepId: binding.targetStepId,
            status: {
              in: [MsaidiziToolAttemptStatus.REQUESTED, MsaidiziToolAttemptStatus.RUNNING],
            },
          },
        },
      },
      include: {
        planVersion: { select: { version: true } },
        task: {
          select: {
            activePlanVersion: true,
            bytesRead: true,
            bytesWritten: true,
            maxLocalBytes: true,
          },
        },
      },
    });
    if (!target || target.planVersion.version !== target.task.activePlanVersion) {
      throw new ConflictException('Host artifact target attempt is not active');
    }
    const preconditions = jsonRecord(target.preconditions);
    if (preconditions.deviceId !== binding.deviceId) {
      throw new ConflictException('Host artifact device scope does not match the target step');
    }

    const artifact = await this.prisma.msaidiziArtifact.findFirst({
      where: {
        id: binding.artifactId,
        taskId: binding.taskId,
        stepId: binding.sourceStepId,
        sha256: binding.sha256,
        byteSize: BigInt(binding.byteSize),
        mimeType: binding.mimeType,
        name: binding.name,
        kind: binding.kind as MsaidiziArtifactKind,
        dataClass: binding.dataClass,
        encrypted: true,
        trustLevel: MsaidiziTrustLevel.UNTRUSTED,
        step: {
          is: {
            id: binding.sourceStepId,
            taskId: binding.taskId,
            planVersionId: binding.planVersionId,
            status: MsaidiziTaskStepStatus.SUCCEEDED,
            toolAttempts: {
              some: {
                id: binding.sourceAttemptId,
                taskId: binding.taskId,
                stepId: binding.sourceStepId,
                status: MsaidiziToolAttemptStatus.SUCCEEDED,
              },
            },
          },
        },
      },
      select: {
        id: true,
        taskId: true,
        stepId: true,
        storageKey: true,
        provenance: true,
        sha256: true,
        byteSize: true,
        mimeType: true,
        name: true,
        kind: true,
        dataClass: true,
      },
    });
    if (
      !artifact ||
      isForbiddenHostFileArtifact(artifact.provenance) ||
      !hostActionArtifactProvenanceMatches(artifact.provenance, binding)
    ) {
      throw new NotFoundException('Exact dependency artifact is unavailable for this host action');
    }
    const bytes = artifact.byteSize;
    if (target.task.bytesRead + target.task.bytesWritten + bytes > target.task.maxLocalBytes) {
      throw new ConflictException('Task local I/O budget would be exceeded');
    }

    await this.prisma.$transaction(async (tx) => {
      const reserved = await tx.msaidiziTask.updateMany({
        where: {
          id: binding.taskId,
          status: MsaidiziTaskStatus.RUNNING,
          activePlanVersion: target.planVersion.version,
          hostExecutionAllowed: true,
          bytesRead: target.task.bytesRead,
          bytesWritten: target.task.bytesWritten,
        },
        data: { bytesRead: { increment: bytes }, lastCheckpointAt: new Date() },
      });
      if (reserved.count !== 1) {
        throw new ConflictException('Task artifact budget changed; retry materialization');
      }
      await reserveStepLocalIo(tx, target, bytes, 0n);
    });

    const source = await this.storagePath(artifact.storageKey, false);
    const stream = await decryptFile(source, this.encryptionKey(), artifact.sha256);
    const content = await readBounded(stream, binding.byteSize);
    try {
      return { contentBase64: content.toString('base64') };
    } finally {
      content.fill(0);
    }
  }

  private async reserveAndLoadReasoningArtifacts(
    ordered: ReasoningArtifactRow[],
    taskScope: Prisma.MsaidiziTaskWhereInput,
  ): Promise<ReasoningArtifactContent[]> {
    for (const artifact of ordered) {
      if (!artifact.encrypted) {
        throw new ServiceUnavailableException('Unencrypted reasoning artifacts are refused');
      }
      if (!REASONING_MIME_TYPES.has(artifact.mimeType)) {
        const message = artifact.mimeType.startsWith('audio/')
          ? 'Audio must be transcribed locally and attached as text before reasoning'
          : `Artifact media type ${artifact.mimeType} is not supported for reasoning`;
        throw new BadRequestException(message);
      }
    }
    const rawBytes = ordered.reduce((total, artifact) => total + artifact.byteSize, 0n);
    if (rawBytes > BigInt(MAX_REASONING_ARTIFACT_BYTES)) {
      throw new PayloadTooLargeException('Reasoning artifact payload exceeds 12 MiB');
    }
    // Base64 is the actual cloud request representation. Charge its expansion,
    // not merely the smaller on-disk plaintext size.
    const egressBytes = ordered.reduce(
      (total, artifact) => total + ((artifact.byteSize + 2n) / 3n) * 4n,
      0n,
    );
    const task = ordered[0].task;
    if (task.bytesRead + task.bytesWritten + rawBytes > task.maxLocalBytes) {
      throw new ConflictException('Task local I/O budget would be exceeded');
    }
    if (
      task.externalEgressBytes + task.reservedExternalEgressBytes + egressBytes >
      task.maxExternalEgressBytes
    ) {
      throw new ConflictException('Task external egress budget would be exceeded');
    }
    const taskId = ordered[0].taskId;
    const stepReads = new Map<string, { step: StepLocalIoRow; bytes: bigint }>();
    for (const artifact of ordered) {
      if (!artifact.step) continue;
      const current = stepReads.get(artifact.step.id);
      stepReads.set(artifact.step.id, {
        step: artifact.step,
        bytes: (current?.bytes ?? 0n) + artifact.byteSize,
      });
    }
    await this.prisma.$transaction(async (tx) => {
      const reserved = await tx.msaidiziTask.updateMany({
        where: {
          ...taskScope,
          id: taskId,
          bytesRead: task.bytesRead,
          bytesWritten: task.bytesWritten,
          externalEgressBytes: task.externalEgressBytes,
          reservedExternalEgressBytes: task.reservedExternalEgressBytes,
        },
        data: {
          bytesRead: { increment: rawBytes },
          externalEgressBytes: { increment: egressBytes },
          lastCheckpointAt: new Date(),
        },
      });
      if (reserved.count !== 1) {
        throw new ConflictException('Task budget changed; retry artifact reasoning');
      }
      for (const charge of stepReads.values()) {
        await reserveStepLocalIo(tx, charge.step, charge.bytes, 0n);
      }
    });

    const loaded: ReasoningArtifactContent[] = [];
    try {
      for (const artifact of ordered) {
        const source = await this.storagePath(artifact.storageKey, false);
        const stream = await decryptFile(source, this.encryptionKey(), artifact.sha256);
        const content = await readBounded(stream, Number(artifact.byteSize));
        loaded.push({
          id: artifact.id,
          taskId: artifact.taskId,
          kind: artifact.kind,
          name: artifact.name,
          mimeType: artifact.mimeType,
          byteSize: artifact.byteSize,
          sha256: artifact.sha256,
          dataClass: artifact.dataClass,
          trustLevel: 'UNTRUSTED',
          storedTrustLevel: artifact.trustLevel,
          provenance: artifact.provenance,
          content,
        });
      }
      return loaded;
    } catch (error) {
      for (const artifact of loaded) artifact.content.fill(0);
      throw error;
    }
  }

  async download(id: string, user: AuthUser): Promise<DecryptedArtifact> {
    this.assertEnabled();
    const artifact = await this.prisma.msaidiziArtifact.findFirst({
      where: {
        id,
        task: {
          initiatedByUserId: user.id,
          ...taskCompanyScope(user),
        },
      },
      include: {
        step: { select: stepLocalIoSelect },
        task: {
          select: {
            initiatedByUserId: true,
            companyId: true,
            bytesRead: true,
            bytesWritten: true,
            externalEgressBytes: true,
            reservedExternalEgressBytes: true,
            maxLocalBytes: true,
            maxExternalEgressBytes: true,
          },
        },
      },
    });
    if (!artifact) {
      throw new NotFoundException('Artifact not found');
    }
    if (!artifact.encrypted)
      throw new ServiceUnavailableException('Unencrypted artifacts are refused');
    if (
      artifact.task.bytesRead + artifact.task.bytesWritten + artifact.byteSize >
      artifact.task.maxLocalBytes
    ) {
      throw new ConflictException('Task local I/O budget would be exceeded');
    }
    if (
      artifact.task.externalEgressBytes +
        artifact.task.reservedExternalEgressBytes +
        artifact.byteSize >
      artifact.task.maxExternalEgressBytes
    ) {
      throw new ConflictException('Task external egress budget would be exceeded');
    }

    await this.prisma.$transaction(async (tx) => {
      const reserved = await tx.msaidiziTask.updateMany({
        where: {
          id: artifact.taskId,
          initiatedByUserId: user.id,
          ...taskCompanyScope(user),
          bytesRead: artifact.task.bytesRead,
          bytesWritten: artifact.task.bytesWritten,
          externalEgressBytes: artifact.task.externalEgressBytes,
          reservedExternalEgressBytes: artifact.task.reservedExternalEgressBytes,
        },
        data: {
          bytesRead: { increment: artifact.byteSize },
          externalEgressBytes: { increment: artifact.byteSize },
        },
      });
      if (reserved.count !== 1) throw new ConflictException('Task budget changed; retry download');
      if (artifact.step) await reserveStepLocalIo(tx, artifact.step, artifact.byteSize, 0n);
    });

    const source = await this.storagePath(artifact.storageKey, false);
    const stream = await decryptFile(source, this.encryptionKey(), artifact.sha256);
    return {
      stream,
      mimeType: safeMimeType(artifact.mimeType),
      name: artifact.name,
      byteSize: artifact.byteSize,
      sha256: artifact.sha256,
    };
  }

  /**
   * Opens an artifact for a pre-authorized, device-bound update deployment.
   * Authorization is performed by the update-supervisor channel before this
   * method is called. The exact digest is checked again here and egress remains
   * charged to the proposing task's persisted hard budget.
   */
  async downloadForUpdateSupervisor(
    id: string,
    expectedSha256: string,
  ): Promise<DecryptedArtifact> {
    this.assertEnabled();
    const artifact = await this.prisma.msaidiziArtifact.findFirst({
      where: { id, sha256: expectedSha256.toLowerCase(), encrypted: true },
      include: {
        step: { select: stepLocalIoSelect },
        task: {
          select: {
            bytesRead: true,
            bytesWritten: true,
            externalEgressBytes: true,
            reservedExternalEgressBytes: true,
            maxLocalBytes: true,
            maxExternalEgressBytes: true,
          },
        },
      },
    });
    if (!artifact) throw new NotFoundException('Update artifact not found');
    if (
      artifact.task.bytesRead + artifact.task.bytesWritten + artifact.byteSize >
      artifact.task.maxLocalBytes
    ) {
      throw new ConflictException('Task local I/O budget would be exceeded');
    }
    if (
      artifact.task.externalEgressBytes +
        artifact.task.reservedExternalEgressBytes +
        artifact.byteSize >
      artifact.task.maxExternalEgressBytes
    ) {
      throw new ConflictException('Task external egress budget would be exceeded');
    }
    await this.prisma.$transaction(async (tx) => {
      const reserved = await tx.msaidiziTask.updateMany({
        where: {
          id: artifact.taskId,
          bytesRead: artifact.task.bytesRead,
          bytesWritten: artifact.task.bytesWritten,
          externalEgressBytes: artifact.task.externalEgressBytes,
          reservedExternalEgressBytes: artifact.task.reservedExternalEgressBytes,
        },
        data: {
          bytesRead: { increment: artifact.byteSize },
          externalEgressBytes: { increment: artifact.byteSize },
        },
      });
      if (reserved.count !== 1) throw new ConflictException('Task budget changed; retry download');
      if (artifact.step) await reserveStepLocalIo(tx, artifact.step, artifact.byteSize, 0n);
    });

    const source = await this.storagePath(artifact.storageKey, false);
    const stream = await decryptFile(source, this.encryptionKey(), artifact.sha256);
    return {
      stream,
      mimeType: safeMimeType(artifact.mimeType),
      name: artifact.name,
      byteSize: artifact.byteSize,
      sha256: artifact.sha256,
    };
  }

  /** Opens only a generated manifest already authorized by a durable evaluator lease. */
  async downloadForUpdateEvaluation(
    runId: string,
    leaseId: string,
    id: string,
    expectedSha256: string,
  ): Promise<DecryptedArtifact> {
    this.assertEnabled();
    if (!this.autonomousEvaluationExecutionAllowed()) {
      throw new ServiceUnavailableException('Autonomous update evaluation is disabled');
    }
    const authorization = await this.prisma.$transaction(async (tx) => {
      // Match the global safety order: candidate -> principal -> task ->
      // mandate -> step -> run. Safety disable owns the principal before tasks,
      // so the shared principal latch must precede task authority here.
      const candidateRows = await tx.$queryRaw<
        Array<{ id: string; principalId: string; taskId: string | null }>
      >`
        SELECT candidates."id" AS "id",
               candidates."principalId" AS "principalId",
               candidates."proposedByTaskId" AS "taskId"
        FROM "msaidizi_update_candidates" candidates
        JOIN "msaidizi_update_evaluation_runs" runs
          ON runs."candidateId" = candidates."id"
        WHERE runs."id" = ${runId}
          AND candidates."status" = 'EVALUATING'
        FOR UPDATE OF candidates
      `;
      if (candidateRows.length !== 1) {
        throw new NotFoundException('Generated evaluation artifact not found');
      }
      const candidateAuthority = candidateRows[0];
      if (!candidateAuthority.taskId) {
        throw new NotFoundException('Generated evaluation artifact not found');
      }
      const principals = await tx.$queryRaw<Array<{ id: string; status: MsaidiziPrincipalStatus }>>`
        SELECT "id", "status"
        FROM "msaidizi_principals"
        WHERE "id" = ${candidateAuthority.principalId}
        FOR SHARE
      `;
      if (principals.length !== 1 || principals[0].status !== MsaidiziPrincipalStatus.ACTIVE) {
        throw new NotFoundException('Generated evaluation artifact not found');
      }
      const tasks = await tx.$queryRaw<
        Array<{ id: string; principalId: string; mandateId: string | null }>
      >`
        SELECT "id", "principalId", "mandateId"
        FROM "msaidizi_tasks"
        WHERE "id" = ${candidateAuthority.taskId}
          AND "principalId" = ${candidateAuthority.principalId}
        FOR SHARE
      `;
      if (tasks.length !== 1 || !tasks[0].mandateId) {
        throw new NotFoundException('Generated evaluation artifact not found');
      }
      const mandates = await tx.$queryRaw<Array<{ id: string }>>`
        SELECT "id"
        FROM "msaidizi_mandates"
        WHERE "id" = ${tasks[0].mandateId}
          AND "principalId" = ${candidateAuthority.principalId}
        FOR SHARE
      `;
      if (mandates.length !== 1) {
        throw new NotFoundException('Generated evaluation artifact not found');
      }
      const steps = await tx.$queryRaw<Array<{ id: string }>>`
        SELECT steps."id" AS "id"
        FROM "msaidizi_task_steps" steps
        JOIN "msaidizi_update_evaluation_runs" runs ON runs."stepId" = steps."id"
        WHERE runs."id" = ${runId}
          AND steps."taskId" = ${candidateAuthority.taskId}
        FOR SHARE OF steps
      `;
      if (steps.length !== 1) {
        throw new NotFoundException('Generated evaluation artifact not found');
      }
      const runLocks = await tx.$queryRaw<Array<{ id: string }>>`
        SELECT "id"
        FROM "msaidizi_update_evaluation_runs"
        WHERE "id" = ${runId}
        FOR UPDATE
      `;
      if (runLocks.length !== 1) {
        throw new NotFoundException('Generated evaluation artifact not found');
      }
      const run = await tx.msaidiziUpdateEvaluationRun.findFirst({
        where: {
          id: runId,
          leaseId,
          generationArtifactId: id,
          generationArtifactSha256: expectedSha256.toLowerCase(),
          status: 'RUNNING',
          candidate: { status: 'EVALUATING' },
        },
        include: {
          generationArtifact: true,
          task: { include: { principal: true, mandate: true } },
          step: true,
        },
      });
      // Nothing that can block follows this clock read before the usage CAS.
      // If a lock wait consumed the lease/mandate/wall window, this timestamp
      // observes it and the transfer fails closed.
      const now = await this.transactionDatabaseNow(tx);
      if (
        !this.autonomousEvaluationExecutionAllowed() ||
        !run ||
        run.candidateId !== candidateAuthority.id ||
        run.taskId !== candidateAuthority.taskId ||
        run.task.principalId !== candidateAuthority.principalId ||
        run.leaseId !== leaseId ||
        !run.leaseExpiresAt ||
        run.leaseExpiresAt <= now ||
        run.deadlineAt <= now ||
        !run.startedAt ||
        now.getTime() - run.startedAt.getTime() > run.maxWallTimeSeconds * 1_000 ||
        !generatedEvaluationTaskStatus(run.task.status) ||
        run.task.principal.status !== MsaidiziPrincipalStatus.ACTIVE ||
        !run.task.mandate ||
        run.task.mandate.id !== run.task.mandateId ||
        run.task.mandate.principalId !== run.task.principalId ||
        run.task.mandate.status !== 'ACTIVE' ||
        (run.task.mandate.startsAt && run.task.mandate.startsAt > now) ||
        (run.task.mandate.expiresAt && run.task.mandate.expiresAt <= now) ||
        !mandateAuthorizesUpdateCandidateProposal(run.task.mandate.capabilities, run.step) ||
        run.usedCpuTimeSeconds > run.maxCpuTimeSeconds ||
        run.usedBytesRead > run.maxBytesRead ||
        run.usedBytesWritten > run.maxBytesWritten ||
        run.usedExternalEgressBytes > run.maxExternalEgressBytes ||
        run.usedModelTurns > run.maxModelTurns ||
        run.usedModelInputTokens > run.maxModelInputTokens ||
        run.usedModelOutputTokens > run.maxModelOutputTokens ||
        run.usedModelCostMicrousd > run.maxModelCostMicrousd ||
        !run.generationArtifact.encrypted ||
        run.generationArtifact.trustLevel !== MsaidiziTrustLevel.UNTRUSTED ||
        run.generationArtifact.sha256 !== expectedSha256.toLowerCase()
      ) {
        throw new NotFoundException('Generated evaluation artifact not found');
      }
      const byteSize = run.generationArtifact.byteSize;
      if (
        run.usedBytesRead + byteSize > run.maxBytesRead ||
        run.usedExternalEgressBytes + byteSize > run.maxExternalEgressBytes
      ) {
        throw new ConflictException('Evaluation artifact transfer budget would be exceeded');
      }
      const bytesRead = run.usedBytesRead + byteSize;
      const externalEgressBytes = run.usedExternalEgressBytes + byteSize;
      const won = await tx.msaidiziUpdateEvaluationRun.updateMany({
        where: {
          id: run.id,
          status: 'RUNNING',
          leaseId,
          leaseGeneration: run.leaseGeneration,
          leaseExpiresAt: run.leaseExpiresAt,
          deadlineAt: run.deadlineAt,
          startedAt: run.startedAt,
          usedCpuTimeSeconds: run.usedCpuTimeSeconds,
          usedBytesRead: run.usedBytesRead,
          usedBytesWritten: run.usedBytesWritten,
          usedExternalEgressBytes: run.usedExternalEgressBytes,
          usedModelTurns: run.usedModelTurns,
          usedModelInputTokens: run.usedModelInputTokens,
          usedModelOutputTokens: run.usedModelOutputTokens,
          usedModelCostMicrousd: run.usedModelCostMicrousd,
          task: {
            id: candidateAuthority.taskId,
            principalId: candidateAuthority.principalId,
            status: { in: [MsaidiziTaskStatus.RUNNING, MsaidiziTaskStatus.COMPLETED] },
            principal: { status: MsaidiziPrincipalStatus.ACTIVE },
          },
          candidate: {
            id: candidateAuthority.id,
            principalId: candidateAuthority.principalId,
            status: 'EVALUATING',
            principal: { status: MsaidiziPrincipalStatus.ACTIVE },
          },
        },
        data: { usedBytesRead: bytesRead, usedExternalEgressBytes: externalEgressBytes },
      });
      if (won.count !== 1) throw new ConflictException('Evaluation transfer usage changed');
      return {
        storageKey: run.generationArtifact.storageKey,
        sha256: run.generationArtifact.sha256,
        mimeType: run.generationArtifact.mimeType,
        name: run.generationArtifact.name,
        byteSize,
        bytesRead,
        externalEgressBytes,
      };
    });
    const source = await this.storagePath(authorization.storageKey, false);
    const stream = await decryptFile(source, this.encryptionKey(), authorization.sha256);
    return {
      stream,
      mimeType: safeMimeType(authorization.mimeType),
      name: authorization.name,
      byteSize: authorization.byteSize,
      sha256: authorization.sha256,
      evaluationUsageFloor: {
        bytesRead: authorization.bytesRead,
        externalEgressBytes: authorization.externalEgressBytes,
      },
    };
  }

  private autonomousEvaluationExecutionAllowed(): boolean {
    return (
      this.config.get<string>('MSAIDIZI_AUTONOMY_ENABLED', 'false').toLowerCase() === 'true' &&
      this.config.get<string>('MSAIDIZI_GLOBAL_KILL_SWITCH', 'false').toLowerCase() !== 'true'
    );
  }

  private async databaseNow(): Promise<Date> {
    const rows = await this.prisma.$queryRaw<Array<{ now: Date }>>`
      SELECT clock_timestamp() AS "now"
    `;
    const now = rows[0]?.now;
    if (!(now instanceof Date) || !Number.isFinite(now.getTime())) {
      throw new ServiceUnavailableException('Database clock is unavailable');
    }
    return now;
  }

  private async transactionDatabaseNow(tx: Prisma.TransactionClient): Promise<Date> {
    const rows = await tx.$queryRaw<Array<{ now: Date }>>`
      SELECT clock_timestamp() AS "now"
    `;
    const now = rows[0]?.now;
    if (!(now instanceof Date) || !Number.isFinite(now.getTime())) {
      throw new ServiceUnavailableException('Database clock is unavailable');
    }
    return now;
  }

  private generatedArtifactReservationAllowed(
    run: GeneratedArtifactEvaluationRun,
    task: TrustedArtifactAuthorityTask,
    candidate: { id: string; principalId: string; taskId: string | null },
    expectedCandidateId: string,
    additionalBytesWritten: bigint,
    now: Date,
  ): boolean {
    return (
      run.status === 'RUNNING' &&
      Boolean(run.leaseId) &&
      Boolean(run.leaseExpiresAt) &&
      run.leaseExpiresAt! > now &&
      run.deadlineAt > now &&
      Boolean(run.startedAt) &&
      now.getTime() - run.startedAt!.getTime() <= run.maxWallTimeSeconds * 1_000 &&
      run.candidate.id === expectedCandidateId &&
      run.candidate.id === candidate.id &&
      run.candidate.status === 'EVALUATING' &&
      run.candidate.principalId === candidate.principalId &&
      run.taskId === task.id &&
      candidate.taskId === task.id &&
      generatedEvaluationTaskStatus(task.status) &&
      task.principalId === candidate.principalId &&
      task.principal.status === MsaidiziPrincipalStatus.ACTIVE &&
      Boolean(task.mandate) &&
      task.mandate!.id === task.mandateId &&
      task.mandate!.principalId === task.principalId &&
      task.mandate!.status === 'ACTIVE' &&
      (!task.mandate!.startsAt || task.mandate!.startsAt <= now) &&
      (!task.mandate!.expiresAt || task.mandate!.expiresAt > now) &&
      mandateAuthorizesUpdateCandidateProposal(task.mandate!.capabilities, run.step) &&
      run.usedCpuTimeSeconds <= run.maxCpuTimeSeconds &&
      run.usedBytesRead <= run.maxBytesRead &&
      run.usedBytesWritten <= run.maxBytesWritten &&
      run.usedExternalEgressBytes <= run.maxExternalEgressBytes &&
      run.usedModelTurns <= run.maxModelTurns &&
      run.usedModelInputTokens <= run.maxModelInputTokens &&
      run.usedModelOutputTokens <= run.maxModelOutputTokens &&
      run.usedModelCostMicrousd <= run.maxModelCostMicrousd &&
      run.usedBytesWritten + additionalBytesWritten <= run.maxBytesWritten
    );
  }

  private async scopedTask(taskId: string, user: AuthUser) {
    const task = await this.prisma.msaidiziTask.findFirst({
      where: { id: taskId, initiatedByUserId: user.id, ...taskCompanyScope(user) },
      select: { id: true, bytesRead: true, bytesWritten: true, maxLocalBytes: true },
    });
    if (!task) throw new NotFoundException('Task not found');
    return task;
  }

  private async trustedArtifactContext(claims: ArtifactAttestationClaims) {
    const databaseNow = await this.databaseNow();
    const task = await this.prisma.msaidiziTask.findUnique({
      where: { id: claims.taskId },
      include: { principal: true, mandate: true },
    });
    const step = await this.prisma.msaidiziTaskStep.findFirst({
      where: { id: claims.stepId, taskId: claims.taskId, planVersionId: claims.planVersionId },
      include: { planVersion: true },
    });
    if (
      !task ||
      !step ||
      !trustedArtifactTaskStatus(task.status) ||
      task.mode !== MsaidiziTaskMode.AUTOPILOT ||
      task.principal.status !== MsaidiziPrincipalStatus.ACTIVE ||
      task.activePlanVersion !== step.planVersion.version ||
      step.planVersion.createdByUserId !== task.initiatedByUserId ||
      step.dataClass !== claims.dataClass
    ) {
      throw new BadRequestException(
        'Trusted artifact is not bound to an active reviewed task step',
      );
    }
    const proposal = assertUpdateCandidateProposalStep(step);
    if (!mandateAuthorizesUpdateCandidateProposal(task.mandate?.capabilities, step)) {
      throw new BadRequestException('Trusted artifact is outside the active mandate');
    }
    const now = databaseNow.getTime();
    if (
      !task.mandate ||
      task.mandate.status !== 'ACTIVE' ||
      (task.mandate.startsAt && task.mandate.startsAt.getTime() > now) ||
      (task.mandate.expiresAt && task.mandate.expiresAt.getTime() <= now)
    ) {
      throw new BadRequestException('Trusted artifact mandate is inactive');
    }
    let generatedEvaluationRun: {
      id: string;
      candidateId: string;
      status: string;
      leaseId: string | null;
      leaseExpiresAt: Date | null;
      deadlineAt: Date;
    } | null = null;
    if (isGeneratedUpdateCandidateProposal(proposal)) {
      // This is a second, independent check at the evidence boundary. The
      // immutable run also pins the exact policy version/digest created by the
      // proposal path; neither a VM nor a model can weaken it in transit.
      const run = await this.prisma.msaidiziUpdateEvaluationRun.findFirst({
        where: {
          evaluationRunId: claims.evaluationRunId,
          taskId: claims.taskId,
          planVersionId: claims.planVersionId,
          stepId: claims.stepId,
          status: 'RUNNING',
          leaseExpiresAt: { gt: databaseNow },
          deadlineAt: { gt: databaseNow },
          candidate: {
            status: 'EVALUATING',
            proposedByTaskId: claims.taskId,
            proposedByPlanVersionId: claims.planVersionId,
            proposedByStepId: claims.stepId,
          },
        },
        include: { generationArtifact: true },
      });
      if (
        !run ||
        claims.schemaVersion !== 2 ||
        !isGeneratedEvaluationBinding(claims) ||
        claims.requestDigest !== run?.requestDigest ||
        claims.generationArtifactId !== run?.generationArtifactId ||
        claims.generationArtifactSha256 !== run?.generationArtifactSha256 ||
        claims.generationManifestSha256 !== run?.generationManifestSha256 ||
        claims.protectedPolicyVersion !== run?.policyVersion ||
        claims.protectedPolicySha256 !== run?.policyDigest ||
        claims.baseRevisionSha256 !== proposal.baseRevisionSha256 ||
        run.policyVersion !== GENERATED_UPDATE_POLICY_VERSION ||
        run.policyDigest !== GENERATED_UPDATE_PROTECTED_PATH_POLICY_SHA256 ||
        run.generationManifestSha256 !== run.generationArtifactSha256 ||
        run.generationArtifact.sha256 !== run.generationArtifactSha256 ||
        run.generationArtifact.taskId !== claims.taskId ||
        run.generationArtifact.stepId !== claims.stepId ||
        run.generationArtifact.trustLevel !== MsaidiziTrustLevel.UNTRUSTED ||
        (claims.artifactPurpose === 'REPORT'
          ? claims.candidateId !== run.candidateId
          : claims.candidateId !== null)
      ) {
        throw new BadRequestException('Trusted artifact is outside the generated evaluation run');
      }
      generatedEvaluationRun = {
        id: run.id,
        candidateId: run.candidateId,
        status: run.status,
        leaseId: run.leaseId,
        leaseExpiresAt: run.leaseExpiresAt,
        deadlineAt: run.deadlineAt,
      };
    } else if (
      (claims.artifactPurpose === 'SOURCE' &&
        (claims.candidateId !== null ||
          proposal.sourceArtifactId !== claims.artifactId ||
          proposal.sourceArtifactSha256 !== claims.sha256)) ||
      (claims.artifactPurpose === 'ROLLBACK' &&
        (claims.candidateId !== null ||
          proposal.rollbackArtifactId !== claims.artifactId ||
          proposal.rollbackArtifactSha256 !== claims.sha256))
    ) {
      throw new BadRequestException('Trusted artifact is not the reviewed source/rollback input');
    }
    if (claims.artifactPurpose === 'REPORT') {
      if (!claims.candidateId)
        throw new BadRequestException('Report evidence requires candidate binding');
      const candidate = await this.prisma.msaidiziUpdateCandidate.findFirst({
        where: {
          id: claims.candidateId,
          proposedByTaskId: task.id,
          proposedByPlanVersionId: step.planVersionId,
          proposedByStepId: step.id,
          status: { in: ['DRAFT', 'EVALUATING'] },
        },
        select: { id: true },
      });
      if (!candidate) throw new BadRequestException('Report candidate binding is invalid');
    }
    return { ...task, generatedEvaluationRun };
  }

  private async trustedArtifactReplay(
    artifactId: string,
    attestation: CanonicalAttestation<ArtifactAttestationClaims>,
  ) {
    const existing = await this.prisma.msaidiziArtifact.findUnique({
      where: { id: artifactId },
      include: { trustedEvidence: true },
    });
    if (!existing) return null;
    if (
      !existing.trustedEvidence ||
      existing.kind !== MsaidiziArtifactKind.FILE ||
      existing.trustLevel !== MsaidiziTrustLevel.TRUSTED ||
      existing.trustedPurpose !== attestation.claims.artifactPurpose ||
      existing.taskId !== attestation.claims.taskId ||
      existing.stepId !== attestation.claims.stepId ||
      existing.sha256 !== attestation.claims.sha256 ||
      existing.byteSize.toString() !== attestation.claims.byteSize ||
      existing.dataClass !== attestation.claims.dataClass ||
      existing.trustedEvidence.claimsDigest !== attestation.claimsDigest ||
      existing.trustedEvidence.signature !== attestation.signature
    ) {
      throw new ConflictException('Trusted artifact replay evidence does not match');
    }
    return jsonSafe({ artifact: existing, replay: true, claimsDigest: attestation.claimsDigest });
  }

  private async toolObservationReplay(
    artifactId: string,
    input: ToolObservationArtifactMetadata,
    client: Pick<Prisma.TransactionClient, 'msaidiziArtifact'> = this.prisma,
  ): Promise<Record<string, unknown> | null> {
    const existing = await client.msaidiziArtifact.findUnique({ where: { id: artifactId } });
    if (!existing) return null;
    const descriptor = toolObservationDescriptor(input);
    const provenance = sanitizePersistedValue(existing.provenance).value as Record<string, unknown>;
    if (
      existing.taskId !== input.taskId ||
      existing.stepId !== input.stepId ||
      existing.kind !== descriptor.kind ||
      existing.name !== descriptor.name ||
      existing.mimeType !== descriptor.mimeType ||
      existing.sha256 !== input.persistedSha256 ||
      existing.byteSize !== BigInt(input.persistedBytes) ||
      !existing.encrypted ||
      existing.trustLevel !== MsaidiziTrustLevel.UNTRUSTED ||
      provenance.attemptId !== input.attemptId ||
      provenance.sourceSha256 !== input.sourceSha256 ||
      provenance.sourceType !== input.sourceType ||
      provenance.capability !== descriptor.capability ||
      provenance.mimeType !== descriptor.mimeType ||
      (provenance.extension ?? null) !== descriptor.extension ||
      (provenance.argumentsSha256 ?? null) !== descriptor.argumentsSha256 ||
      (provenance.sourceIdentifierSha256 ?? null) !== descriptor.sourceIdentifierHash ||
      provenance.trustLevel !== 'UNTRUSTED' ||
      (provenance.accountedLocalBytesRead ?? '0') !==
        (input.accountedLocalBytesRead ?? 0n).toString() ||
      (provenance.accountedLocalBytesWritten ?? '0') !==
        (input.accountedLocalBytesWritten ?? 0n).toString()
    ) {
      throw new ConflictException('Tool observation artifact replay does not match');
    }
    return jsonSafe({ artifact: existing, replay: true });
  }

  private preparedToolObservationState(
    prepared: PreparedToolObservationArtifact,
  ): PreparedToolObservationState {
    const state = preparedToolObservationStates.get(prepared);
    if (!state || state.owner !== this) {
      throw new ConflictException('Prepared tool observation handle is invalid');
    }
    return state;
  }

  private async lockToolObservationArtifact(
    tx: Prisma.TransactionClient,
    artifactId: string,
  ): Promise<void> {
    const lockId = toolObservationAdvisoryLockId(artifactId);
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(${lockId})`;
  }

  private assertEnabled(): void {
    if (this.config.get<string>('MSAIDIZI_AUTONOMY_ENABLED', 'false').toLowerCase() !== 'true') {
      throw new ServiceUnavailableException('Msaidizi autonomy is disabled');
    }
  }

  private encryptionKey(): Buffer {
    const encoded = this.config.get<string>('MSAIDIZI_ARTIFACT_ENCRYPTION_KEY', '').trim();
    const key = Buffer.from(encoded, 'base64');
    if (!encoded || key.length !== 32) {
      throw new ServiceUnavailableException('Msaidizi artifact encryption is not configured');
    }
    return key;
  }

  private async storagePath(storageKey: string, createDirectory = true): Promise<string> {
    if (!/^[0-9a-f-]{36}\.msa$/i.test(storageKey)) {
      throw new ServiceUnavailableException('Invalid artifact storage key');
    }
    const configured = this.config.get<string>('MSAIDIZI_ARTIFACT_ROOT', '').trim();
    const root = path.resolve(
      configured || path.join(process.cwd(), 'storage', 'msaidizi-artifacts'),
    );
    if (createDirectory) await fs.mkdir(root, { recursive: true });
    const resolved = path.resolve(root, storageKey);
    if (path.dirname(resolved) !== root)
      throw new ServiceUnavailableException('Invalid artifact path');
    return resolved;
  }
}

const stepLocalIoSelect = {
  id: true,
  taskId: true,
  budgets: true,
  bytesRead: true,
  bytesWritten: true,
  localIoAccountingValid: true,
  status: true,
} as const;

async function reserveStepLocalIo(
  tx: Prisma.TransactionClient,
  step: StepLocalIoRow,
  bytesRead: bigint,
  bytesWritten: bigint,
): Promise<void> {
  if (bytesRead < 0n || bytesWritten < 0n) {
    throw new ConflictException('Step local I/O charge is invalid');
  }
  const state = stepLocalIoState(step);
  if (!state.ok) {
    throw new ConflictException(`Step local I/O accounting is invalid: ${state.detail}`);
  }
  const charge = bytesRead + bytesWritten;
  if (state.remaining !== null && charge > state.remaining) {
    throw new ConflictException('Step local I/O budget would be exceeded');
  }
  if (charge === 0n) return;
  const won = await tx.msaidiziTaskStep.updateMany({
    where: {
      id: step.id,
      taskId: step.taskId,
      localIoAccountingValid: true,
      bytesRead: state.bytesRead,
      bytesWritten: state.bytesWritten,
    },
    data: {
      bytesRead: { increment: bytesRead },
      bytesWritten: { increment: bytesWritten },
      checkpointedAt: new Date(),
    },
  });
  if (won.count !== 1) {
    throw new ConflictException('Step local I/O accounting changed; retry operation');
  }
}

function taskCompanyScope(user: AuthUser): Prisma.MsaidiziTaskWhereInput {
  const companyScope = companyWhereForUser(user);
  return isGroupScopedUser(user) ? { OR: [{ companyId: null }, companyScope] } : companyScope;
}

function draftReasoningTaskScope(
  authority: DraftReasoningAuthority,
): Prisma.MsaidiziTaskWhereInput {
  return {
    id: authority.taskId,
    principalId: authority.principalId,
    initiatedByUserId: authority.initiatedByUserId,
    companyId: authority.companyId,
    mandateId: authority.mandateId,
    scheduleId: null,
    mode: authority.mode,
    status: MsaidiziTaskStatus.PLANNING,
    activePlanVersion: 0,
    stateVersion: authority.stateVersion,
    statusDetail: null,
    proposalUsageId: null,
    mutations: 0,
    attemptedToolCalls: 0,
    executedToolCalls: 0,
    modelTurns: 0,
    inputTokens: 0n,
    outputTokens: 0n,
    modelCostUsd: 0,
    principal: { is: { status: MsaidiziPrincipalStatus.ACTIVE } },
    planVersions: { none: {} },
    steps: { none: {} },
    toolAttempts: { none: {} },
    deviceLeases: { none: {} },
    hostActions: { none: {} },
  };
}

function assertHostActionArtifactBinding(binding: HostActionArtifactMaterializationRequest): void {
  const canonicalUuid = (value: string) =>
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(value);
  if (
    !canonicalUuid(binding.taskId) ||
    !canonicalUuid(binding.planVersionId) ||
    !canonicalUuid(binding.targetStepId) ||
    !canonicalUuid(binding.deviceId) ||
    !canonicalUuid(binding.sourceStepId) ||
    !canonicalUuid(binding.artifactId) ||
    !/^[A-Za-z0-9._:-]{1,200}$/.test(binding.targetAttemptId) ||
    !/^[A-Za-z0-9._:-]{1,200}$/.test(binding.sourceAttemptId) ||
    !isSha256(binding.sha256) ||
    !Number.isSafeInteger(binding.byteSize) ||
    binding.byteSize < 1 ||
    binding.byteSize > MAX_HOST_ACTION_ARTIFACT_BYTES ||
    !/^[\w.+-]+\/[\w.+-]+$/.test(binding.mimeType) ||
    binding.mimeType.length > 127 ||
    !/^[A-Za-z0-9][A-Za-z0-9 ._()\-]{0,254}$/.test(binding.name) ||
    /[ .]$/.test(binding.name) ||
    !Object.values(MsaidiziArtifactKind).includes(binding.kind as MsaidiziArtifactKind) ||
    binding.dataClass.length < 1 ||
    binding.dataClass.length > 64 ||
    [...binding.dataClass].some((character) => character < ' ' || character === '\u007f')
  ) {
    throw new BadRequestException('Host action artifact binding is invalid');
  }
}

function hostActionArtifactProvenanceMatches(
  value: Prisma.JsonValue,
  binding: HostActionArtifactMaterializationRequest,
): boolean {
  const provenance = jsonRecord(value);
  return (
    provenance.attemptId === binding.sourceAttemptId &&
    provenance.persistedSha256 === binding.sha256 &&
    provenance.persistedBytes === binding.byteSize &&
    provenance.redactionsApplied === false &&
    provenance.trustLevel === 'UNTRUSTED'
  );
}

function isForbiddenHostFileArtifact(value: Prisma.JsonValue): boolean {
  const provenance = jsonRecord(value);
  return (
    provenance.sourceType === 'HOST_RESULT' &&
    isUnavailableHostFileContentCapability(provenance.capability)
  );
}

function jsonRecord(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function adaptiveImageProvenanceMatches(
  value: Prisma.JsonValue,
  binding: AdaptiveReasoningImageBinding,
): boolean {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const provenance = value as Prisma.JsonObject;
  return (
    provenance.uploadSource === 'tool-observation' &&
    provenance.attemptId === binding.attemptId &&
    provenance.sourceType === 'HOST_RESULT' &&
    provenance.persistedSha256 === binding.sha256 &&
    provenance.persistedBytes === binding.byteSize &&
    provenance.redactionsApplied === false &&
    provenance.capability === binding.capability &&
    provenance.mimeType === binding.mimeType &&
    provenance.trustLevel === 'UNTRUSTED'
  );
}

function adaptiveFileMetadataMatches(
  extension: AdaptiveHostFileExtension,
  mimeType: AdaptiveHostFileMimeType,
): boolean {
  const expected: Record<AdaptiveHostFileExtension, AdaptiveHostFileMimeType> = {
    '.csv': 'text/csv',
    '.json': 'application/json',
    '.log': 'text/plain',
    '.markdown': 'text/markdown',
    '.md': 'text/markdown',
    '.pdf': 'application/pdf',
    '.txt': 'text/plain',
  };
  return Object.hasOwn(expected, extension) && expected[extension] === mimeType;
}

async function encryptFile(source: string, destination: string, key: Buffer): Promise<string> {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const hash = createHash('sha256');
  const digesting = new Transform({
    transform(chunk: Buffer, _encoding, callback) {
      hash.update(chunk);
      callback(null, chunk);
    },
  });
  await writeNewFileDurably(destination, Buffer.concat([ARTIFACT_MAGIC, iv]));
  try {
    await pipeline(
      createReadStream(source),
      digesting,
      cipher,
      createWriteStream(destination, { flags: 'a' }),
    );
    await fs.appendFile(destination, cipher.getAuthTag());
    await syncExistingFile(destination);
    return hash.digest('hex');
  } catch (error) {
    await fs.rm(destination, { force: true }).catch(() => undefined);
    throw error;
  }
}

/**
 * Flushes ciphertext to the volume before its database row can commit. The
 * exclusive create preserves the existing replay/orphan rules while
 * FileHandle.sync maps to FlushFileBuffers on Windows.
 */
async function writeNewFileDurably(destination: string, content: Buffer): Promise<void> {
  const handle = await fs.open(destination, 'wx');
  try {
    await handle.writeFile(content);
    await handle.sync();
    await handle.close();
  } catch (error) {
    await handle.close().catch(() => undefined);
    await fs.rm(destination, { force: true }).catch(() => undefined);
    throw error;
  }
}

async function syncExistingFile(destination: string): Promise<void> {
  const handle = await fs.open(destination, 'r+');
  try {
    await handle.sync();
  } finally {
    await handle.close();
  }
}

function encryptBufferInMemory(source: Buffer, key: Buffer): { envelope: Buffer; sha256: string } {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const encrypted = cipher.update(source);
  const final = cipher.final();
  const tag = cipher.getAuthTag();
  try {
    return {
      envelope: Buffer.concat([ARTIFACT_MAGIC, iv, encrypted, final, tag]),
      sha256: createHash('sha256').update(source).digest('hex'),
    };
  } finally {
    iv.fill(0);
    encrypted.fill(0);
    final.fill(0);
    tag.fill(0);
  }
}

function toolObservationAdvisoryLockId(artifactId: string): bigint {
  return createHash('sha256')
    .update(`msaidizi-tool-observation\0${artifactId}`, 'utf8')
    .digest()
    .readBigInt64BE(0);
}

async function removeSerializedArtifactOrphan(destination: string): Promise<void> {
  let stats;
  try {
    stats = await fs.lstat(destination);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return;
    throw error;
  }
  if (!stats.isFile()) {
    throw new ServiceUnavailableException('Artifact orphan path is not a regular file');
  }
  await fs.rm(destination);
}

async function removeOwnedArtifactFile(
  destination: string,
  expectedEnvelopeSha256: string | null,
): Promise<void> {
  if (!expectedEnvelopeSha256) {
    throw new ConflictException('Prepared artifact cleanup identity is unavailable');
  }
  let stats;
  try {
    stats = await fs.lstat(destination);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return;
    throw error;
  }
  if (!stats.isFile()) {
    throw new ServiceUnavailableException('Prepared artifact cleanup path is not a regular file');
  }
  const bytes = await fs.readFile(destination);
  let digest: string;
  try {
    digest = createHash('sha256').update(bytes).digest('hex');
  } finally {
    bytes.fill(0);
  }
  if (digest !== expectedEnvelopeSha256) {
    throw new ConflictException('Prepared artifact cleanup ownership changed');
  }
  await fs.rm(destination);
}

function preparedArtifactPreview(value: unknown): PreparedToolObservationArtifact['artifact'] {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new ConflictException('Prepared tool observation artifact preview is invalid');
  }
  const artifact = value as Record<string, unknown>;
  if (
    typeof artifact.id !== 'string' ||
    !isSha256(String(artifact.sha256 ?? '')) ||
    typeof artifact.mimeType !== 'string' ||
    !Object.values(MsaidiziArtifactKind).includes(artifact.kind as MsaidiziArtifactKind) ||
    artifact.trustLevel !== MsaidiziTrustLevel.UNTRUSTED
  ) {
    throw new ConflictException('Prepared tool observation artifact preview is invalid');
  }
  return Object.freeze({
    id: artifact.id,
    sha256: artifact.sha256 as string,
    mimeType: artifact.mimeType,
    kind: artifact.kind as MsaidiziArtifactKind,
    trustLevel: MsaidiziTrustLevel.UNTRUSTED,
  });
}

function deterministicObservationArtifactId(input: ToolObservationArtifactMetadata): string {
  const mediaBinding = input.media ? `\0${input.media.capability}\0${input.media.mimeType}` : '';
  const fileBinding = input.file
    ? `\0${input.file.capability}\0${input.file.mimeType}\0${input.file.extension}\0${input.file.argumentsSha256}\0${input.file.sourceIdentifierHash}`
    : '';
  const bytes = createHash('sha256')
    .update(
      `${input.taskId}\0${input.stepId}\0${input.attemptId}\0${input.persistedSha256}${mediaBinding}${fileBinding}`,
      'utf8',
    )
    .digest()
    .subarray(0, 16);
  bytes[6] = (bytes[6] & 0x0f) | 0x50;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = bytes.toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function toolObservationDescriptor(input: ToolObservationArtifactMetadata): {
  kind: MsaidiziArtifactKind;
  name: string;
  mimeType: string;
  capability: string | null;
  extension: AdaptiveHostFileExtension | null;
  argumentsSha256: string | null;
  sourceIdentifierHash: string | null;
} {
  if (!input.media && !input.file) {
    if (input.sourceType === 'UPDATE_GENERATION') {
      return {
        kind: MsaidiziArtifactKind.FILE,
        name: `generated-update-manifest-${input.stepId}.json`,
        mimeType: 'application/json',
        capability: 'msaidizi.self-improvement.propose-update-candidate',
        extension: null,
        argumentsSha256: null,
        sourceIdentifierHash: null,
      };
    }
    return {
      kind: MsaidiziArtifactKind.OTHER,
      name: `tool-observation-${input.stepId}.json`,
      mimeType: 'application/json',
      capability: null,
      extension: null,
      argumentsSha256: null,
      sourceIdentifierHash: null,
    };
  }
  if (input.media && input.file) {
    throw new BadRequestException('Tool observation bindings must be mutually exclusive');
  }
  if (input.sourceType !== 'HOST_RESULT') {
    throw new BadRequestException('Bound artifacts must originate from a host result');
  }
  if (input.file) {
    if (
      input.file.capability !== 'filesystem.file.read' ||
      !adaptiveFileMetadataMatches(input.file.extension, input.file.mimeType)
    ) {
      throw new BadRequestException('Host file capability and media type do not match');
    }
    return {
      kind: MsaidiziArtifactKind.FILE,
      name: `host-file-observation-${input.stepId}${input.file.extension}`,
      mimeType: input.file.mimeType,
      capability: input.file.capability,
      extension: input.file.extension,
      argumentsSha256: input.file.argumentsSha256,
      sourceIdentifierHash: input.file.sourceIdentifierHash,
    };
  }
  const media = input.media!;
  const expectedMimeType: Record<HostObservationMediaBinding['capability'], string> = {
    'screen.primary.capture': 'image/png',
    'camera.photo.capture': 'image/jpeg',
    'audio.microphone.capture': 'audio/wav',
    'speech.text.synthesize': 'audio/wav',
  };
  if (expectedMimeType[media.capability] !== media.mimeType) {
    throw new BadRequestException('Host media capability and media type do not match');
  }
  const extension =
    media.mimeType === 'image/png' ? 'png' : media.mimeType === 'image/jpeg' ? 'jpg' : 'wav';
  return {
    kind: media.mimeType.startsWith('image/')
      ? MsaidiziArtifactKind.SCREENSHOT
      : MsaidiziArtifactKind.AUDIO,
    name: `host-observation-${input.stepId}.${extension}`,
    mimeType: media.mimeType,
    capability: media.capability,
    extension: null,
    argumentsSha256: null,
    sourceIdentifierHash: null,
  };
}

function mediaSignatureMatches(content: Buffer, mimeType: HostObservationMediaBinding['mimeType']) {
  if (mimeType === 'image/png') {
    return (
      content.length >= 45 &&
      content.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) &&
      content.readUInt32BE(8) === 13 &&
      content.subarray(12, 16).toString('ascii') === 'IHDR' &&
      content.readUInt32BE(16) > 0 &&
      content.readUInt32BE(20) > 0 &&
      content.readUInt32BE(content.length - 12) === 0 &&
      content.subarray(content.length - 8, content.length - 4).toString('ascii') === 'IEND'
    );
  }
  if (mimeType === 'image/jpeg') {
    return jpegHasFrame(content);
  }
  return (
    content.length >= 44 &&
    content.subarray(0, 4).toString('ascii') === 'RIFF' &&
    content.subarray(8, 12).toString('ascii') === 'WAVE' &&
    content.readUInt32LE(4) + 8 === content.length
  );
}

function jpegHasFrame(content: Buffer): boolean {
  if (
    content.length < 4 ||
    content[0] !== 0xff ||
    content[1] !== 0xd8 ||
    content[content.length - 2] !== 0xff ||
    content[content.length - 1] !== 0xd9
  ) {
    return false;
  }
  const frames = new Set([
    0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf,
  ]);
  let offset = 2;
  while (offset + 3 < content.length) {
    while (offset < content.length && content[offset] !== 0xff) offset += 1;
    while (offset < content.length && content[offset] === 0xff) offset += 1;
    if (offset >= content.length) break;
    const marker = content[offset++];
    if (marker === 0xd9 || marker === 0xda) break;
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) continue;
    if (offset + 1 >= content.length) return false;
    const length = content.readUInt16BE(offset);
    if (length < 2 || offset + length > content.length) return false;
    if (frames.has(marker)) {
      return (
        length >= 7 && content.readUInt16BE(offset + 3) > 0 && content.readUInt16BE(offset + 5) > 0
      );
    }
    offset += length;
  }
  return false;
}

function isSha256(value: string): boolean {
  return /^[a-f0-9]{64}$/.test(value);
}

async function decryptFile(
  source: string,
  key: Buffer,
  expectedSha256: string,
): Promise<Transform> {
  let handle;
  try {
    handle = await fs.open(source, 'r');
    const stats = await handle.stat();
    if (stats.size < HEADER_BYTES + TAG_BYTES) throw new Error('Artifact ciphertext is truncated');
    const header = Buffer.alloc(HEADER_BYTES);
    const tag = Buffer.alloc(TAG_BYTES);
    await handle.read(header, 0, HEADER_BYTES, 0);
    await handle.read(tag, 0, TAG_BYTES, stats.size - TAG_BYTES);
    if (!header.subarray(0, ARTIFACT_MAGIC.length).equals(ARTIFACT_MAGIC)) {
      throw new Error('Artifact ciphertext header is invalid');
    }
    const decipher = createDecipheriv('aes-256-gcm', key, header.subarray(ARTIFACT_MAGIC.length));
    decipher.setAuthTag(tag);
    const verifier = createHashVerifier(expectedSha256);
    void pipeline(
      createReadStream(source, { start: HEADER_BYTES, end: stats.size - TAG_BYTES - 1 }),
      decipher,
      verifier,
    ).catch((error: unknown) => verifier.destroy(error as Error));
    return verifier;
  } finally {
    await handle?.close();
  }
}

function createHashVerifier(expectedSha256: string): Transform {
  const hash = createHash('sha256');
  return new Transform({
    transform(chunk: Buffer, _encoding, callback) {
      hash.update(chunk);
      callback(null, chunk);
    },
    flush(callback) {
      const actual = hash.digest('hex');
      callback(actual === expectedSha256 ? undefined : new Error('Artifact digest mismatch'));
    },
  });
}

async function readBounded(stream: ReadStream | Transform, expectedBytes: number): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let bytes = 0;
  for await (const raw of stream) {
    const chunk = Buffer.from(raw);
    bytes += chunk.length;
    if (bytes > expectedBytes || bytes > MAX_REASONING_ARTIFACT_BYTES) {
      stream.destroy();
      for (const buffered of chunks) buffered.fill(0);
      throw new Error('Decrypted artifact exceeded its recorded size');
    }
    chunks.push(chunk);
  }
  if (bytes !== expectedBytes) {
    for (const buffered of chunks) buffered.fill(0);
    throw new Error('Decrypted artifact size did not match its record');
  }
  return Buffer.concat(chunks, bytes);
}

function safeMimeType(value: string): string {
  return /^[\w.+-]+\/[\w.+-]+$/.test(value) ? value : 'application/octet-stream';
}

function trustedMimeAllowed(
  purpose: ArtifactAttestationClaims['artifactPurpose'],
  mimeType: string,
): boolean {
  return purpose === 'REPORT'
    ? mimeType === 'application/json'
    : UPDATE_ARCHIVE_MIME_TYPES.has(mimeType);
}

function trustedArtifactTaskStatus(status: MsaidiziTaskStatus): boolean {
  return (
    status === MsaidiziTaskStatus.READY ||
    status === MsaidiziTaskStatus.QUEUED ||
    status === MsaidiziTaskStatus.RUNNING ||
    status === MsaidiziTaskStatus.PAUSED ||
    status === MsaidiziTaskStatus.COMPLETED
  );
}

function generatedEvaluationTaskStatus(status: MsaidiziTaskStatus): boolean {
  return status === MsaidiziTaskStatus.RUNNING || status === MsaidiziTaskStatus.COMPLETED;
}

function persistedJson(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(sanitizePersistedValue(value).value)) as Prisma.InputJsonValue;
}

function jsonSafe<T>(value: T): T {
  return JSON.parse(
    JSON.stringify(value, (_key, item) => (typeof item === 'bigint' ? item.toString() : item)),
  ) as T;
}
