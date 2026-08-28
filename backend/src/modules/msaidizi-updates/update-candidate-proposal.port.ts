import { createHash } from 'node:crypto';
import { sanitizePersistedValue } from '../../common/utils/persistent-secret-redaction';

export const UPDATE_CANDIDATE_PROPOSAL_CAPABILITY =
  'msaidizi.self-improvement.propose-update-candidate';
export const UPDATE_CANDIDATE_PROPOSAL_CAPABILITY_VERSION = '1';
export const UPDATE_CANDIDATE_GENERATION_CAPABILITY_VERSION = '2';

export const UPDATE_CANDIDATE_PROPOSAL_SCOPES = [
  'PROMPT',
  'SKILL',
  'APPLICATION',
  'ADAPTERS',
  'OPERATIONAL_POLICY',
  'DEPLOYMENT_CANDIDATE',
] as const;

export type UpdateCandidateProposalScope = (typeof UPDATE_CANDIDATE_PROPOSAL_SCOPES)[number];

export interface ArtifactBackedUpdateCandidateProposalArguments {
  proposalKind: 'ARTIFACT_BACKED';
  name: string;
  version: string;
  scope: UpdateCandidateProposalScope;
  sourceArtifactId: string;
  sourceArtifactSha256: string;
  rollbackArtifactId: string;
  rollbackArtifactSha256: string;
  rollbackVersion: string;
  rationale: string;
}

export type GeneratedUpdateFileOperation = 'ADD' | 'UPDATE' | 'DELETE';

export interface GeneratedUpdateFileChange {
  relativePath: string;
  operation: GeneratedUpdateFileOperation;
  expectedPreSha256: string | null;
  contentBase64: string | null;
  contentSha256: string | null;
}

export interface GeneratedUpdateEvaluationBudget {
  maxWallTimeSeconds: number;
  maxCpuTimeSeconds: number;
  maxBytesRead: bigint;
  maxBytesWritten: bigint;
  maxExternalEgressBytes: bigint;
  maxModelTurns: number;
  maxModelInputTokens: bigint;
  maxModelOutputTokens: bigint;
  maxModelCostMicrousd: bigint;
}

export interface GeneratedUpdateCandidateProposalArguments {
  proposalKind: 'GENERATED_PIPELINE';
  name: string;
  version: string;
  scope: UpdateCandidateProposalScope;
  rollbackVersion: string;
  rationale: string;
  baseRevisionSha256: string;
  changes: GeneratedUpdateFileChange[];
  evaluationBudget: GeneratedUpdateEvaluationBudget;
}

export type UpdateCandidateProposalArguments =
  | ArtifactBackedUpdateCandidateProposalArguments
  | GeneratedUpdateCandidateProposalArguments;

export interface UpdateCandidateProposalRequest {
  taskId: string;
  planVersionId: string;
  stepId: string;
  attemptId: string;
}

export interface UpdateCandidateProposalResult {
  candidateId: string;
  status:
    | 'DRAFT'
    | 'EVALUATING'
    | 'APPROVED'
    | 'REJECTED'
    | 'CANARY'
    | 'ACTIVE'
    | 'ROLLED_BACK'
    | 'FAILED';
  scope: UpdateCandidateProposalScope;
  proposalDigest: string;
  sourceArtifactSha256: string | null;
  rollbackArtifactSha256: string | null;
  generationArtifactSha256?: string;
  evaluationRunId?: string;
  evaluationRunStatus?:
    | 'QUEUED'
    | 'LEASED'
    | 'RUNNING'
    | 'SUCCEEDED'
    | 'REJECTED'
    | 'FAILED'
    | 'NEEDS_ATTENTION'
    | 'CANCELLED';
  rollbackVersion: string;
  replay: boolean;
}

/**
 * Internal-only port. Its contract intentionally has no approve, sign, evaluate,
 * rollout, or deployment method: autonomous code can propose a DRAFT and no more.
 */
export abstract class UpdateCandidateProposalPort {
  abstract propose(request: UpdateCandidateProposalRequest): Promise<UpdateCandidateProposalResult>;
}

export class UpdateCandidateProposalPolicyError extends Error {
  constructor(
    readonly code: string,
    message = code,
  ) {
    super(message);
    this.name = 'UpdateCandidateProposalPolicyError';
  }
}

export const PROTECTED_SELF_IMPROVEMENT_BOUNDARY =
  /(?:bootstrap|trust.?key|kill.?switch|audit.?signer|audit.?mechanism|recovery.?vault|recovery.?control|update.?verif|supervisor|device.?identity|hardware.?key)/i;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SHA256 = /^[0-9a-f]{64}$/i;
