import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import ts from 'typescript';

/**
 * Registry backing `host-file-ephemerality-enforcement-evidence.manifest.spec.ts`.
 *
 * The ephemeral-file-disclosure boundary has no single production port yet. It is
 * held closed by a set of separate checks spread over the device, reasoning,
 * artifact and task-runtime services. This module is the closed list of those
 * checks, plus the reviewed classification of every other function that sits on
 * the same surface, in the shape the `crud-*-evidence.ts` registries use: a
 * derived inventory partitioned into registered entries and reviewed exclusions,
 * so that a new, unclassified member of the inventory fails a test.
 *
 * WHERE THE EVIDENCE COMES FROM
 *   The `crud-*` registries derive their inventory from runtime truth: a loaded
 *   controller manifest, or `Prisma.dmmf`. This one cannot. Nothing at runtime
 *   enumerates "functions that could move a host file capability towards a
 *   device", so the inventory here is derived by walking the TypeScript AST of
 *   the source tree and matching text. Everything this registry pins therefore
 *   ages against source text rather than against a compiled artifact, and every
 *   guarantee below is a textual one.
 */

/** Capability ids that must never reach a device, an artifact row or the model. */
export const HOST_FILE_CONTENT_CAPABILITY_IDS = [
  'filesystem.file.read',
  'filesystem.file.disclose.ephemeral',
] as const;

/** Module specifier that marks a file as part of the enforcement surface. */
export const HOST_FILE_POLICY_MODULE = 'host-file-ephemerality.policy';

/** Source of the two shared predicates; excluded from the scanned surface. */
export const HOST_FILE_POLICY_FILE = 'modules/msaidizi-devices/host-file-ephemerality.policy.ts';

/** This registry; it quotes guard text, so it is excluded from the scans too. */
export const HOST_FILE_ENFORCEMENT_EVIDENCE_FILE =
  'modules/msaidizi-devices/host-file-ephemerality-enforcement-evidence.ts';

/** Neither of the two files above is scanned: one defines the predicates, one quotes them. */
export const SCAN_EXCLUDED_FILES: readonly string[] = [
  HOST_FILE_POLICY_FILE,
  HOST_FILE_ENFORCEMENT_EVIDENCE_FILE,
];

/** Tokens whose presence in a function means that function refuses host file bytes. */
export const HOST_FILE_GUARD_TOKENS = [
  'isUnavailableHostFileContentCapability',
  'isForbiddenDurableFileRead',
  'REASONING_FILE_EPHEMERAL_CHANNEL_NOT_READY',
] as const;

/**
 * Inventory pattern inside the enforcement surface: a function is capability
 * handling when it mentions a capability at all, touches the host action table,
 * carries a host action output payload, names a file, or already refuses host
 * file bytes.
 *
 * `outputJson` and `file` are here because a new method on an already-importing
 * service can reach host file bytes without ever saying "capability": it can
 * load a settled row through an existing helper and parse the payload. Those two
 * tokens are what such a method cannot avoid.
 */
export const CAPABILITY_HANDLING_PATTERNS = [
  /\bcapabilit(?:y|ies)\b/i,
  /\bmsaidiziHostAction\b/i,
  /\boutputJson\b/,
  /\bfile\b/i,
  new RegExp(HOST_FILE_GUARD_TOKENS.join('|')),
] as const;

/**
 * Inventory patterns outside the enforcement surface: a file that reads the
 * `capability` member of any record, or that names one of the closed capability
 * ids outright, is close enough to the boundary that it must be classified.
 *
 * The receiver is deliberately unconstrained. An earlier version listed the
 * receiver names it expected (`action`, `step`, `dispatch`, ...) and so could not
 * see `hostAction.capability`, `record.capability` or `row.capability` — the
 * names a new host-action service is most likely to use.
 */
export const HOST_ACTION_CAPABILITY_FILE_PATTERNS = [
  /\b[A-Za-z_$][\w$]*\.capability\b/,
  new RegExp(HOST_FILE_CONTENT_CAPABILITY_IDS.map((id) => id.replace(/\./g, '\\.')).join('|')),
] as const;

export type HostFileEnforcementKind =
  /** Calls one of the exported predicates on a capability value. */
  | 'predicate'
  /** Refuses a file-shaped input structurally, without naming a capability. */
  | 'structural';

export interface HostFileEnforcementCaller {
  /** Function that must still contain `call`; keeps a boolean helper wired in. */
  symbol: string;
  call: string;
}

export interface HostFileEnforcementSite {
  /** Stable id used in failure output; never reused. */
  siteId: string;
  /** Path relative to `src`, forward slashes. */
  file: string;
  /** `Class.method` or `functionName`, as declared. */
  symbol: string;
  kind: HostFileEnforcementKind;
  /** What the refusal does once it fires. */
  disposition: string;
  /**
   * Contiguous source fragments that must still appear inside `symbol`, in this
   * order. Each fragment spans the test and its consequence together, so that
   * adding a conjunct to the condition, or a statement between the branch and
   * the refusal, breaks the fragment instead of surviving a substring match.
   */
  guards: readonly string[];
  /**
   * For sites whose disposition is "the whole declaration is the refusal": the
   * complete declaration text, which must still match exactly. Without this, an
   * early return placed above a registered `throw` leaves the throw textually
   * present while the method returns bytes.
   */
  entireDeclaration?: string;
  /** For helpers whose verdict is only meaningful if someone still calls them. */
  calledBy?: HostFileEnforcementCaller;
}

