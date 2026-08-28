/**
 * Durable-task wire contract for `/msaidizi/tasks`.
 *
 * This is deliberately separate from the request-bound conversation contract.
 * Counters that are `BigInt` or `Decimal` in Prisma cross JSON as strings; keep
 * them as strings here so a large byte count is never rounded in the browser.
 */

export const MSAIDIZI_TASK_MODES = ['ASK', 'COLLABORATIVE', 'AUTOPILOT'] as const;
export type MsaidiziTaskMode = (typeof MSAIDIZI_TASK_MODES)[number];

export const MSAIDIZI_TASK_STATUSES = [
  'PLANNING',
  'READY',
  'QUEUED',
  'RUNNING',
  'PAUSING',
  'PAUSED',
  'CANCELLING',
  'COMPLETED',
  'PARTIAL',
  'FAILED',
  'CANCELLED',
  'NEEDS_ATTENTION',
] as const;
export type MsaidiziTaskStatus = (typeof MSAIDIZI_TASK_STATUSES)[number];

export interface MsaidiziSafetyStatus {
  operatorLatch: 'ACTIVE' | 'DISABLED' | 'UNINITIALIZED';
  effectiveAutopilotEnabled: boolean;
  deploymentAutonomyEnabled: boolean;
  deploymentAutopilotEnabled: boolean;
  externalKillSwitchActive: boolean;
  lastChangedAt: string | null;
  activeSchedules: number;
  readyTasks: number;
  queuedTasks: number;
  runningTasks: number;
  pausingTasks: number;
  pausedTasks: number;
}

export interface MsaidiziSafetyActionResult {
  operatorLatch: 'ACTIVE' | 'DISABLED';
  effectiveAutopilotEnabled: boolean;
  pausedQueuedTasks?: number;
  pausingRunningTasks?: number;
  pausedSchedules?: number;
  tasksResumed?: number;
  schedulesActivated?: number;
  message: string;
}

export type MsaidiziTaskTarget = 'ERP' | 'HOST' | 'SELF_IMPROVEMENT';
export type MsaidiziTaskEffect = 'READ' | 'WRITE' | 'EXTERNAL' | 'IRREVERSIBLE';
export type MsaidiziTaskStepStatus =
  | 'PENDING'
  | 'READY'
  | 'LEASED'
  | 'RUNNING'
  | 'SUCCEEDED'
  | 'FAILED'
  | 'CANCELLED'
  | 'SKIPPED'
  | 'NEEDS_ATTENTION';

export interface MsaidiziTaskBudget {
  maxWallTimeSeconds?: number;
  maxModelTurns?: number;
  maxAttemptedToolCalls?: number;
  maxMutations?: number;
  maxLocalBytes?: number;
  maxExternalEgressBytes?: number;
  maxModelCostUsd?: number;
}

export type MsaidiziInputBindingSourceKind =
  | 'PLAN_INPUT'
  | 'DEPENDENCY_RESULT'
  | 'DEPENDENCY_OUTPUT'
  | 'DEPENDENCY_ARTIFACT'
  | 'SECRET_REFERENCE';

export type MsaidiziInputBindingValueType =
  | 'string'
  | 'number'
  | 'integer'
  | 'boolean'
  | 'object'
  | 'array'
  | 'null';

export interface MsaidiziInputBinding {
  targetPath: string;
  source: {
    kind: MsaidiziInputBindingSourceKind;
    path: string;
    dependencyStepKey?: string;
    artifactId?: string;
    secretReferenceId?: string;
    secretReferenceSha256?: string;
    scope?: {
      capability: string;
      capabilityVersion: string;
      dataClass: string;
      deviceId?: string;
      companyId?: string;
    };
  };
  dataClass: string;
  expectedType: MsaidiziInputBindingValueType;
  expectedSchema: Record<string, unknown>;
  transform: {
    name: 'IDENTITY' | 'JSON_STRINGIFY' | 'SHA256_HEX' | 'BASE64URL';
    version: '1';
  };
}