const VERSION = /^[A-Za-z0-9][A-Za-z0-9._+-]{0,79}$/;
const NAME = /^[A-Za-z0-9][A-Za-z0-9 ._:/+-]{0,159}$/;
const ARGUMENT_KEYS = [
  'name',
  'rationale',
  'rollbackArtifactId',
  'rollbackArtifactSha256',
  'rollbackVersion',
  'scope',
  'sourceArtifactId',
  'sourceArtifactSha256',
  'version',
] as const;
const GENERATED_ARGUMENT_KEYS = [
  'baseRevisionSha256',
  'changes',
  'evaluationBudget',
  'name',
  'rationale',
  'rollbackVersion',
  'scope',
  'version',
] as const;
const GENERATED_CHANGE_KEYS = [
  'contentBase64',
  'contentSha256',
  'expectedPreSha256',
  'operation',
  'relativePath',
] as const;
const GENERATED_BUDGET_KEYS = [
  'maxBytesRead',
  'maxBytesWritten',
  'maxCpuTimeSeconds',
  'maxExternalEgressBytes',
  'maxModelCostMicrousd',
  'maxModelInputTokens',
  'maxModelOutputTokens',
  'maxModelTurns',
  'maxWallTimeSeconds',
] as const;
const MAX_GENERATED_FILES = 128;
const MAX_GENERATED_FILE_BYTES = 1 * 1024 * 1024;
const MAX_GENERATED_TOTAL_BYTES = 4 * 1024 * 1024;
export const GENERATED_UPDATE_POLICY_VERSION = 'msaidizi-generated-update-policy/v1' as const;
const PROTECTED_GENERATED_UPDATE_PATH_POLICY = Object.freeze({
  version: GENERATED_UPDATE_POLICY_VERSION,
  exact: [
    '.env.production.example',
    'backend/.env.production.example',
    'backend/dockerfile',
    'backend/nest-cli.json',
    'backend/package-lock.json',
    'backend/package.json',
    'backend/tsconfig.build.json',
    'backend/tsconfig.json',
    'backend/src/app.module.ts',
    'backend/src/common/decorators/agent-excluded.decorator.ts',
    'backend/src/common/services/company-scope.service.ts',
    'backend/src/common/services/permission-cache.service.ts',
    'backend/src/common/interceptors/sensitive-access.interceptor.ts',
    'backend/src/common/utils/action-envelope.ts',
    'backend/src/common/utils/log-scrubber.ts',
    'backend/src/common/utils/persistent-secret-redaction.ts',
    'backend/src/main.ts',
    'backend/src/modules/msaidizi/msaidizi.config.ts',
    'backend/src/modules/msaidizi/msaidizi.module.ts',
    'backend/src/modules/msaidizi-tasks/autonomy.config.ts',
    'database/prisma/schema.prisma',
    'docker-compose.production.yml',
    'docker-compose.staging.yml',
    'package-lock.json',
    'package.json',
    'windows-companion/directory.build.props',
    'windows-companion/directory.packages.props',
    'windows-companion/global.json',
    'windows-companion/msaidizi.windowscompanion.sln',
    'windows-companion/src/msaidizi.companion.agent/msaidizi.companion.agent.csproj',
    'windows-companion/src/msaidizi.companion.contracts/msaidizi.companion.contracts.csproj',
    'windows-companion/src/msaidizi.companion.service/msaidizi.companion.service.csproj',
    'windows-companion/src/msaidizi.companion.service/program.cs',
    'windows-companion/src/msaidizi.companion.service/companionworker.cs',
    'windows-companion/src/msaidizi.companion.service/appsettings.json',
  ],
  prefixes: [
    '.github/workflows/',
    'backend/scripts/',
    'backend/src/common/capabilities/',
    'backend/src/common/context/',
    'backend/src/common/decorators/',
    'backend/src/common/guards/',
    'backend/src/common/interceptors/',
    'backend/src/common/policies/',
    'backend/src/config/',
    'backend/src/modules/audit-logs/',
    'backend/src/modules/auth/',
    'backend/src/modules/msaidizi-audit-signer/',
    'backend/src/modules/msaidizi-control-plane/',
    'backend/src/modules/msaidizi-devices/',
    'backend/src/modules/msaidizi-recovery/',
    'backend/src/modules/msaidizi-task-runtime/',
    'backend/src/modules/msaidizi-tasks/',
    'backend/src/modules/msaidizi-updates/',
    'backend/src/modules/msaidizi/crud-mutation-autonomy-release-evidence',
    'backend/src/modules/msaidizi/production-release-gate',
    'backend/src/modules/msaidizi/provider-contract-attestation',
    'backend/src/prisma/',
    'backend/src/modules/security/',
    'backend/src/modules/security-events/',
    'backend/src/modules/security-policies/',
    'database/prisma/migrations/',
    'deploy/',
    'windows-companion/config/',
    'windows-companion/installer/',
    'windows-companion/locks/',
    'windows-companion/scripts/',
    'windows-companion/src/msaidizi.auditsigner/',
    'windows-companion/src/msaidizi.egresssupervisor/',
    'windows-companion/src/msaidizi.privilegedcommandsupervisor/',
    'windows-companion/src/msaidizi.recoverysupervisor/',
    'windows-companion/src/msaidizi.updatesupervisor/',
    'windows-companion/src/msaidizi.companion.service/channel/',
    'windows-companion/src/msaidizi.companion.service/configuration/',
    'windows-companion/src/msaidizi.companion.service/execution/',
    'windows-companion/src/msaidizi.companion.service/journal/',
    'windows-companion/src/msaidizi.companion.service/security/',
    'windows-companion/src/msaidizi.companion.contracts/security/',
  ],
  serviceCapabilityFragments: [
    'capabilityregistry',
    'egress',
    'privilegedcommand',
    'recovery',
    'trustedroot',
    'vault',
  ],
});