export interface HostFileSurfaceExclusion {
  file: string;
  symbol: string;
  /** What the function does with the capability, and why it decides nothing. */
  note: string;
}

export interface HostFileOutOfScopeFile {
  file: string;
  note: string;
}

const DEVICES = 'modules/msaidizi-devices/msaidizi-devices.service.ts';
const ARTIFACTS = 'modules/msaidizi-artifacts/msaidizi-artifacts.service.ts';
const ADAPTIVE = 'modules/msaidizi-task-runtime/msaidizi-adaptive-reasoning.service.ts';
const DEVICE_SECURITY = 'modules/msaidizi-devices/device-security.ts';
const DISCLOSURE_PROTOCOL = 'modules/msaidizi-devices/ephemeral-file-disclosure.protocol.ts';
const POLICY_EVALUATOR = 'modules/msaidizi-reasoning/msaidizi-policy-evaluator.service.ts';
const REASONING_CONTEXT = 'modules/msaidizi-reasoning/msaidizi-reasoning-context.service.ts';

/**
 * The closed set of enforcement checks. Removing one, renaming the function that
 * holds one, or neutralising one in place without updating this list fails the
 * manifest spec.
 */
export const HOST_FILE_ENFORCEMENT_SITES: readonly HostFileEnforcementSite[] = [
  {
    siteId: 'device-capability-enrollment',
    file: DEVICE_SECURITY,
    symbol: 'validateCapability',
    kind: 'predicate',
    disposition: 'rejects the whole capability manifest at enrollment',
    guards: [
      `if (isUnavailableHostFileContentCapability(capability.id)) {
    throw new BadRequestException(REASONING_FILE_EPHEMERAL_CHANNEL_NOT_READY);
  }`,
    ],
  },
  {
    siteId: 'ephemeral-disclosure-port',
    file: DISCLOSURE_PROTOCOL,
    symbol: 'RejectingEphemeralFileDisclosurePort.disclose',
    kind: 'structural',
    disposition: 'always throws; it is the only disclosure port compiled into production',
    guards: [
      `throw new EphemeralFileDisclosureProtocolError(
      REASONING_FILE_EPHEMERAL_CHANNEL_NOT_READY,`,
    ],
    entireDeclaration: `disclose(): never {
    throw new EphemeralFileDisclosureProtocolError(
      REASONING_FILE_EPHEMERAL_CHANNEL_NOT_READY,
      'no single-session device-to-provider disclosure transport is provisioned',
    );
  }`,
  },
  {
    siteId: 'host-action-queue',
    file: DEVICES,
    symbol: 'MsaidiziDevicesService.queueHostAction',
    kind: 'predicate',
    disposition: 'refuses to stage the action for a device',
    guards: [
      `if (isUnavailableHostFileContentCapability(step.capability)) {
      throw new HostActionPolicyError(REASONING_FILE_EPHEMERAL_CHANNEL_NOT_READY);
    }`,
    ],
  },
  {
    siteId: 'host-action-dispatch-claim',
    file: DEVICES,
    symbol: 'MsaidiziDevicesService.claimExecuteCommand',
    kind: 'predicate',
    disposition: 'settles the candidate as interrupted instead of dispatching it',
    guards: [
      `if (isUnavailableHostFileContentCapability(action.capability)) {
        await this.settleInterruptedAction(
          action.id,
          REASONING_FILE_EPHEMERAL_CHANNEL_NOT_READY,
          false,
          false,
          { bytesRead: 0n, bytesWritten: 0n },
          true,
          true,
        );
        continue;`,
    ],
  },
  {
    siteId: 'host-action-result',
    file: DEVICES,
    symbol: 'MsaidiziDevicesService.result',
    kind: 'predicate',
    disposition: 'settles the action as interrupted and keeps the payload',
    guards: [
      `if (isUnavailableHostFileContentCapability(action.capability)) {
      const replay = !ACTIVE_ACTIONS.includes(action.status as (typeof ACTIVE_ACTIONS)[number]);
      await this.settleInterruptedAction(
        action.id,
        REASONING_FILE_EPHEMERAL_CHANNEL_NOT_READY,`,
    ],
  },
  {
    siteId: 'host-action-settlement',
    file: DEVICES,
    symbol: 'MsaidiziDevicesService.settleResult',
    kind: 'predicate',
    disposition: 'settles the action as interrupted before any observation is written',
    guards: [
      `if (isUnavailableHostFileContentCapability(action.capability)) {
      const active = ACTIVE_ACTIONS.includes(action.status as (typeof ACTIVE_ACTIONS)[number]);
      this.assertActionLeaseReceipt(
        action,
        dto,
        !active && interruptedActionAcceptsLateEvidence(action),
      );
      await this.settleInterruptedAction(
        action.id,
        REASONING_FILE_EPHEMERAL_CHANNEL_NOT_READY,`,
    ],
  },
  {
    siteId: 'host-observation-persistence',
    file: DEVICES,
    symbol: 'MsaidiziDevicesService.persistHostResultObservation',
    kind: 'predicate',
    disposition: 'refuses to turn the result into a durable observation, before it is parsed',
    guards: [
      `if (isUnavailableHostFileContentCapability(action.capability)) {
      throw new BadRequestException(REASONING_FILE_EPHEMERAL_CHANNEL_NOT_READY);
    }
    const value = JSON.parse(outputJson) as unknown;`,
    ],
  },
  {
    siteId: 'host-output-envelope',
    file: DEVICES,
    symbol: 'validateHostOutputEnvelope',
    kind: 'predicate',
    disposition: 'reports the companion envelope as invalid',
    guards: ['if (isUnavailableHostFileContentCapability(action.capability)) return false;'],
    calledBy: {
      symbol: 'MsaidiziDevicesService.settleResult',
      call: 'validateHostOutputEnvelope(action, dto.outputJson)',
    },
  },
  {
    siteId: 'host-file-read-receipt',
    file: DEVICES,
    symbol: 'validateHostFileReadReceipt',
    kind: 'predicate',
    disposition: 'reports the file-read receipt as invalid',
    guards: ['if (isUnavailableHostFileContentCapability(action.capability)) return false;'],
    calledBy: {
      symbol: 'MsaidiziDevicesService.settleResult',
      call: 'validateHostFileReadReceipt(action, dto, outcome)',
    },
  },
  {
    siteId: 'plan-step-policy',
    file: POLICY_EVALUATOR,
    symbol: 'DeterministicMsaidiziPolicyEvaluator.evaluateStep',
    kind: 'predicate',
    disposition: 'records a policy violation and returns, so the plan step cannot be admitted',
    guards: [
      `if (isUnavailableHostFileContentCapability(step.capability)) {
      violations.push(
        violation(
          REASONING_FILE_EPHEMERAL_CHANNEL_NOT_READY,
          'File content requires the separately governed ephemeral reread channel',
          step.key,
        ),
      );
      return;
    }`,
    ],
  },
  {
    siteId: 'offered-host-capabilities',
    file: REASONING_CONTEXT,
    symbol: 'MsaidiziReasoningContextService.hostCapabilities',
    kind: 'predicate',
    disposition: 'omits the capability from the catalogue offered to the model',
    guards: [
      `isUnavailableHostFileContentCapability(capability)
        ) {
          continue;
        }`,
    ],
  },
  {
    siteId: 'tool-observation-file',
    file: ARTIFACTS,
    symbol: 'MsaidiziArtifactsService.prepareToolObservation',
    kind: 'structural',
    disposition: 'refuses any observation carrying a file member',
    guards: [
      `if (input.file != null) {
      throw new BadRequestException(REASONING_FILE_EPHEMERAL_CHANNEL_NOT_READY);
    }`,
    ],
  },
  {
    siteId: 'settled-file-read',
    file: ARTIFACTS,
    symbol: 'MsaidiziArtifactsService.readSettledFileForAdaptiveReasoning',
    kind: 'structural',
    disposition:
      'refuses every read of a settled file observation; the whole method is the refusal',
    guards: ['throw new ServiceUnavailableException(REASONING_FILE_EPHEMERAL_CHANNEL_NOT_READY);'],
    entireDeclaration: `async readSettledFileForAdaptiveReasoning(
    binding: AdaptiveReasoningFileBinding,
  ): Promise<ReasoningArtifactContent> {
    void binding;
    throw new ServiceUnavailableException(REASONING_FILE_EPHEMERAL_CHANNEL_NOT_READY);
  }`,
  },
  {
    siteId: 'dependency-artifact-provenance',
    file: ARTIFACTS,
    symbol: 'isForbiddenHostFileArtifact',
    kind: 'predicate',
    disposition:
      'hides the artifact from the dependency materialisation path; the whole predicate is the verdict',
    guards: ['isUnavailableHostFileContentCapability(provenance.capability)'],
    entireDeclaration: `function isForbiddenHostFileArtifact(value: Prisma.JsonValue): boolean {
  const provenance = jsonRecord(value);
  return (
    provenance.sourceType === 'HOST_RESULT' &&
    isUnavailableHostFileContentCapability(provenance.capability)
  );
}`,
    calledBy: {
      symbol: 'MsaidiziArtifactsService.materializeForHostAction',
      call: 'isForbiddenHostFileArtifact(artifact.provenance)',
    },
  },
  {
    siteId: 'adaptive-checkpoint-input',
    file: ADAPTIVE,
    symbol: 'MsaidiziAdaptiveReasoningService.executeCheckpoint',
    kind: 'structural',
    disposition: 'fails the reasoning turn without calling the model',
    guards: [
      `if (checkpointInput.file) {
      await this.failWithoutCall(turn.id, turn.taskId, REASONING_FILE_EPHEMERAL_CHANNEL_NOT_READY);
      return {
        data: {
          rejected: true,
          reason: REASONING_FILE_EPHEMERAL_CHANNEL_NOT_READY,
        },
      };
    }`,
    ],
  },
  {
    siteId: 'adaptive-checkpoint-file-attach',
    file: ADAPTIVE,
    symbol: 'MsaidiziAdaptiveReasoningService.attachCheckpointFile',
    kind: 'structural',
    disposition: 'never attaches file bytes to a model input; the whole method is the refusal',
    guards: [
      'if (!input.file) return input;',
      'throw new Error(REASONING_FILE_EPHEMERAL_CHANNEL_NOT_READY);',
    ],
    entireDeclaration: `private async attachCheckpointFile(
    input: RuntimeModelInput,
    taskId: string,
    planVersionId: string,
    checkpointStepId: string,
  ): Promise<RuntimeModelInput> {
    if (!input.file) return input;
    void taskId;
    void planVersionId;
    void checkpointStepId;
    throw new Error(REASONING_FILE_EPHEMERAL_CHANNEL_NOT_READY);
  }`,
  },
];

