import {
  MsaidiziEffect,
  MsaidiziExecutionTarget,
  MsaidiziTaskMode,
  MsaidiziTrustLevel,
} from '@prisma/client';
import { ModelUsage } from '../msaidizi/model-client';
import type { MsaidiziInputBindingDto } from '../msaidizi-tasks/dto/msaidizi-task.dto';
import type { MsaidiziDraftProposalAuthority } from './msaidizi-proposal-lease';

export type JsonObject = Record<string, unknown>;

export interface ProposedPlanStep {
  key: string;
  name: string;
  target: MsaidiziExecutionTarget;
  capability: string;
  capabilityVersion: string;
  arguments: JsonObject;
  dependsOn: string[];
  /** Authority-phase-only immutable dataflow declarations. */
  inputBindings: MsaidiziInputBindingDto[];
  expectedEffect: MsaidiziEffect;
  dataClass: string;
  preconditions: JsonObject;
  recovery: JsonObject | null;
  budgets: JsonObject;
  stopConditions: JsonObject;
  idempotent: boolean;
  mutation: boolean;
}

export interface ProposedPlanDraft {
  title: string;
  summary: string;
  steps: ProposedPlanStep[];
}

export interface RetrievedReasoningMemory {
  id: string;
  scopeKey: string;
  content: string;
  contentDigest: string;
  trustLevel: MsaidiziTrustLevel;
  sourceType: string;
  sourceProvenance: JsonObject;
}

export interface ReasoningArtifact {
  id: string;
  sourceTaskId: string;
  kind: string;
  name: string;
  mimeType: string;
  byteSize: number;
  sha256: string;
  dataClass: string;
  trustLevel: 'UNTRUSTED';
  storedTrustLevel: string;
  provenance: JsonObject;
  /** Ephemeral plaintext. It is zeroed immediately after the enrichment turn. */
  content: Buffer;
}

export interface ReasoningBudget {
  maxWallTimeSeconds: number;
  maxModelTurns: number;
  maxAttemptedToolCalls: number;
  maxMutations: number;
  maxLocalBytes: number;
  maxExternalEgressBytes: number;
  maxModelCostUsd: number;
}

export interface MandateCapabilityGrant {
  capability: string;
  version?: string;
  effects: MsaidiziEffect[];
  dataClasses: string[];
  externalDestinationAuthorities?: string[];
}

export interface ReasoningMandateContext {
  id: string;
  principalId: string;
  deviceIds: string[];
  capabilities: MandateCapabilityGrant[];
  budgets: Partial<ReasoningBudget>;
}

export interface ReasoningCapability {
  target: MsaidiziExecutionTarget;
  capability: string;
  capabilityVersion: string;
  description: string;
  expectedEffect: MsaidiziEffect;
  dataClass: string;
  mutation: boolean;
  idempotent: boolean;
  argumentsSchema: JsonObject;
  recoveryKind: string;
  /** Permission codes with AND semantics. */
  permissions: string[];
  /** Permission codes with OR semantics. */
  anyPermissions: string[];
  deviceId?: string;
  deviceName?: string;
  manifestSha256?: string;
  touchesTrustedRoot?: boolean;
}

export interface ReasoningContext {
  /** Existing caller-owned PLANNING task; never authority supplied by model content. */
  draftTaskId?: string;
  /** Exact database snapshot required before a proposal reservation can call a model. */
  draftAuthority?: MsaidiziDraftProposalAuthority;
  objective: string;
  titleHint?: string;
  mode: MsaidiziTaskMode;
  companyId: string | null;
  requestedMandateId?: string;
  requestedDeviceId?: string;
  inputs: JsonObject;
  stopConditions: JsonObject;
  budgets: ReasoningBudget;
  budgetViolations: PolicyViolation[];
  mandate: ReasoningMandateContext | null;
  capabilities: ReasoningCapability[];
  memories: RetrievedReasoningMemory[];
  artifacts?: ReasoningArtifact[];
  callerPermissions: string[];
  principalPermissions: string[];
  redactionsApplied: boolean;
}

export interface PlannerResult {
  authorityDraft: ProposedPlanDraft;
  candidate: ProposedPlanDraft;
  modelTurns: number;
  usage: ModelUsage;
  untrustedEnrichmentUsed: boolean;
}

export interface PolicyViolation {
  code: string;
  message: string;
  stepKey?: string;
}

export interface PolicyDecision {
  allowed: boolean;
  violations: PolicyViolation[];
  checks: string[];
}

export type CriticSeverity = 'ERROR' | 'WARNING' | 'INFO';

export interface CriticIssue {
  code: string;
  severity: CriticSeverity;
  message: string;
  stepKey?: string;
}

export interface CriticReview {
  acceptable: boolean;
  issues: CriticIssue[];
}

export interface ProposalOutcomeEvaluation {
  proposedOnly: true;
  stepCount: number;
  readCount: number;
  mutationCount: number;
  externalActionCount: number;
  irreversibleActionCount: number;
  recoveryCoverage: number;
  highestRisk: 'READ' | 'WRITE' | 'EXTERNAL' | 'IRREVERSIBLE';
  stopConditionsDeclared: boolean;
}

export interface AggregatedReasoningUsage extends ModelUsage {
  model: string;
  modelTurns: number;
  maxOutputTokensPerTurn: number;
  providerReportedCostUsd: null;
}