export const GENERATED_UPDATE_PROTECTED_PATH_POLICY_SHA256 = createHash('sha256')
  .update(stableStringify(PROTECTED_GENERATED_UPDATE_PATH_POLICY), 'utf8')
  .digest('hex');

export function proposalDataClass(scope: UpdateCandidateProposalScope): string {
  return `msaidizi.self-improvement.${scope.toLowerCase().replaceAll('_', '-')}`;
}

export function generatedUpdateProposalArgumentsSchema(
  scope: UpdateCandidateProposalScope,
): Record<string, unknown> {
  const digest = { type: 'string', pattern: '^[0-9a-f]{64}$' };
  const canonicalInteger = { type: 'string', pattern: '^(0|[1-9][0-9]*)$' };
  return {
    type: 'object',
    additionalProperties: false,
    required: [...GENERATED_ARGUMENT_KEYS],
    properties: {
      name: { type: 'string' },
      version: { type: 'string' },
      scope: { type: 'string', enum: [scope] },
      rollbackVersion: { type: 'string' },
      rationale: { type: 'string' },
      baseRevisionSha256: digest,
      changes: {
        type: 'array',
        minItems: 1,
        maxItems: MAX_GENERATED_FILES,
        items: {
          type: 'object',
          additionalProperties: false,
          required: [...GENERATED_CHANGE_KEYS],
          properties: {
            relativePath: { type: 'string' },
            operation: { type: 'string', enum: ['ADD', 'UPDATE', 'DELETE'] },
            expectedPreSha256: {},
            contentBase64: {},
            contentSha256: {},
          },
        },
      },
      evaluationBudget: {
        type: 'object',
        additionalProperties: false,
        required: [...GENERATED_BUDGET_KEYS],
        properties: {
          maxWallTimeSeconds: { type: 'integer' },
          maxCpuTimeSeconds: { type: 'integer' },
          maxBytesRead: canonicalInteger,
          maxBytesWritten: canonicalInteger,
          maxExternalEgressBytes: canonicalInteger,
          maxModelTurns: { type: 'integer' },
          maxModelInputTokens: canonicalInteger,
          maxModelOutputTokens: canonicalInteger,
          maxModelCostMicrousd: canonicalInteger,
        },
      },
    },
  };
}

export function parseUpdateCandidateProposalArguments(
  value: unknown,
): UpdateCandidateProposalArguments {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new UpdateCandidateProposalPolicyError(
      'UPDATE_PROPOSAL_ARGUMENTS_INVALID',
      'Update proposal arguments must be an object',
    );
  }
  const input = value as Record<string, unknown>;
  const keys = Object.keys(input).sort();
  if (
    keys.length === GENERATED_ARGUMENT_KEYS.length &&
    keys.every((key, index) => key === GENERATED_ARGUMENT_KEYS[index])
  ) {
    return parseGeneratedUpdateCandidateProposalArguments(input);
  }
  if (
    keys.length !== ARGUMENT_KEYS.length ||
    keys.some((key, index) => key !== ARGUMENT_KEYS[index])
  ) {
    throw new UpdateCandidateProposalPolicyError(
      'UPDATE_PROPOSAL_ARGUMENTS_INVALID',
      'Update proposal arguments must match the exact internal schema',
    );
  }

  const name = normalizedText(input.name, 160, 'name');
  const version = normalizedText(input.version, 80, 'version');
  const rollbackVersion = normalizedText(input.rollbackVersion, 80, 'rollbackVersion');
  const rationale = normalizedText(input.rationale, 2_000, 'rationale', true);
  if (!NAME.test(name) || !VERSION.test(version) || !VERSION.test(rollbackVersion)) {
    throw new UpdateCandidateProposalPolicyError(
      'UPDATE_PROPOSAL_ARGUMENTS_INVALID',
      'Update proposal name or version is invalid',
    );
  }
  if (!isProposalScope(input.scope)) {
    throw new UpdateCandidateProposalPolicyError(
      'UPDATE_PROPOSAL_SCOPE_DENIED',
      'Update proposal scope is not in the closed allowlist',
    );
  }
  const sourceArtifactId = uuid(input.sourceArtifactId, 'sourceArtifactId');
  const rollbackArtifactId = uuid(input.rollbackArtifactId, 'rollbackArtifactId');
  if (sourceArtifactId === rollbackArtifactId) {
    throw new UpdateCandidateProposalPolicyError(
      'UPDATE_PROPOSAL_ARTIFACTS_INVALID',
      'Source and rollback artifacts must be distinct',
    );
  }
  const sourceArtifactSha256 = sha256(input.sourceArtifactSha256, 'sourceArtifactSha256');
  const rollbackArtifactSha256 = sha256(input.rollbackArtifactSha256, 'rollbackArtifactSha256');

  const parsed: UpdateCandidateProposalArguments = {
    proposalKind: 'ARTIFACT_BACKED',
    name,
    version,
    scope: input.scope,
    sourceArtifactId,
    sourceArtifactSha256,
    rollbackArtifactId,
    rollbackArtifactSha256,
    rollbackVersion,
    rationale,
  };
  const dlp = sanitizePersistedValue(parsed);
  if (dlp.redactionsApplied) {
    throw new UpdateCandidateProposalPolicyError(
      'UPDATE_PROPOSAL_SECRET_REFUSED',
      'Credential-like data is not allowed in update proposal metadata',
    );
  }
  if (
    PROTECTED_SELF_IMPROVEMENT_BOUNDARY.test(parsed.name) ||
    PROTECTED_SELF_IMPROVEMENT_BOUNDARY.test(parsed.rationale)
  ) {
    throw new UpdateCandidateProposalPolicyError(
      'UPDATE_PROPOSAL_PROTECTED_SCOPE',
      'Update proposal intersects the trusted supervisor boundary',
    );
  }
  return parsed;
}