/**
 * Reviewed exclusions: functions on the enforcement surface that handle a
 * capability, a host action row, an output payload or a file but take no
 * admission decision about host file bytes. A note says what the function does,
 * not that it is safe.
 */
export const HOST_FILE_SURFACE_EXCLUSIONS: readonly HostFileSurfaceExclusion[] = [
  {
    file: ARTIFACTS,
    symbol: 'MsaidiziArtifactsService.commitPreparedToolObservation',
    note: 'publishes an observation already admitted by prepareToolObservation',
  },
  {
    file: ARTIFACTS,
    symbol: 'MsaidiziArtifactsService.readSettledImageForAdaptiveReasoning',
    note: 'native image path; the file sibling is the settled-file-read refusal',
  },
  {
    file: ARTIFACTS,
    symbol: 'MsaidiziArtifactsService.downloadForUpdateEvaluation',
    note: 'generated update manifests under an evaluator lease, not host results',
  },
  {
    file: ARTIFACTS,
    symbol: 'MsaidiziArtifactsService.generatedArtifactReservationAllowed',
    note: 'reservation arithmetic for generated update artifacts',
  },
  {
    file: ARTIFACTS,
    symbol: 'MsaidiziArtifactsService.trustedArtifactContext',
    note: 'resolves the attested task and plan context; admits no capability',
  },
  {
    file: ARTIFACTS,
    symbol: 'MsaidiziArtifactsService.toolObservationReplay',
    note: 'idempotent replay of an observation row prepareToolObservation already admitted',
  },
  {
    file: ARTIFACTS,
    symbol: 'MsaidiziArtifactsService.upload',
    note: 'operator upload of an ordinary artifact file; never a host action result',
  },
  {
    file: ARTIFACTS,
    symbol: 'MsaidiziArtifactsService.ingestTrustedUpdateArtifact',
    note: 'ingests an attested self-update bundle file; never a host action result',
  },
  {
    file: ARTIFACTS,
    symbol: 'MsaidiziArtifactsService.trustedArtifactReplay',
    note: 'idempotent replay of a trusted self-update ingest',
  },
  {
    file: ARTIFACTS,
    symbol: 'adaptiveImageProvenanceMatches',
    note: 'compares stored provenance with an image binding',
  },
  {
    file: ARTIFACTS,
    symbol: 'deterministicObservationArtifactId',
    note: 'hashes observation metadata into a deterministic id',
  },
  {
    file: ARTIFACTS,
    symbol: 'toolObservationDescriptor',
    note: 'derives kind, name and mime type for an observation row',
  },
  {
    file: ARTIFACTS,
    symbol: 'removeOwnedArtifactFile',
    note: 'deletes an artifact blob this service owns, checked against its envelope digest',
  },
  {
    file: ARTIFACTS,
    symbol: 'removeSerializedArtifactOrphan',
    note: 'deletes an orphaned artifact blob left by a failed write',
  },
  {
    file: DEVICE_SECURITY,
    symbol: 'validateCapabilityManifest',
    note: 'manifest-level shape and uniqueness checks; per-capability admission is validateCapability',
  },
  {
    file: DEVICE_SECURITY,
    symbol: 'capabilityEffect',
    note: 'decodes the capability effect enum',
  },
  {
    file: DEVICE_SECURITY,
    symbol: 'findCapability',
    note: 'looks up a descriptor in an already enrolled manifest snapshot',
  },
  {
    file: DEVICE_SECURITY,
    symbol: 'strictObjectSchema',
    note: 'rejects loose JSON schemas in a capability descriptor',
  },
  {
    file: DISCLOSURE_PROTOCOL,
    symbol: 'parseGrant',
    note: 'parses a disclosure grant for the closed protocol',
  },
  {
    file: DISCLOSURE_PROTOCOL,
    symbol: 'assertExpectedBinding',
    note: 'compares a disclosure grant with its expected binding',
  },
  {
    file: DEVICES,
    symbol: 'MsaidiziDevicesService.killAll',
    note: 'deployment kill switch; settles actions and never dispatches',
  },
  {
    file: DEVICES,
    symbol: 'MsaidiziDevicesService.reconcileGlobalKill',
    note: 'repairs the durable side of the kill switch',
  },
  {
    file: DEVICES,
    symbol: 'MsaidiziDevicesService.completePairing',
    note: 'pairs a device and stores its manifest; enrollment admission is validateCapability',
  },
  {
    file: DEVICES,
    symbol: 'MsaidiziDevicesService.progress',
    note: 'accepts progress heartbeats for an action the dispatch claim already admitted',
  },
  {
    file: DEVICES,
    symbol: 'MsaidiziDevicesService.requireActionForPeer',
    note: 'authenticates the device peer and loads the action row',
  },
  {
    file: DEVICES,
    symbol: 'MsaidiziDevicesService.disableDevice',
    note: 'revokes or kills one device and cancels its outstanding work',
  },
  {
    file: DEVICES,
    symbol: 'MsaidiziDevicesService.cancelCommands',
    note: 'builds cancel commands for a device',
  },
  {
    file: DEVICES,
    symbol: 'MsaidiziDevicesService.cancelUndispatchedActions',
    note: 'cancels queued actions that never crossed the device boundary',
  },
  {
    file: DEVICES,
    symbol: 'MsaidiziDevicesService.cancelUndispatchedTaskActions',
    note: 'cancels the queued actions of one task',
  },
  {
    file: DEVICES,
    symbol: 'MsaidiziDevicesService.hasPendingLateEvidence',
    note: 'counts actions still owed late evidence',
  },
  {
    file: DEVICES,
    symbol: 'MsaidiziDevicesService.claimFenceActionCommand',
    note: 'issues a revocation tombstone command and grants no execution authority',
  },
  {
    file: DEVICES,
    symbol: 'MsaidiziDevicesService.settleActionFenceReceipt',
    note: 'verifies a signed fence receipt',
  },
  {
    file: DEVICES,
    symbol: 'MsaidiziDevicesService.claimReplayResultCommand',
    note: 'issues transport authority to replay an existing terminal result',
  },
  {
    file: DEVICES,
    symbol: 'MsaidiziDevicesService.verifyEgressSettlement',
    note: 'verifies egress receipts and metering; settleResult holds the capability gate',
  },
  {
    file: DEVICES,
    symbol: 'MsaidiziDevicesService.rejectLateEvidence',
    note: 'records a rejected late-evidence attempt',
  },
  {
    file: DEVICES,
    symbol: 'MsaidiziDevicesService.acceptLateTerminalEvidence',
    note: 'attaches recovery proof to an already terminal action',
  },
  {
    file: DEVICES,
    symbol: 'MsaidiziDevicesService.persistHostObservationArtifact',
    note: 'writes the artifact row for an observation persistHostResultObservation admitted',
  },
  {
    file: DEVICES,
    symbol: 'MsaidiziDevicesService.settleInterruptedAction',
    note: 'terminalises an action with a reason; the sink several refusals call',
  },
  {
    file: DEVICES,
    symbol: 'MsaidiziDevicesService.assertActiveMandate',
    note: 'checks mandate status and expiry',
  },
  {
    file: DEVICES,
    symbol: 'hostResultAuditSummary',
    note: 'redacts a result summary before it reaches the audit ledger',
  },
  {
    file: DEVICES,
    symbol: 'validateActionResultOutput',
    note: 'measures reported output bytes and egress against the budget; admits no capability',
  },
  {
    file: DEVICES,
    symbol: 'resultReceiptDigest',
    note: 'hashes the reported result envelope into a receipt digest',
  },
  {
    file: DEVICES,
    symbol: 'validateLocalSpeechReceipt',
    note: 'validates the local speech receipt',
  },
  {
    file: DEVICES,
    symbol: 'decodeBoundLocalSpeechTranscript',
    note: 'decodes a transcript bound to one action',
  },
  {
    file: DEVICES,
    symbol: 'decodeBoundHostMedia',
    note: 'decodes media bound to one action',
  },
  {
    file: DEVICES,
    symbol: 'isMandateValidForAction',
    note: 'mandate validity test for one action',
  },
  {
    file: DEVICES,
    symbol: 'mandateConsentGrantForAction',
    note: 'finds the mandate grant covering one action',
  },
  {
    file: DEVICES,
    symbol: 'oneShotConsentGrantedForAction',
    note: 'checks one-shot consent events for one action',
  },
  {
    file: POLICY_EVALUATOR,
    symbol: 'DeterministicMsaidiziPolicyEvaluator.preflight',
    note: 'budget and mode preflight, before any step exists',
  },
  {
    file: POLICY_EVALUATOR,
    symbol: 'DeterministicMsaidiziPolicyEvaluator.evaluate',
    note: 'walks a candidate plan and delegates every step to evaluateStep',
  },
  {
    file: POLICY_EVALUATOR,
    symbol: 'DeterministicMsaidiziPolicyEvaluator.evaluateCapabilityMatch',
    note: 'checks a step against the offered capability contract',
  },
  {
    file: POLICY_EVALUATOR,
    symbol: 'hasPermissions',
    note: 'permission-set test for one capability',
  },
  {
    file: POLICY_EVALUATOR,
    symbol: 'mandateAllows',
    note: 'mandate grant test for one capability',
  },
  {
    file: POLICY_EVALUATOR,
    symbol: 'lockedIdentity',
    note: 'derives the locked step identity string',
  },
  {
    file: REASONING_CONTEXT,
    symbol: 'MsaidiziReasoningContextService.resolve',
    note: 'assembles the reasoning context; host capabilities come from hostCapabilities',
  },
  {
    file: REASONING_CONTEXT,
    symbol: 'MsaidiziReasoningContextService.erpCapabilities',
    note: 'ERP route capabilities, never device capabilities',
  },
  {
    file: REASONING_CONTEXT,
    symbol: 'MsaidiziReasoningContextService.resolveMandate',
    note: 'loads the mandate backing the context',
  },
  {
    file: REASONING_CONTEXT,
    symbol: 'MsaidiziReasoningContextService.selfImprovementCapabilities',
    note: 'self-improvement capabilities, never device capabilities',
  },
  {
    file: REASONING_CONTEXT,
    symbol: 'isSupervisorBoundaryCapability',
    note: 'prefix test for supervisor boundary capabilities',
  },
  {
    file: REASONING_CONTEXT,
    symbol: 'entriesForCapabilities',
    note: 'maps capability ids onto registry entries',
  },
  {
    file: REASONING_CONTEXT,
    symbol: 'mandateGrants',
    note: 'parses stored mandate grants',
  },
  {
    file: REASONING_CONTEXT,
    symbol: 'grantAllows',
    note: 'grant matching for one capability',
  },
  {
    file: REASONING_CONTEXT,
    symbol: 'lexicalScore',
    note: 'ranks a capability against the objective text',
  },
  {
    file: REASONING_CONTEXT,
    symbol: 'boundedCapabilityBytes',
    note: 'trims the already filtered catalogue to a byte budget',
  },
  {
    file: ADAPTIVE,
    symbol: 'MsaidiziAdaptiveReasoningService.applyDecision',
    note: 'applies a checkpoint decision to the task',
  },
  {
    file: ADAPTIVE,
    symbol: 'MsaidiziAdaptiveReasoningService.buildModelInput',
    note: 'assembles the checkpoint model input; the file branch is attachCheckpointFile',
  },
  {
    file: ADAPTIVE,
    symbol: 'MsaidiziAdaptiveReasoningService.attachCheckpointImage',
    note: 'attaches the settled image; the file sibling is a registered refusal',
  },
  {
    file: ADAPTIVE,
    symbol: 'checkpointMedia',
    note: 'decodes the checkpoint media binding',
  },
  {
    file: ADAPTIVE,
    symbol: 'releaseTransientAttachmentData',
    note: 'zeroes transient attachment buffers after the model call returns',
  },
];