export interface MsaidiziTaskPlanStepInput {
  key: string;
  name: string;
  target?: MsaidiziTaskTarget;
  capability: string;
  capabilityVersion?: string;
  arguments: Record<string, unknown>;
  dependsOn?: string[];
  inputBindings?: MsaidiziInputBinding[];
  expectedEffect: MsaidiziTaskEffect;
  dataClass: string;
  preconditions?: Record<string, unknown>;
  recovery?: Record<string, unknown> | null;
  budgets?: Record<string, unknown>;
  stopConditions?: Record<string, unknown>;
  idempotent?: boolean;
  mutation?: boolean;
}

export interface PlanMsaidiziTaskRequest {
  /** Existing caller-owned PLANNING task promoted by this reviewed plan. */
  taskId?: string;
  title: string;
  objective: string;
  summary?: string;
  mode: MsaidiziTaskMode;
  companyId?: string;
  mandateId?: string;
  scheduleId?: string;
  idempotencyKey?: string;
  proposalUsageId?: string;
  proposalDigest?: string;
  inputs?: Record<string, unknown>;
  stopConditions?: Record<string, unknown>;
  budgets?: MsaidiziTaskBudget;
  steps: MsaidiziTaskPlanStepInput[];
}

export interface CreateMsaidiziTaskDraftRequest {
  objective: string;
  title?: string;
  mode: MsaidiziTaskMode;
  companyId?: string;
  mandateId?: string;
  idempotencyKey?: string;
  budgets?: MsaidiziTaskBudget;
}

export interface ProposeMsaidiziTaskRequest {
  taskId?: string;
  objective: string;
  mode: MsaidiziTaskMode;
  titleHint?: string;
  companyId?: string;
  mandateId?: string;
  deviceId?: string;
  budgets?: MsaidiziTaskBudget;
  inputs?: Record<string, unknown>;
  stopConditions?: Record<string, unknown>;
  memoryScopeKeys?: string[];
  artifactIds?: string[];
}

export interface MsaidiziProposalPolicyViolation {
  code: string;
  message: string;
  stepKey?: string;
}

export interface MsaidiziProposalPolicyDecision {
  allowed: boolean;
  violations: MsaidiziProposalPolicyViolation[];
  checks: string[];
}

export interface MsaidiziProposalCriticIssue {
  code: string;
  severity: 'ERROR' | 'WARNING' | 'INFO';
  message: string;
  stepKey?: string;
}

export interface MsaidiziProposalCritique {
  acceptable: boolean;
  issues: MsaidiziProposalCriticIssue[];
}

export interface MsaidiziProposalOutcome {
  proposedOnly: true;
  stepCount: number;
  readCount: number;
  mutationCount: number;
  externalActionCount: number;
  irreversibleActionCount: number;
  recoveryCoverage: number;
  highestRisk: MsaidiziTaskEffect;
  stopConditionsDeclared: boolean;
}

export interface MsaidiziTaskProposal {
  status: 'PROPOSED';
  draftTaskId: string | null;
  proposalDigest: string;
  proposalUsageReceipt: {
    id: string;
    expiresAt: string;
    modelTurns: number;
    inputTokens: string;
    outputTokens: string;
    estimatedCostUsd: string;
    oneUse: true;
  };
  persisted: false;
  queued: false;
  executed: false;
  plan: PlanMsaidiziTaskRequest;
  provenance: {
    callerPermissionFiltered: boolean;
    mandateId: string | null;
    deviceIds: string[];
    memories: Array<Record<string, unknown>>;
    artifacts: Array<Record<string, unknown>>;
    untrustedEnrichmentUsed: boolean;
    redactionsAppliedBeforeReasoning: boolean;
  };
  policy: MsaidiziProposalPolicyDecision;
  critique: MsaidiziProposalCritique;
  outcome: MsaidiziProposalOutcome;
  reasoningUsage: Record<string, unknown>;
}

export type ReplanMsaidiziTaskRequest = Pick<
  PlanMsaidiziTaskRequest,
  'summary' | 'objective' | 'inputs' | 'stopConditions' | 'steps'