export function assertUpdateCandidateProposalStep(step: {
  target: string;
  capability: string;
  capabilityVersion: string;
  arguments: unknown;
  expectedEffect: string;
  dataClass: string;
  idempotent: boolean;
  mutation: boolean;
}): UpdateCandidateProposalArguments {
  if (
    step.target !== 'SELF_IMPROVEMENT' ||
    step.capability !== UPDATE_CANDIDATE_PROPOSAL_CAPABILITY ||
    ![
      UPDATE_CANDIDATE_PROPOSAL_CAPABILITY_VERSION,
      UPDATE_CANDIDATE_GENERATION_CAPABILITY_VERSION,
    ].includes(step.capabilityVersion) ||
    step.expectedEffect !== 'WRITE' ||
    !step.idempotent ||
    !step.mutation
  ) {
    throw new UpdateCandidateProposalPolicyError(
      'UPDATE_PROPOSAL_STEP_NOT_AUTHORIZED',
      'Self-improvement steps must use the exact DRAFT proposal capability contract',
    );
  }
  const args = parseUpdateCandidateProposalArguments(step.arguments);
  if (
    (args.proposalKind === 'ARTIFACT_BACKED' &&
      step.capabilityVersion !== UPDATE_CANDIDATE_PROPOSAL_CAPABILITY_VERSION) ||
    (args.proposalKind === 'GENERATED_PIPELINE' &&
      step.capabilityVersion !== UPDATE_CANDIDATE_GENERATION_CAPABILITY_VERSION)
  ) {
    throw new UpdateCandidateProposalPolicyError(
      'UPDATE_PROPOSAL_STEP_NOT_AUTHORIZED',
      'Self-improvement argument schema does not match its capability version',
    );
  }
  if (step.dataClass !== proposalDataClass(args.scope)) {
    throw new UpdateCandidateProposalPolicyError(
      'UPDATE_PROPOSAL_DATA_CLASS_MISMATCH',
      'Update proposal scope does not match the reviewed step data class',
    );
  }
  return args;
}

export function mandateAuthorizesUpdateCandidateProposal(
  rawCapabilities: unknown,
  step: {
    capability: string;
    capabilityVersion: string;
    expectedEffect: string;
    dataClass: string;
  },
): boolean {
  if (!Array.isArray(rawCapabilities)) return false;
  return rawCapabilities.some((entry) => {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return false;
    const grant = entry as Record<string, unknown>;
    const effects = stringArray(grant.effects);
    const dataClasses = stringArray(grant.dataClasses);
    return (
      grant.capability === UPDATE_CANDIDATE_PROPOSAL_CAPABILITY &&
      step.capability === UPDATE_CANDIDATE_PROPOSAL_CAPABILITY &&
      grant.version === step.capabilityVersion &&
      [
        UPDATE_CANDIDATE_PROPOSAL_CAPABILITY_VERSION,
        UPDATE_CANDIDATE_GENERATION_CAPABILITY_VERSION,
      ].includes(step.capabilityVersion) &&
      step.expectedEffect === 'WRITE' &&
      effects.includes('WRITE') &&
      dataClasses.includes(step.dataClass) &&
      !dataClasses.includes('*')
    );
  });
}

export function updateCandidateProposalDigest(
  taskId: string,
  planVersionId: string,
  stepId: string,
  args: UpdateCandidateProposalArguments,
): string {
  return digest({
    protocol: 'msaidizi-update-candidate-proposal/v1',
    taskId,
    planVersionId,
    stepId,
    args,
  });
}

export function generatedUpdateManifest(
  taskId: string,
  planVersionId: string,
  stepId: string,
  attemptId: string,
  args: GeneratedUpdateCandidateProposalArguments,
): { canonicalJson: string; sha256: string; byteSize: number } {
  const manifest = {
    protocol: GENERATED_UPDATE_POLICY_VERSION,
    taskId,
    planVersionId,
    stepId,
    attemptId,
    name: args.name,
    version: args.version,
    rollbackVersion: args.rollbackVersion,
    scope: args.scope,
    rationale: args.rationale,
    baseRevisionSha256: args.baseRevisionSha256,
    changes: args.changes,
    evaluationBudget: serializeEvaluationBudget(args.evaluationBudget),
    protectedSupervisorBoundary: 'EXCLUDED',
    protectedPathPolicyVersion: GENERATED_UPDATE_POLICY_VERSION,
    protectedPathPolicySha256: GENERATED_UPDATE_PROTECTED_PATH_POLICY_SHA256,
  };
  const canonicalJson = stableStringify(manifest);
  return {
    canonicalJson,
    sha256: createHash('sha256').update(canonicalJson, 'utf8').digest('hex'),
    byteSize: Buffer.byteLength(canonicalJson, 'utf8'),
  };
}