/**
 * Reviewed files that read a capability member or name a closed capability id but
 * are not on the enforcement surface, because they never admit one towards a
 * device.
 */
export const HOST_FILE_OUT_OF_SCOPE_FILES: readonly HostFileOutOfScopeFile[] = [
  {
    file: 'modules/auth/msaidizi-task-token.service.ts',
    note: 'mints a step-scoped task token that carries the capability id as a claim',
  },
  {
    file: 'modules/auth/strategies/jwt.strategy.ts',
    note: 'validates those step-scoped token claims',
  },
  {
    file: 'modules/msaidizi/domain-filter.ts',
    note: 'ranks ERP tool-registry entries by domain; entry.capability is an HTTP route descriptor',
  },
  {
    file: 'modules/msaidizi/measured-fast-path.ts',
    note: 'ERP fast-path selection, never a device capability',
  },
  {
    file: 'modules/msaidizi/msaidizi.service.ts',
    note: 'dispatches ERP tool calls by registry tier; entry.capability is an HTTP route descriptor',
  },
  {
    file: 'modules/msaidizi/procedures.service.ts',
    note: 'summarises ERP procedure steps from registry entries',
  },
  {
    file: 'modules/msaidizi/tool-registry.ts',
    note: 'the ERP route registry itself; its capabilities are HTTP routes, not host capabilities',
  },
  {
    file: 'modules/msaidizi-control-plane/msaidizi-schedule-template.ts',
    note: 'schedule template graph validation against a mandate',
  },
  {
    file: 'modules/msaidizi-devices/host-file-observation.ts',
    note: 'decodes the legacy file-read observation shape for receipt validation only',
  },
  {
    file: 'modules/msaidizi-memory/msaidizi-runtime-memory.service.ts',
    note: 'captures terminal step outcomes into runtime memory',
  },
  {
    file: 'modules/msaidizi-reasoning/msaidizi-reasoning.service.ts',
    note: 'presents an already evaluated step for confirmation',
  },
  {
    file: 'modules/msaidizi-reasoning/strict-model-json.ts',
    note: 'parses model plan JSON before the policy evaluator sees it',
  },
  {
    file: 'modules/msaidizi-recovery/msaidizi-recovery.service.ts',
    note: 'requests recovery for an already settled action',
  },
  {
    file: 'modules/msaidizi-task-runtime/msaidizi-runtime-critic.service.ts',
    note: 'reviews runtime decisions and admits nothing',
  },
  {
    file: 'modules/msaidizi-task-runtime/msaidizi-schedule-dispatcher.service.ts',
    note: 'turns schedule occurrences into tasks',
  },
  {
    file: 'modules/msaidizi-task-runtime/msaidizi-task-step.handler.ts',
    note: 'executes a step; host steps reach a device only through queueHostAction',
  },
  {
    file: 'modules/msaidizi-tasks/msaidizi-input-bindings.ts',
    note: 'resolves step input bindings',
  },
  {
    file: 'modules/msaidizi-tasks/msaidizi-tasks.service.ts',
    note: 'validates the task graph; host steps are gated at evaluateStep and queueHostAction',
  },
  {
    file: 'modules/msaidizi-updates/update-candidate-proposal.port.ts',
    note: 'validates self-update proposal steps',
  },
];