>;

/** Persisted step shape. Its `stepKey` is the database/API name, unlike the plan request's `key`. */
export interface MsaidiziTaskStep {
  id: string;
  taskId: string;
  planVersionId: string;
  stepKey: string;
  sequence: number;
  name: string;
  target: MsaidiziTaskTarget;
  capability: string;
  capabilityVersion: string;
  arguments: Record<string, unknown>;
  dependencies: string[];
  inputBindings: MsaidiziInputBinding[];
  expectedEffect: MsaidiziTaskEffect;
  dataClass: string;
  preconditions: Record<string, unknown>;
  recovery: Record<string, unknown> | null;
  budgets: Record<string, unknown>;
  stopConditions: Record<string, unknown>;
  idempotent: boolean;
  mutation: boolean;
  status: MsaidiziTaskStepStatus;
  attemptCount: number;
  startedAt: string | null;
  checkpointedAt: string | null;
  endedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface MsaidiziPlanVersion {
  id: string;
  taskId: string;
  version: number;
  summary: string;
  objective: string;
  inputs: Record<string, unknown>;
  stopConditions: Record<string, unknown>;
  budgetSnapshot: Record<string, unknown>;
  planDigest: string;
  sourceProposalDigest?: string | null;
  createdAt: string;
  steps: MsaidiziTaskStep[];
}

export interface MsaidiziTaskMandateRef {
  id: string;
  name: string;
  status: string;
  startsAt: string | null;
  expiresAt: string | null;
}

export interface MsaidiziTaskScheduleRef {
  id: string;
  name: string;
  status: string;
  nextRunAt: string | null;
}

export type MsaidiziToolAttemptStatus =
  | 'REQUESTED'
  | 'REJECTED'
  | 'RUNNING'
  | 'SUCCEEDED'
  | 'FAILED'
  | 'UNKNOWN'
  | 'CANCELLED';

export interface MsaidiziToolAttempt {
  id: string;
  stepId: string;
  attemptNumber: number;
  toolName: string;
  status: MsaidiziToolAttemptStatus;
  rejectionReason: string | null;
  resultSummary: Record<string, unknown> | null;
  errorCode: string | null;
  errorMessage: string | null;
  uncertainOutcome: boolean;
  startedAt: string | null;
  endedAt: string | null;
  createdAt: string;
}

export type MsaidiziArtifactKind =
  | 'FILE'
  | 'SCREENSHOT'
  | 'REPORT'
  | 'AUDIO'
  | 'DOCUMENT'
  | 'OTHER';

export interface MsaidiziArtifact {
  id: string;
  stepId: string | null;
  kind: MsaidiziArtifactKind;
  name: string;
  mimeType: string;
  sha256: string;
  byteSize: string;
  encrypted: boolean;
  dataClass: string;
  trustLevel: MsaidiziTrustLevel;
  provenance: Record<string, unknown>;
  createdAt: string;
}

export type MsaidiziDeviceLeaseStatus = 'ACTIVE' | 'RELEASED' | 'EXPIRED' | 'REVOKED';

export interface MsaidiziDeviceLease {
  id: string;
  stepId: string | null;
  deviceId: string;
  status: MsaidiziDeviceLeaseStatus;
  fencingToken: string;
  acquiredAt: string;
  heartbeatAt: string;
  expiresAt: string;
  releasedAt: string | null;
  device: { name: string; status: MsaidiziDeviceStatus; lastSeenAt: string | null };
}

export type MsaidiziHostActionStatus =
  | 'QUEUED'
  | 'DISPATCHED'
  | 'RUNNING'
  | 'SUCCEEDED'
  | 'FAILED'
  | 'UNKNOWN'
  | 'CANCELLED';

export interface MsaidiziHostAction {
  id: string;
  stepId: string;
  deviceId: string;
  actionId: string;
  capability: string;
  capabilityVersion: string;
  argsDigest: string;
  idempotencyKey: string;
  dataClass: string;
  effect: MsaidiziTaskEffect;
  consent: string;
  recovery: string;
  status: MsaidiziHostActionStatus;
  uncertainOutcome: boolean;
  journalPrepareSequence: number | null;
  journalPreparePreviousHash: string | null;
  journalPrepareHash: string | null;
  journalSequence: number | null;
  journalPreviousHash: string | null;
  journalHash: string | null;
  resultSummary: Record<string, unknown> | null;
  errorCode: string | null;
  queuedAt: string;
  dispatchedAt: string | null;
  startedAt: string | null;
  endedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface MsaidiziTask {
  id: string;
  principalId: string;
  initiatedByUserId: string | null;
  companyId: string | null;
  mandateId: string | null;
  scheduleId: string | null;
  proposalUsageId?: string | null;
  mode: MsaidiziTaskMode;
  title: string;
  objective: string;
  status: MsaidiziTaskStatus;
  activePlanVersion: number;
  stateVersion: number;
  hostExecutionAllowed: boolean;
  maxWallTimeSeconds: number;
  maxModelTurns: number;
  maxAttemptedToolCalls: number;
  maxMutations: number;
  maxLocalBytes: string;
  maxExternalEgressBytes: string;
  maxModelCostUsd: string;
  modelTurns: number;
  attemptedToolCalls: number;
  executedToolCalls: number;
  mutations: number;
  inputTokens: string;
  outputTokens: string;
  modelCostUsd: string;
  bytesRead: string;
  bytesWritten: string;
  externalEgressBytes: string;
  consumedWallTimeMs: string;
  wallTimeCheckpointAt: string | null;
  statusDetail: string | null;
  failureCode: string | null;
  queuedAt: string | null;
  startedAt: string | null;
  lastCheckpointAt: string | null;
  pauseRequestedAt: string | null;
  cancelRequestedAt: string | null;
  endedAt: string | null;
  createdAt: string;
  updatedAt: string;
  mandate?: MsaidiziTaskMandateRef | null;
  schedule?: MsaidiziTaskScheduleRef | null;
  planVersions?: MsaidiziPlanVersion[];
  toolAttempts?: MsaidiziToolAttempt[];
  artifacts?: MsaidiziArtifact[];
  deviceLeases?: MsaidiziDeviceLease[];
  hostActions?: MsaidiziHostAction[];
}

export interface MsaidiziTaskPage {
  data: MsaidiziTask[];
  meta: { page: number; limit: number; total: number };
}

export interface MsaidiziTaskEvent {
  cursor: string;
  taskId: string;
  type: string;
  actorType: string;
  actorId: string | null;
  payload: Record<string, unknown>;
  createdAt: string;
  integrityVersion: 1;
  previousHash: string;
  eventHash: string;
}

export interface MsaidiziTaskEventPage {
  data: MsaidiziTaskEvent[];
  nextCursor: string;
  hasMore: boolean;
}

// ─── Human-managed autonomy control plane ────────────────────────────────────

export type MsaidiziMandateStatus = 'DRAFT' | 'ACTIVE' | 'SUSPENDED' | 'REVOKED' | 'EXPIRED';
export type MsaidiziScheduleStatus = 'DRAFT' | 'ACTIVE' | 'PAUSED' | 'ARCHIVED';
export type MsaidiziMemoryKind = 'SEMANTIC' | 'EPISODIC' | 'PROCEDURAL';
export type MsaidiziTrustLevel = 'TRUSTED' | 'UNTRUSTED';
export type MsaidiziDeviceStatus = 'PENDING' | 'ACTIVE' | 'OFFLINE' | 'REVOKED' | 'KILLED';

export interface MsaidiziDeviceRuntime {
  component?: string;
  componentVersion?: string;
  executionEnabled?: boolean;
  killSwitchEngaged?: boolean;
  centralLedgerConnected?: boolean;
  runningActionCount?: number;
  journalSequence?: number;
  journalHeadHash?: string;
  capabilityManifestSha256?: string;
  manifestMatches?: boolean;
  receivedAt?: string;
}

export interface MsaidiziDeviceCapability {
  id: string;
  version: string;
  displayName?: string;
  description?: string;
  dataClass?: string | number;
  effect?: string | number;
  consent?: string | number;
  recovery?: string | number;
  requiredPrivilege?: string | number;
  idempotency?: string | number;
  supportedOperatingSystems?: string[];
  provenanceOutputs?: string[];
  touchesTrustedRoot?: boolean;
}

export interface MsaidiziDeviceCapabilityManifest {
  protocolVersion?: number;
  manifestSha256?: string;
  generatedAt?: string;
  capabilities?: MsaidiziDeviceCapability[];
  runtime?: MsaidiziDeviceRuntime;
  pairing?: { expiresAt?: string };
}

export interface MsaidiziDevice {
  id: string;
  name: string;
  status: MsaidiziDeviceStatus;
  platform: string;
  osVersion: string | null;
  architecture: string | null;
  certificateThumbprint: string | null;
  capabilityManifest: MsaidiziDeviceCapabilityManifest;
  pairedAt: string | null;
  lastSeenAt: string | null;
  revokedAt: string | null;
  killedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface MsaidiziDevicePage {
  items: MsaidiziDevice[];
  total: number;
}

export interface MsaidiziPairingCode {
  id: string;
  name: string;
  status: 'PENDING';
  createdAt: string;
  pairingCode: string;
  expiresAt: string;
}

export const MSAIDIZI_RECOVERY_COMMAND_STATUSES = [
  'QUEUED',
  'DISPATCHED',
  'RECOVERING',
  'SUCCEEDED',
  'FAILED',
  'NEEDS_ATTENTION',
] as const;
export type MsaidiziRecoveryCommandStatus = (typeof MSAIDIZI_RECOVERY_COMMAND_STATUSES)[number];

export interface MsaidiziRecoveryResultSummary {
  outcome?: 'SUCCEEDED' | 'FAILED' | 'NEEDS_ATTENTION';
  manifestSha256?: string;
  journalHeadSha256?: string;
  restoredStateSha256?: string;
  reason?: string;
  deviceId?: string;
  receivedAt?: string;
  [key: string]: unknown;
}

/**
 * Human-readable projection returned by the trusted recovery endpoints.
 * Signed manifest contents and signatures intentionally remain server-side;
 * operators receive their digest and signing-key attribution instead.
 */
export interface MsaidiziRecoveryCommand {
  id: string;
  hostActionId: string;
  deviceId: string;
  requestedByUserId: string;
  originalActionId: string;
  recoveryRecordSha256: string;
  expectedCurrentStateSha256: string;
  status: MsaidiziRecoveryCommandStatus;
  manifestSha256: string;
  signingKeyId: string;
  dispatchCount: number;
  resultSummary: MsaidiziRecoveryResultSummary | null;
  supervisorJournalHead: string | null;
  queuedAt: string;
  dispatchedAt: string | null;
  startedAt: string | null;
  completedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface RequestMsaidiziRecoveryCommand {
  hostActionId: string;
  confirmationPhrase: string;
  expectedCurrentStateSha256?: string;
}

export type MsaidiziMemorySourceType =
  | 'USER'
  | 'TASK'
  | 'FILE'
  | 'WEBPAGE'
  | 'EMAIL'
  | 'CLIPBOARD'
  | 'AUDIO'
  | 'SCREENSHOT'
  | 'SYSTEM';

export interface MsaidiziControlPlanePage<T> {
  items: T[];
  total: number;
  page: number;
  limit: number;
}

export interface MsaidiziMandateCapability {
  capability: string;
  version?: string;
  effects: MsaidiziTaskEffect[];
  dataClasses: string[];
  consentGrants?: Array<'emergency_operator'>;
  externalDestinationAuthorities?: Array<'static_endpoint_v1' | 'mandate_dynamic_https_v1'>;
}

export type MsaidiziMandateBudget = MsaidiziTaskBudget;

export interface CreateMsaidiziMandateRequest {
  name: string;
  description: string;
  companyId?: string;
  capabilities: MsaidiziMandateCapability[];
  deviceIds: string[];
  budgets: MsaidiziMandateBudget;
  startsAt?: string;
  expiresAt?: string;
}

export interface UpdateMsaidiziMandateRequest extends Partial<
  Omit<CreateMsaidiziMandateRequest, 'companyId'>
> {
  expectedVersion: number;
}

export interface MsaidiziMandate extends Omit<
  CreateMsaidiziMandateRequest,
  'companyId' | 'startsAt' | 'expiresAt'
> {
  id: string;
  principalId: string;
  companyId: string | null;
  createdByUserId: string | null;
  status: MsaidiziMandateStatus;
  version: number;
  startsAt: string | null;
  expiresAt: string | null;
  activatedAt: string | null;
  revokedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export type MsaidiziScheduleConcurrencyMode = 'SKIP' | 'QUEUE';

export interface CreateMsaidiziScheduleRequest {
  mandateId: string;
  name: string;
  cronExpression: string;
  timezone: string;
  taskTemplate: Record<string, unknown>;
  concurrencyMode?: MsaidiziScheduleConcurrencyMode;
  nextRunAt?: string;
}

export type UpdateMsaidiziScheduleRequest = Partial<
  Omit<CreateMsaidiziScheduleRequest, 'mandateId' | 'nextRunAt'>
> & {
  expectedVersion: number;
  nextRunAt?: string | null;
};

export interface MsaidiziSchedule extends Omit<CreateMsaidiziScheduleRequest, 'nextRunAt'> {
  id: string;
  principalId: string;
  createdByUserId: string | null;
  status: MsaidiziScheduleStatus;
  version: number;
  concurrencyMode: MsaidiziScheduleConcurrencyMode;
  nextRunAt: string | null;
  lastRunAt: string | null;
  createdAt: string;
  updatedAt: string;
  mandate: Pick<
    MsaidiziMandate,
    'id' | 'companyId' | 'status' | 'version' | 'startsAt' | 'expiresAt'
  >;
}

/** Append-only routine snapshot returned by the version-history endpoints. */
export interface MsaidiziScheduleVersion {
  id: string;
  scheduleId: string;
  version: number;
  changeType: string;
  changedByUserId: string | null;
  principalId: string;
  mandateId: string;
  companyId: string | null;
  createdByUserId: string | null;
  name: string;
  status: MsaidiziScheduleStatus;
  cronExpression: string;
  timezone: string;
  taskTemplate: Record<string, unknown>;
  concurrencyMode: MsaidiziScheduleConcurrencyMode;
  nextRunAt: string | null;
  lastRunAt: string | null;
  sourceCreatedAt: string;
  sourceUpdatedAt: string;
  recordedAt: string;
}

export interface MsaidiziMemoryProvenance {
  sourceType: MsaidiziMemorySourceType;
  sourceId?: string;
  capturedAt: string;
  transformations?: string[];
}

export interface CreateMsaidiziMemoryRequest {
  companyId?: string;
  kind: MsaidiziMemoryKind;
  scopeKey: string;
  content: string;
  metadata: Record<string, unknown>;
  expiresAt?: string;
}

export interface UpdateMsaidiziMemoryRequest extends Partial<
  Pick<CreateMsaidiziMemoryRequest, 'kind' | 'scopeKey' | 'content' | 'metadata'>
> {
  expiresAt?: string | null;
}

export interface MsaidiziMemory extends Omit<
  CreateMsaidiziMemoryRequest,
  'content' | 'companyId' | 'expiresAt'
> {
  id: string;
  companyId: string | null;
  sourceTaskId: string | null;
  trustLevel: MsaidiziTrustLevel;
  sourceProvenance: MsaidiziMemoryProvenance;
  content?: string;
  contentDigest: string;
  expiresAt: string | null;
  createdAt: string;
  updatedAt: string;
  redactionsApplied?: boolean;
}

/** Detail reads and successful writes include decrypted, integrity-checked content. */
export type MsaidiziMemoryDetail = MsaidiziMemory & { content: string };