export function generatedUpdateRequiredChecks(): Record<string, boolean> {
  return {
    isolatedWindowsVm: true,
    baseRevisionMatch: true,
    tests: true,
    staticAnalysis: true,
    adversarialEvaluation: true,
    supervisorIntegrity: true,
    protectedBoundaryDiff: true,
    ntfsReparseHardLinkAndToctouIsolation: true,
    dualIndependentModelReview: true,
  };
}

export function generatedUpdateEvaluationRequestDigest(input: {
  candidateId: string;
  evaluationRunId: string;
  manifestSha256: string;
  proposalDigest: string;
  generatorModelId: string;
  args: GeneratedUpdateCandidateProposalArguments;
}): string {
  return digest({
    protocol: 'msaidizi-update-evaluation-request/v1',
    candidateId: input.candidateId,
    evaluationRunId: input.evaluationRunId,
    manifestSha256: input.manifestSha256,
    proposalDigest: input.proposalDigest,
    generatorModelId: input.generatorModelId,
    policyVersion: GENERATED_UPDATE_POLICY_VERSION,
    policyDigest: GENERATED_UPDATE_PROTECTED_PATH_POLICY_SHA256,
    budget: serializeEvaluationBudget(input.args.evaluationBudget),
    requiredChecks: generatedUpdateRequiredChecks(),
  });
}

export function isGeneratedUpdateCandidateProposal(
  args: UpdateCandidateProposalArguments,
): args is GeneratedUpdateCandidateProposalArguments {
  return args.proposalKind === 'GENERATED_PIPELINE';
}

export function assertGeneratedUpdateProtectedBoundary(
  args: GeneratedUpdateCandidateProposalArguments,
): void {
  for (const change of args.changes) {
    if (isProtectedGeneratedUpdatePath(change.relativePath)) {
      throw policy('UPDATE_PROPOSAL_PROTECTED_SCOPE');
    }
  }
}

/**
 * Applies the ordinary persistence DLP after replacing only source bytes from
 * an exact, fully validated v2 generated-update step with their already-bound
 * SHA-256 marker. No field-name or Base64-wide exemption exists: malformed
 * steps, v1 steps, unrelated payloads, and decoded credential-like content all
 * fail closed through the normal detector.
 */
export function containsPersistedSecretWithGeneratedUpdateAllowance(value: unknown): boolean {
  try {
    const masked = maskValidatedGeneratedUpdateSteps(value);
    return sanitizePersistedValue(masked).redactionsApplied;
  } catch {
    return true;
  }
}

export function updateProposalStepContainsPersistedSecret(step: {
  target: string;
  capability: string;
  capabilityVersion: string;
  arguments: unknown;
  expectedEffect: string;
  dataClass: string;
  idempotent: boolean;
  mutation: boolean;
}): boolean {
  return containsPersistedSecretWithGeneratedUpdateAllowance(step);
}

export function persistableUpdateProposalStepArguments(step: {
  target: string;
  capability: string;
  capabilityVersion: string;
  arguments: unknown;
  expectedEffect: string;
  dataClass: string;
  idempotent: boolean;
  mutation: boolean;
}): unknown {
  if (
    step.target === 'SELF_IMPROVEMENT' &&
    step.capability === UPDATE_CANDIDATE_PROPOSAL_CAPABILITY &&
    step.capabilityVersion === UPDATE_CANDIDATE_GENERATION_CAPABILITY_VERSION
  ) {
    const parsed = assertUpdateCandidateProposalStep(step);
    if (!isGeneratedUpdateCandidateProposal(parsed)) {
      throw policy('UPDATE_PROPOSAL_STEP_NOT_AUTHORIZED');
    }
    // Parsing already decoded every source, verified each digest, scanned the
    // decoded UTF-8 for secrets, and applied the protected-path policy.
    return JSON.parse(JSON.stringify(step.arguments));
  }
  return sanitizePersistedValue(step.arguments).value;
}

export function updateCandidateProposalIdempotencyKey(
  taskId: string,
  planVersionId: string,
  stepId: string,
): string {
  return digest({
    protocol: 'msaidizi-update-candidate-proposal/v1',
    taskId,
    planVersionId,
    stepId,
  });
}

function normalizedText(value: unknown, maximum: number, field: string, multiline = false): string {
  if (typeof value !== 'string') {
    throw new UpdateCandidateProposalPolicyError(
      'UPDATE_PROPOSAL_ARGUMENTS_INVALID',
      `Update proposal ${field} must be text`,
    );
  }
  const normalized = value.replace(/\r\n?/g, '\n').trim();
  const controls = multiline
    ? /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/
    : /[\u0000-\u001f\u007f]/;
  if (!normalized || normalized.length > maximum || controls.test(normalized)) {
    throw new UpdateCandidateProposalPolicyError(
      'UPDATE_PROPOSAL_ARGUMENTS_INVALID',
      `Update proposal ${field} is invalid`,
    );
  }
  return normalized;
}