export interface ScannedFunction {
  file: string;
  symbol: string;
  /** Declaration text with every whitespace run collapsed to one space. */
  source: string;
}

/**
 * Absolute path of `src`, resolved from this file. Both scans are rooted here,
 * so `src/common`, `src/prisma`, `src/bootstrap` and `src/config` are inside the
 * guard, not only `src/modules`.
 */
export function msaidiziSourceRoot(): string {
  return path.resolve(__dirname, '../..');
}

export function toSourcePath(sourceRoot: string, absolute: string): string {
  return path.relative(sourceRoot, absolute).split(path.sep).join('/');
}

export function sourceFileExists(sourceRoot: string, file: string): boolean {
  return existsSync(path.join(sourceRoot, file));
}

export function sourceFiles(sourceRoot: string): string[] {
  const walk = (root: string): string[] =>
    readdirSync(root, { withFileTypes: true }).flatMap((entry) => {
      const absolute = path.join(root, entry.name);
      if (entry.isDirectory()) return walk(absolute);
      return entry.isFile() && entry.name.endsWith('.ts') && !entry.name.endsWith('.spec.ts')
        ? [absolute]
        : [];
    });
  return walk(sourceRoot).sort();
}

export function normalizeSource(source: string): string {
  return source.replace(/\s+/g, ' ').trim();
}