function uuid(value: unknown, field: string): string {
  if (typeof value !== 'string' || !UUID.test(value)) {
    throw new UpdateCandidateProposalPolicyError(
      'UPDATE_PROPOSAL_ARGUMENTS_INVALID',
      `Update proposal ${field} must be a UUID`,
    );
  }
  return value.toLowerCase();
}

function sha256(value: unknown, field: string): string {
  if (typeof value !== 'string' || !SHA256.test(value)) {
    throw new UpdateCandidateProposalPolicyError(
      'UPDATE_PROPOSAL_ARGUMENTS_INVALID',
      `Update proposal ${field} must be a SHA-256 digest`,
    );
  }
  return value.toLowerCase();
}

function isProposalScope(value: unknown): value is UpdateCandidateProposalScope {
  return (UPDATE_CANDIDATE_PROPOSAL_SCOPES as readonly unknown[]).includes(value);
}

function parseGeneratedUpdateCandidateProposalArguments(
  input: Record<string, unknown>,
): GeneratedUpdateCandidateProposalArguments {
  const name = normalizedText(input.name, 160, 'name');
  const version = normalizedText(input.version, 80, 'version');
  const rollbackVersion = normalizedText(input.rollbackVersion, 80, 'rollbackVersion');
  const rationale = normalizedText(input.rationale, 2_000, 'rationale', true);
  if (!NAME.test(name) || !VERSION.test(version) || !VERSION.test(rollbackVersion)) {
    throw policy('UPDATE_PROPOSAL_ARGUMENTS_INVALID');
  }
  if (!isProposalScope(input.scope)) throw policy('UPDATE_PROPOSAL_SCOPE_DENIED');
  const baseRevisionSha256 = sha256(input.baseRevisionSha256, 'baseRevisionSha256');
  const changes = parseGeneratedChanges(input.changes, input.scope);
  const evaluationBudget = parseGeneratedEvaluationBudget(input.evaluationBudget);
  const parsed: GeneratedUpdateCandidateProposalArguments = {
    proposalKind: 'GENERATED_PIPELINE',
    name,
    version,
    scope: input.scope,
    rollbackVersion,
    rationale,
    baseRevisionSha256,
    changes,
    evaluationBudget,
  };
  const metadata = sanitizePersistedValue({
    name,
    version,
    rollbackVersion,
    rationale,
    baseRevisionSha256,
    paths: changes.map((change) => change.relativePath),
  });
  if (metadata.redactionsApplied) throw policy('UPDATE_PROPOSAL_SECRET_REFUSED');
  if (
    PROTECTED_SELF_IMPROVEMENT_BOUNDARY.test(name) ||
    PROTECTED_SELF_IMPROVEMENT_BOUNDARY.test(rationale)
  ) {
    throw policy('UPDATE_PROPOSAL_PROTECTED_SCOPE');
  }
  return parsed;
}

function parseGeneratedChanges(
  value: unknown,
  scope: UpdateCandidateProposalScope,
): GeneratedUpdateFileChange[] {
  if (!Array.isArray(value) || value.length === 0 || value.length > MAX_GENERATED_FILES) {
    throw policy('UPDATE_PROPOSAL_CHANGESET_INVALID');
  }
  let totalBytes = 0;
  const seen = new Set<string>();
  const changes = value.map((entry) => {
    const input = exactRecord(entry, GENERATED_CHANGE_KEYS, 'UPDATE_PROPOSAL_CHANGESET_INVALID');
    const relativePath = generatedPath(input.relativePath, scope);
    const pathKey = windowsPathKey(relativePath);
    if (seen.has(pathKey)) throw policy('UPDATE_PROPOSAL_CHANGESET_INVALID');
    seen.add(pathKey);
    const operation = input.operation;
    if (!['ADD', 'UPDATE', 'DELETE'].includes(String(operation))) {
      throw policy('UPDATE_PROPOSAL_CHANGESET_INVALID');
    }
    const expectedPreSha256 = nullableSha256(input.expectedPreSha256, 'expectedPreSha256');
    const contentSha256 = nullableSha256(input.contentSha256, 'contentSha256');
    const contentBase64 = input.contentBase64;
    if (
      (operation === 'ADD' && expectedPreSha256 !== null) ||
      ((operation === 'UPDATE' || operation === 'DELETE') && expectedPreSha256 === null) ||
      (operation === 'DELETE' && (contentBase64 !== null || contentSha256 !== null)) ||
      (operation !== 'DELETE' &&
        (typeof contentBase64 !== 'string' || contentSha256 === null || !contentBase64))
    ) {
      throw policy('UPDATE_PROPOSAL_CHANGESET_INVALID');
    }
    if (operation !== 'DELETE') {
      const decoded = decodeCanonicalBase64(contentBase64 as string);
      totalBytes += decoded.length;
      if (
        decoded.length === 0 ||
        decoded.length > MAX_GENERATED_FILE_BYTES ||
        totalBytes > MAX_GENERATED_TOTAL_BYTES ||
        createHash('sha256').update(decoded).digest('hex') !== contentSha256
      ) {
        decoded.fill(0);
        throw policy('UPDATE_PROPOSAL_CHANGESET_INVALID');
      }
      try {
        const text = new TextDecoder('utf-8', { fatal: true }).decode(decoded);
        if (sanitizePersistedValue(text).redactionsApplied) {
          throw policy('UPDATE_PROPOSAL_SECRET_REFUSED');
        }
      } finally {
        decoded.fill(0);
      }
    }
    return {
      relativePath,
      operation: operation as GeneratedUpdateFileOperation,
      expectedPreSha256,
      contentBase64: operation === 'DELETE' ? null : (contentBase64 as string),
      contentSha256: operation === 'DELETE' ? null : contentSha256,
    };
  });
  const paths = changes.map((change) => windowsPathKey(change.relativePath));
  if (paths.some((path, index) => index > 0 && paths[index - 1] >= path)) {
    throw policy('UPDATE_PROPOSAL_CHANGESET_NOT_CANONICAL');
  }
  return changes;
}

function maskValidatedGeneratedUpdateSteps(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(maskValidatedGeneratedUpdateSteps);
  if (!value || typeof value !== 'object') return value;
  const record = value as Record<string, unknown>;
  if (
    record.target === 'SELF_IMPROVEMENT' &&
    record.capability === UPDATE_CANDIDATE_PROPOSAL_CAPABILITY &&
    record.capabilityVersion === UPDATE_CANDIDATE_GENERATION_CAPABILITY_VERSION
  ) {
    const args = assertUpdateCandidateProposalStep({
      target: String(record.target),
      capability: String(record.capability),
      capabilityVersion: String(record.capabilityVersion),
      arguments: record.arguments,
      expectedEffect: String(record.expectedEffect),
      dataClass: String(record.dataClass),
      idempotent: record.idempotent === true,
      mutation: record.mutation === true,
    });
    if (!isGeneratedUpdateCandidateProposal(args)) {
      throw policy('UPDATE_PROPOSAL_STEP_NOT_AUTHORIZED');
    }
    const originalArgs = record.arguments as Record<string, unknown>;
    const maskedArguments = {
      ...originalArgs,
      changes: args.changes.map((change) => ({
        ...change,
        contentBase64: change.contentBase64 === null ? null : '[VALIDATED GENERATED SOURCE]',
      })),
      // The generic DLP correctly treats arbitrary `*Token*` keys as secret
      // containers. This exact budget has already been parsed as bounded
      // canonical integers, so mask the whole validated value rather than
      // weakening that global key policy for maxModelInputTokens/outputTokens.
      evaluationBudget: '[VALIDATED GENERATED EVALUATION BUDGET]',
    };
    return Object.fromEntries(
      Object.entries(record).map(([key, child]) => [
        key,
        key === 'arguments' ? maskedArguments : maskValidatedGeneratedUpdateSteps(child),
      ]),
    );
  }
  return Object.fromEntries(
    Object.entries(record).map(([key, child]) => [key, maskValidatedGeneratedUpdateSteps(child)]),
  );
}

function parseGeneratedEvaluationBudget(value: unknown): GeneratedUpdateEvaluationBudget {
  const input = exactRecord(value, GENERATED_BUDGET_KEYS, 'UPDATE_PROPOSAL_BUDGET_INVALID');
  const maxWallTimeSeconds = boundedInteger(input.maxWallTimeSeconds, 60, 7_200);
  const maxCpuTimeSeconds = boundedInteger(input.maxCpuTimeSeconds, 1, maxWallTimeSeconds * 8);
  const maxBytesRead = canonicalBigInt(input.maxBytesRead, 1n, 5_368_709_120n);
  const maxBytesWritten = canonicalBigInt(input.maxBytesWritten, 1n, 5_368_709_120n);
  if (maxBytesRead + maxBytesWritten > 5_368_709_120n) {
    throw policy('UPDATE_PROPOSAL_BUDGET_INVALID');
  }
  return {
    maxWallTimeSeconds,
    maxCpuTimeSeconds,
    maxBytesRead,
    maxBytesWritten,
    maxExternalEgressBytes: canonicalBigInt(input.maxExternalEgressBytes, 0n, 262_144_000n),
    maxModelTurns: boundedInteger(input.maxModelTurns, 2, 20),
    maxModelInputTokens: canonicalBigInt(input.maxModelInputTokens, 1n, 2_000_000n),
    maxModelOutputTokens: canonicalBigInt(input.maxModelOutputTokens, 1n, 200_000n),
    maxModelCostMicrousd: canonicalBigInt(input.maxModelCostMicrousd, 0n, 20_000_000n),
  };
}

function generatedPath(value: unknown, scope: UpdateCandidateProposalScope): string {
  if (typeof value !== 'string' || value !== value.normalize('NFC')) {
    throw policy('UPDATE_PROPOSAL_PATH_INVALID');
  }
  const path = value.replaceAll('\\', '/');
  const segments = path.split('/');
  if (
    path !== value ||
    path.length === 0 ||
    path.length > 240 ||
    path.startsWith('/') ||
    /[:\u0000-\u001f\u007f]/.test(path) ||
    segments.some(
      (segment) =>
        !segment ||
        segment === '.' ||
        segment === '..' ||
        /[. ]$/.test(segment) ||
        /^(?:con|prn|aux|nul|clock\$|com[1-9]|lpt[1-9])(?:\..*)?$/i.test(segment),
    ) ||
    isProtectedGeneratedUpdatePath(path) ||
    !pathAllowedForScope(path, scope)
  ) {
    throw policy('UPDATE_PROPOSAL_PROTECTED_SCOPE');
  }
  return path;
}