/** Files that import the shared predicates, i.e. the enforcement surface. */
export function enforcementSurfaceFiles(sourceRoot: string): string[] {
  const importsPolicy = new RegExp(`from '[^']*${HOST_FILE_POLICY_MODULE.replace('.', '\\.')}'`);
  return sourceFiles(sourceRoot)
    .filter((absolute) => importsPolicy.test(readFileSync(absolute, 'utf8')))
    .map((absolute) => toSourcePath(sourceRoot, absolute))
    .filter((file) => !SCAN_EXCLUDED_FILES.includes(file));
}

/**
 * Every named function-like declaration in one file, attributed to its outermost
 * enclosing function: nested helpers belong to the function that contains them.
 */
export function declaredFunctions(sourceRoot: string, file: string): ScannedFunction[] {
  const absolute = path.join(sourceRoot, file);
  const sourceFile = ts.createSourceFile(
    absolute,
    readFileSync(absolute, 'utf8'),
    ts.ScriptTarget.Latest,
    true,
  );
  const found: ScannedFunction[] = [];

  const visit = (node: ts.Node, prefix: string): void => {
    let nextPrefix = prefix;
    let symbol: string | null = null;
    if (ts.isClassDeclaration(node)) {
      nextPrefix = node.name ? node.name.text : '(anonymous class)';
    } else if (ts.isConstructorDeclaration(node)) {
      symbol = `${prefix ? `${prefix}.` : ''}constructor`;
    } else if (
      ts.isMethodDeclaration(node) ||
      ts.isFunctionDeclaration(node) ||
      ts.isGetAccessor(node) ||
      ts.isSetAccessor(node)
    ) {
      symbol = `${prefix ? `${prefix}.` : ''}${node.name ? node.name.getText(sourceFile) : '(anonymous)'}`;
    } else if (
      ts.isVariableStatement(node) &&
      node.declarationList.declarations.length === 1 &&
      node.declarationList.declarations[0].initializer &&
      (ts.isArrowFunction(node.declarationList.declarations[0].initializer) ||
        ts.isFunctionExpression(node.declarationList.declarations[0].initializer))
    ) {
      symbol = `${prefix ? `${prefix}.` : ''}${node.declarationList.declarations[0].name.getText(sourceFile)}`;
    } else if (
      ts.isPropertyDeclaration(node) &&
      node.initializer &&
      ts.isArrowFunction(node.initializer)
    ) {
      symbol = `${prefix ? `${prefix}.` : ''}${node.name.getText(sourceFile)}`;
    }
    if (symbol) {
      found.push({ file, symbol, source: normalizeSource(node.getText(sourceFile)) });
      return;
    }
    ts.forEachChild(node, (child) => visit(child, nextPrefix));
  };

  visit(sourceFile, '');
  return found.sort((left, right) => left.symbol.localeCompare(right.symbol));
}