function windowsPathKey(path: string): string {
  return path.normalize('NFC').toLocaleLowerCase('en-US');
}

function isProtectedGeneratedUpdatePath(path: string): boolean {
  const canonical = path.toLowerCase();
  if (PROTECTED_GENERATED_UPDATE_PATH_POLICY.exact.includes(canonical)) return true;
  if (
    PROTECTED_GENERATED_UPDATE_PATH_POLICY.prefixes.some((prefix) => canonical.startsWith(prefix))
  ) {
    return true;
  }
  const serviceCapabilities = 'windows-companion/src/msaidizi.companion.service/capabilities/';
  if (canonical.startsWith(serviceCapabilities)) {
    const file = canonical.slice(serviceCapabilities.length);
    if (
      PROTECTED_GENERATED_UPDATE_PATH_POLICY.serviceCapabilityFragments.some((fragment) =>
        file.includes(fragment),
      )
    ) {
      return true;
    }
  }
  return PROTECTED_SELF_IMPROVEMENT_BOUNDARY.test(canonical);
}

function pathAllowedForScope(path: string, scope: UpdateCandidateProposalScope): boolean {
  const roots: Record<UpdateCandidateProposalScope, readonly string[]> = {
    PROMPT: ['backend/src/modules/msaidizi/', 'backend/src/modules/msaidizi-reasoning/'],
    SKILL: ['skills/', 'backend/src/modules/msaidizi-skills/'],
    APPLICATION: ['backend/', 'frontend/', 'mobile/', 'database/'],
    ADAPTERS: [
      'backend/src/modules/msaidizi-devices/',
      'windows-companion/src/Msaidizi.Companion.Agent/',
      'windows-companion/src/Msaidizi.Companion.Contracts/',
      'windows-companion/src/Msaidizi.Companion.Service/',
    ],
    OPERATIONAL_POLICY: ['backend/src/modules/msaidizi/', 'config/', 'docs/'],
    DEPLOYMENT_CANDIDATE: ['backend/', 'frontend/', 'mobile/', 'database/', 'deploy/'],
  };
  const canonical = windowsPathKey(path);
  return roots[scope].some((root) => canonical.startsWith(windowsPathKey(root)));
}

function decodeCanonicalBase64(value: string): Buffer {
  if (!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value)) {
    throw policy('UPDATE_PROPOSAL_CHANGESET_INVALID');
  }
  const decoded = Buffer.from(value, 'base64');
  if (decoded.toString('base64') !== value) {
    decoded.fill(0);
    throw policy('UPDATE_PROPOSAL_CHANGESET_INVALID');
  }
  return decoded;
}

function exactRecord(
  value: unknown,
  keys: readonly string[],
  code: string,
): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw policy(code);
  const input = value as Record<string, unknown>;
  const actual = Object.keys(input).sort();
  const expected = [...keys].sort();
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) {
    throw policy(code);
  }
  return input;
}

function nullableSha256(value: unknown, field: string): string | null {
  return value === null ? null : sha256(value, field);
}

function boundedInteger(value: unknown, minimum: number, maximum: number): number {
  if (!Number.isSafeInteger(value) || (value as number) < minimum || (value as number) > maximum) {
    throw policy('UPDATE_PROPOSAL_BUDGET_INVALID');
  }
  return value as number;
}

function canonicalBigInt(value: unknown, minimum: bigint, maximum: bigint): bigint {
  if (typeof value !== 'string' || !/^(0|[1-9][0-9]{0,19})$/.test(value)) {
    throw policy('UPDATE_PROPOSAL_BUDGET_INVALID');
  }
  const parsed = BigInt(value);
  if (parsed < minimum || parsed > maximum) throw policy('UPDATE_PROPOSAL_BUDGET_INVALID');
  return parsed;
}

function serializeEvaluationBudget(
  budget: GeneratedUpdateEvaluationBudget,
): Record<string, string | number> {
  return {
    maxWallTimeSeconds: budget.maxWallTimeSeconds,
    maxCpuTimeSeconds: budget.maxCpuTimeSeconds,
    maxBytesRead: budget.maxBytesRead.toString(),
    maxBytesWritten: budget.maxBytesWritten.toString(),
    maxExternalEgressBytes: budget.maxExternalEgressBytes.toString(),
    maxModelTurns: budget.maxModelTurns,
    maxModelInputTokens: budget.maxModelInputTokens.toString(),
    maxModelOutputTokens: budget.maxModelOutputTokens.toString(),
    maxModelCostMicrousd: budget.maxModelCostMicrousd.toString(),
  };
}

function policy(code: string): UpdateCandidateProposalPolicyError {
  return new UpdateCandidateProposalPolicyError(code);
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((entry): entry is string => typeof entry === 'string')
    : [];
}

function digest(value: unknown): string {
  return createHash('sha256').update(stableStringify(value), 'utf8').digest('hex');
}

function stableStringify(value: unknown): string {
  if (typeof value === 'bigint') return JSON.stringify(value.toString());
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableStringify(record[key])}`)
      .join(',')}}`;
  }
  return JSON.stringify(value);
}