export function isCapabilityHandling(source: string): boolean {
  return CAPABILITY_HANDLING_PATTERNS.some((pattern) => pattern.test(source));
}

export function containsGuardToken(source: string): boolean {
  return HOST_FILE_GUARD_TOKENS.some((token) => source.includes(token));
}

/** The derived inventory the manifest spec partitions. */
export function capabilityHandlingFunctions(sourceRoot: string): ScannedFunction[] {
  return enforcementSurfaceFiles(sourceRoot)
    .flatMap((file) => declaredFunctions(sourceRoot, file))
    .filter((declared) => isCapabilityHandling(declared.source));
}

/** Files anywhere under `src` that read a capability member or name a closed id. */
export function hostActionCapabilityFiles(sourceRoot: string): string[] {
  return sourceFiles(sourceRoot)
    .filter((absolute) => {
      const source = readFileSync(absolute, 'utf8');
      return HOST_ACTION_CAPABILITY_FILE_PATTERNS.some((pattern) => pattern.test(source));
    })
    .map((absolute) => toSourcePath(sourceRoot, absolute))
    .filter((file) => !SCAN_EXCLUDED_FILES.includes(file));
}

export function siteKey(entry: { file: string; symbol: string }): string {
  return `${entry.file} :: ${entry.symbol}`;
}

const WHY = [
  'WHY THIS TEST EXISTS',
  '  Two host capabilities are permanently closed in this build:',
  `    ${HOST_FILE_CONTENT_CAPABILITY_IDS.join('\n    ')}`,
  '  File bytes read on a paired workstation must never reach a device dispatch,',
  '  a durable artifact row, an audit summary, or the model. There is no single',
  '  production port that enforces this yet, so the boundary is held by the',
  `  ${HOST_FILE_ENFORCEMENT_SITES.length} separate checks registered in`,
  '  msaidizi-devices/host-file-ephemerality-enforcement-evidence.ts.',
  '  Nothing structural fails when a new entry point simply forgets one, so this',
  '  test is the guard: it re-reads the source and re-partitions the surface.',
];

export function unregisteredFunctionsMessage(unregistered: readonly ScannedFunction[]): string {
  return [
    'Unregistered capability-handling code on the host-file ephemerality surface:',
    ...unregistered.map((entry) => `  - ${siteKey(entry)}`),
    '',
    ...WHY,
    '',
    'WHAT TO DO NOW (pick one, then update the registry)',
    '  1. If your code can carry, dispatch, settle, persist, offer or disclose a',
    '     host file capability, refuse it. Import',
    '     isUnavailableHostFileContentCapability from',
    "     'msaidizi-devices/host-file-ephemerality.policy', call it on the",
    '     capability you are about to act on, and fail the path with',
    '     REASONING_FILE_EPHEMERAL_CHANNEL_NOT_READY. Then add an entry to',
    '     HOST_FILE_ENFORCEMENT_SITES with the exact guard text you wrote.',
    '  2. If your code genuinely takes no admission decision about host file',
    '     bytes, add it to HOST_FILE_SURFACE_EXCLUSIONS with a note saying what',
    '     it does with the capability. Say what it does, not that it is safe.',
    '  If you only renamed or moved a function, update its entry in place.',
    '  Do not widen the patterns in CAPABILITY_HANDLING_PATTERNS to make this',
    '  message go away.',
  ].join('\n');
}

export function missingEnforcementMessage(problems: readonly string[]): string {
  return [
    'A registered host-file ephemerality enforcement check is gone or changed:',
    ...problems.map((problem) => `  - ${problem}`),
    '',
    ...WHY,
    '',
    'WHAT TO DO NOW',
    '  If you did not mean to remove a check, restore it.',
    '  If you refactored one, or moved the file that holds it, update its entry',
    '  (file, symbol, guards, entireDeclaration) in HOST_FILE_ENFORCEMENT_SITES so',
    '  the registry describes the code as written. The guard fragments span the',
    '  test and its consequence together on purpose: if yours no longer matches',
    '  because you added a condition or a statement between them, check that the',
    '  refusal still fires unconditionally before you re-pin the text.',
    '  If you believe the boundary itself should open, that is a security review,',
    '  not a test edit: see the header comment in',
    '  msaidizi-devices/host-file-ephemerality.policy.ts.',
  ].join('\n');
}

export function unclassifiedFilesMessage(files: readonly string[]): string {
  return [
    'These files read a capability member or name a closed host file capability id,',
    'but are neither on the enforcement surface nor registered as reviewed',
    'out-of-scope:',
    ...files.map((file) => `  - ${file}`),
    '',
    ...WHY,
    '',
    'WHAT TO DO NOW',
    '  If the file can move a host capability towards a device, import the policy',
    "  from 'msaidizi-devices/host-file-ephemerality.policy' and enforce it. That",
    '  puts the file on the enforcement surface, where every function in it must',
    '  then be registered as an enforcement site or a reviewed exclusion.',
    '  If it cannot, add it to HOST_FILE_OUT_OF_SCOPE_FILES with a note saying',
    '  what it does with the capability.',
  ].join('\n');
}

export function staleOutOfScopeMessage(files: readonly string[]): string {
  return [
    'HOST_FILE_OUT_OF_SCOPE_FILES names files that no longer exist:',
    ...files.map((file) => `  - ${file}`),
    '',
    'Each row records a human judgement about a specific file. A row whose file is',
    'gone asserts a reviewed verdict about nothing, and stops the reviewed set from',
    "tracking the tree. Delete the row, or point it at the file's new path.",
  ].join('\n');
}
