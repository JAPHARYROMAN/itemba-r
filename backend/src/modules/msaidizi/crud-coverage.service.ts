/**
 * Machine-readable ERP capability coverage.
 *
 * The report separates "exists in the router" from "eligible for Msaidizi",
 * schema fidelity, permission/risk classification, and actual execution
 * evidence.  That keeps a large manifest from being mistaken for proven CRUD.
 */

import { Injectable, Optional } from '@nestjs/common';
import { Capability } from '../../common/capabilities/capability-manifest';
import { RequestSchemaQuality } from '../../common/capabilities/dto-json-schema';
import { CrudEvidenceStore } from './crud-evidence.store';
import {
  AcceptedCrudEvidence,
  CrudCapabilityGovernanceEvidence,
  CrudEvidenceArtifactRejection,
  CrudEvidenceControlKind,
  CrudEvidenceVerification,
  CrudPositiveFixtureRegistration,
  crudEvidenceFixturesForManifest,
  isVerifierAcceptedCrudEvidence,
  manifestContractDigest,
  metadataReadEvidenceBlockers,
} from './crud-execution-evidence';
import { ManifestProvider } from './manifest.provider';

export type CrudOperationKind = 'read' | 'create' | 'update' | 'delete' | 'action';
export type CoverageInclusion = 'included' | 'excluded';
export type DiscoveryEligibility = 'eligible' | 'ineligible';
export type CoverageExclusionReason =
  | 'agent_excluded'
  | 'read_writes_audit_ledger'
  | 'device_headers_not_represented'
  | 'binary_result_not_represented'
  | 'multipart_transport_not_represented'
  | 'external_egress_not_represented'
  | 'filesystem_materialization_not_represented'
  | 'asynchronous_effect_not_represented'
  | 'recent_human_auth_required'
  | 'company_scope_not_enforced'
  | 'query_schema_not_strict'
  | 'api_key_only'
  | 'role_only'
  | 'authenticated_only'
  | 'public_route'
  | 'no_permission_code';
export type CoverageSchemaQuality = RequestSchemaQuality | 'not_applicable';
export type ExecutionEvidenceLevel = 'none' | 'unit' | 'loopback';
export type ExecutionUnverifiedReason =
  | 'capability_excluded'
  | 'no_deterministic_seeded_positive_control'
  | 'no_positive_fixture_registered'
  | 'registered_fixture_not_executed'
  | 'positive_fixture_failed'
  | `evidence_${CrudEvidenceArtifactRejection}`;
export type CoverageBlockReason = CoverageExclusionReason | ExecutionUnverifiedReason;
export type CrudReleaseBlockCode =
  | 'execution_evidence_artifact_rejected'
  | 'discovery_eligible_operations_unverified'
  | 'operations_without_positive_fixture'
  | 'registered_positive_fixtures_not_executed'
  | 'positive_fixtures_failed'
  | 'authorization_contract_missing'
  | 'shared_permission_guard_runtime_missing'
  | 'service_principal_task_scope_runtime_missing'
  | 'read_scope_unclassified'
  | 'scoped_read_binding_evidence_missing'
  | 'mutation_audit_evidence_missing';

export interface CrudExecutionEvidence {
  level: Exclude<ExecutionEvidenceLevel, 'none'>;
  /** Stable case identifiers produced by the test/harness that exercised it. */
  cases: string[];
  lastVerifiedAt?: string;
}

type CrudExecutionEvidenceMap = Readonly<Record<string, CrudExecutionEvidence>>;

export interface CrudCoverageEntry {
  capabilityId: string;
  controller: string;
  handler: string;
  http: { method: Capability['verb']; path: string };
  operation: CrudOperationKind;
  /** Whether the route is permission-governed and may be discovered by Msaidizi. */
  discoveryEligibility: {
    status: DiscoveryEligibility;
    reason?: CoverageExclusionReason;
  };
  /**
   * Release-grade CRUD inclusion. `included` means current signed loopback
   * positive evidence exists; discovery eligibility alone is never enough.
   */
  inclusion: {
    status: CoverageInclusion;
    reason?: CoverageBlockReason;
  };
  permissions: {
    allOf: string[];
    anyOf: string[];
    guard: Capability['guard'];
  };
  risk: {
    tier: Capability['tier'];
    reason: string;
  };
  schema: {
    path: CoverageSchemaQuality;
    query: CoverageSchemaQuality;
    body: CoverageSchemaQuality;
    queryDto?: string;
    bodyDto?: string;
    sources: string[];
  };
  testedExecution: {
    level: ExecutionEvidenceLevel;
    status: 'verified' | 'unverified' | 'not_applicable';
    cases: string[];
    lastVerifiedAt?: string;
    unverifiedReason?: ExecutionUnverifiedReason;
  };
}

export interface CrudCoverageReport {
  contract: 'msaidizi-crud-coverage/v1';
  generatedAt: string;
  summary: {
    total: number;
    discoveryEligible: number;
    discoveryIneligible: number;
    included: number;
    excluded: number;
    strictSchemas: number;
    withExecutionEvidence: number;
    loopbackVerified: number;
    registeredPositiveFixtures: number;
    executedPositiveFixtures: number;
    passedPositiveFixtures: number;
    securityControlsPassed: number;
    releaseQualified: boolean;
    byOperation: Record<CrudOperationKind, number>;
    includedByOperation: Record<CrudOperationKind, number>;
    loopbackVerifiedByOperation: Record<CrudOperationKind, number>;
    unverifiedByReason: Partial<Record<ExecutionUnverifiedReason, number>>;
  };
  executionEvidence: {
    status: 'accepted' | 'rejected';
    reason?: CrudEvidenceArtifactRejection;
    detail?: string;
    artifact?: {
      runId: string;
      generatedAt: string;
      expiresAt: string;
      manifestDigest: string;
      payloadDigest: string;
      keyId: string;
      harnessVersion: string;
    };
    securityControls: Record<
      Exclude<CrudEvidenceControlKind, 'positive'>,
      { passed: boolean; cases: string[] }
    >;
    governanceEvidence: Readonly<Record<string, CrudCapabilityGovernanceEvidence>>;
  };
  releaseGate: {
    status: 'passed' | 'failed';
    target: 'all_discovery_eligible_operations';
    blockers: Array<{
      code: CrudReleaseBlockCode;
      count: number;
    }>;
  };
  capabilities: CrudCoverageEntry[];
}

/** Builds a deterministic report apart from the caller-supplied timestamp. */
export function buildCrudCoverageReport(
  manifest: readonly Capability[],
  verification: CrudEvidenceVerification = noEvidenceConfigured(),
  generatedAt = new Date().toISOString(),
): CrudCoverageReport {
  verification = normalizeVerification(verification);
  // Only a verifier-accepted artifact can populate this map. Keeping the
  // conversion inside this builder prevents callers from fabricating a raw
  // `capabilityId -> loopback` map and accidentally promoting smoke results.
  const evidence = evidenceMapFromVerification(verification);
  const fixtures = crudEvidenceFixturesForManifest(manifest);
  const manifestCapabilityIds = new Set(manifest.map((capability) => capability.id));
  const registeredPositiveCapabilities = new Set(
    fixtures
      .filter(
        (fixture) =>
          fixture.controlKind === 'positive' && manifestCapabilityIds.has(fixture.capabilityId),
      )
      .map((fixture) => fixture.capabilityId),
  );
  const deterministicReadBlockers = new Set(
    metadataReadEvidenceBlockers(manifest).map((blocker) => blocker.capabilityId),
  );
  const capabilities = [...manifest]
    .sort((a, b) => a.id.localeCompare(b.id))
    .map((capability) =>
      coverageEntry(
        capability,
        evidence[capability.id],
        executionUnverifiedReason(
          capability,
          verification,
          registeredPositiveCapabilities,
          deterministicReadBlockers,
        ),
      ),
    );

  const byOperation: Record<CrudOperationKind, number> = {
    read: 0,
    create: 0,
    update: 0,
    delete: 0,
    action: 0,
  };
  for (const capability of capabilities) byOperation[capability.operation] += 1;
  const includedByOperation = emptyOperationCounts();
  const loopbackVerifiedByOperation = emptyOperationCounts();
  const unverifiedByReason: Partial<Record<ExecutionUnverifiedReason, number>> = {};
  for (const capability of capabilities) {
    if (capability.inclusion.status === 'included') {
      includedByOperation[capability.operation] += 1;
    }
    if (capability.testedExecution.level === 'loopback') {
      loopbackVerifiedByOperation[capability.operation] += 1;
    }
    const reason = capability.testedExecution.unverifiedReason;
    if (reason) unverifiedByReason[reason] = (unverifiedByReason[reason] ?? 0) + 1;
  }

  const executionEvidence = describeVerification(verification, manifest);
  const discoveryEligible = capabilities.filter(
    (entry) => entry.discoveryEligibility.status === 'eligible',
  );
  const included = capabilities.filter((entry) => entry.inclusion.status === 'included');
  const securityControlsPassed = Object.values(executionEvidence.securityControls).filter(
    (control) => control.passed,
  ).length;
  const registeredPositiveFixtures = fixtures.filter(
    (fixture): fixture is CrudPositiveFixtureRegistration =>
      fixture.controlKind === 'positive' && manifestCapabilityIds.has(fixture.capabilityId),
  );
  const accepted = verification.status === 'accepted' ? verification : undefined;
  const passedPositiveFixtures = accepted
    ? Object.values(accepted.positiveEvidence).reduce((total, item) => total + item.cases.length, 0)
    : 0;
  const releaseGate = buildReleaseGate({
    verification,
    capabilities,
    discoveryEligibleCount: discoveryEligible.length,
    includedCount: included.length,
    registeredPositiveFixtures,
    executedPositiveFixtures: accepted?.executedPositiveFixtures.length ?? 0,
    securityControlsPassed,
  });

  return {
    contract: 'msaidizi-crud-coverage/v1',
    generatedAt,
    summary: {
      total: capabilities.length,
      discoveryEligible: discoveryEligible.length,
      discoveryIneligible: capabilities.length - discoveryEligible.length,
      included: included.length,
      excluded: capabilities.filter((entry) => entry.inclusion.status === 'excluded').length,
      strictSchemas: capabilities.filter(hasStrictApplicableSchemas).length,
      withExecutionEvidence: capabilities.filter((entry) => entry.testedExecution.level !== 'none')
        .length,
      loopbackVerified: capabilities.filter((entry) => entry.testedExecution.level === 'loopback')
        .length,
      registeredPositiveFixtures: registeredPositiveFixtures.length,
      executedPositiveFixtures: accepted?.executedPositiveFixtures.length ?? 0,
      passedPositiveFixtures,
      securityControlsPassed,
      releaseQualified: releaseGate.status === 'passed',
      byOperation,
      includedByOperation,
      loopbackVerifiedByOperation,
      unverifiedByReason,
    },
    executionEvidence,
    releaseGate,
    capabilities,
  };
}

@Injectable()
export class CrudCoverageService {
  constructor(
    private readonly manifest: ManifestProvider,
    @Optional() private readonly evidenceStore?: CrudEvidenceStore,
  ) {}

  report(expectedArtifactSha256?: string): CrudCoverageReport {
    const capabilities = this.manifest.capabilities();
    const verification = this.evidenceStore
      ? expectedArtifactSha256
        ? this.evidenceStore.load(capabilities, new Date(), expectedArtifactSha256)
        : this.evidenceStore.load(capabilities)
      : {
          status: 'rejected' as const,
          reason: 'artifact_not_configured' as const,
          detail: 'No CRUD evidence store is available.',
        };
    return buildCrudCoverageReport(capabilities, verification, new Date().toISOString());
  }
}

function coverageEntry(
  capability: Capability,
  evidence: CrudExecutionEvidence | undefined,
  unverifiedReason?: ExecutionUnverifiedReason,
): CrudCoverageEntry {
  const exclusionReason = exclusionReasonFor(capability);
  const effectiveEvidence = exclusionReason ? undefined : evidence;
  const querySchema = capability.params.querySchema;
  const bodySchema = capability.params.bodySchema;
  const sources = new Set<string>([
    ...(querySchema?.sources ?? []),
    ...(bodySchema?.sources ?? []),
  ]);

  return {
    capabilityId: capability.id,
    controller: capability.controller,
    handler: capability.handler,
    http: { method: capability.verb, path: capability.path },
    operation: operationFor(capability),
    discoveryEligibility: exclusionReason
      ? { status: 'ineligible', reason: exclusionReason }
      : { status: 'eligible' },
    inclusion: effectiveEvidence
      ? { status: 'included' }
      : {
          status: 'excluded',
          reason: exclusionReason ?? unverifiedReason ?? 'no_positive_fixture_registered',
        },
    permissions: {
      allOf: capability.permissions,
      anyOf: capability.anyPermissions,
      guard: capability.guard,
    },
    risk: { tier: capability.tier, reason: capability.tierReason },
    schema: {
      path: capability.params.path.length > 0 ? 'strict' : 'not_applicable',
      query:
        querySchema?.quality ??
        (capability.params.query.length > 0
          ? 'strict'
          : capability.params.freeFormQuery
            ? 'opaque'
            : 'not_applicable'),
      body: capability.params.hasBody ? (bodySchema?.quality ?? 'opaque') : 'not_applicable',
      ...(querySchema ? { queryDto: querySchema.dtoName } : {}),
      ...(bodySchema ? { bodyDto: bodySchema.dtoName } : {}),
      sources: [...sources].sort(),
    },
    testedExecution: effectiveEvidence
      ? {
          level: effectiveEvidence.level,
          status: 'verified',
          cases: [...effectiveEvidence.cases].sort(),
          ...(effectiveEvidence.lastVerifiedAt
            ? { lastVerifiedAt: effectiveEvidence.lastVerifiedAt }
            : {}),
        }
      : exclusionReason
        ? {
            level: 'none',
            status: 'not_applicable',
            cases: [],
            unverifiedReason: 'capability_excluded',
          }
        : {
            level: 'none',
            status: 'unverified',
            cases: [],
            unverifiedReason: unverifiedReason ?? 'no_positive_fixture_registered',
          },
  };
}

function evidenceMapFromVerification(
  verification: CrudEvidenceVerification,
): CrudExecutionEvidenceMap {
  if (verification.status !== 'accepted') return {};
  return Object.fromEntries(
    Object.entries(verification.positiveEvidence).map(([capabilityId, item]) => [
      capabilityId,
      {
        level: 'loopback' as const,
        cases: item.cases,
        lastVerifiedAt: item.lastVerifiedAt,
      },
    ]),
  );
}

function executionUnverifiedReason(
  capability: Capability,
  verification: CrudEvidenceVerification,
  registeredPositiveCapabilities: ReadonlySet<string>,
  deterministicReadBlockers: ReadonlySet<string>,
): ExecutionUnverifiedReason | undefined {
  if (exclusionReasonFor(capability)) return 'capability_excluded';
  if (!registeredPositiveCapabilities.has(capability.id)) {
    return deterministicReadBlockers.has(capability.id)
      ? 'no_deterministic_seeded_positive_control'
      : 'no_positive_fixture_registered';
  }
  if (verification.status === 'rejected') return `evidence_${verification.reason}`;
  if (verification.failedPositiveFixtures[capability.id]?.length) {
    return 'positive_fixture_failed';
  }
  return 'registered_fixture_not_executed';
}

function describeVerification(
  verification: CrudEvidenceVerification,
  manifest: readonly Capability[],
): CrudCoverageReport['executionEvidence'] {
  const emptySecurityControls: CrudCoverageReport['executionEvidence']['securityControls'] = {
    permission_denial: { passed: false, cases: [] },
    company_isolation: { passed: false, cases: [] },
    audit_attribution: { passed: false, cases: [] },
    service_principal_task_scope: { passed: false, cases: [] },
  };
  if (verification.status === 'rejected') {
    return {
      status: 'rejected',
      reason: verification.reason,
      detail: verification.detail,
      securityControls: emptySecurityControls,
      governanceEvidence: {},
    };
  }

  return {
    status: 'accepted',
    artifact: {
      runId: verification.artifact.runId,
      generatedAt: verification.artifact.generatedAt,
      expiresAt: verification.artifact.expiresAt,
      manifestDigest: manifestContractDigest(manifest),
      payloadDigest: verification.artifact.payloadDigest,
      keyId: verification.artifact.signature.keyId,
      harnessVersion: verification.artifact.harnessVersion,
    },
    securityControls: cloneSecurityControls(verification),
    governanceEvidence: cloneGovernanceEvidence(verification),
  };
}

function cloneGovernanceEvidence(
  verification: AcceptedCrudEvidence,
): Readonly<Record<string, CrudCapabilityGovernanceEvidence>> {
  return Object.fromEntries(
    Object.entries(verification.governanceEvidence).map(([capabilityId, evidence]) => [
      capabilityId,
      {
        authorizationContract: { ...evidence.authorizationContract },
        scope: { ...evidence.scope, cases: [...evidence.scope.cases] },
        auditAttribution: {
          ...evidence.auditAttribution,
          cases: [...evidence.auditAttribution.cases],
        },
      },
    ]),
  );
}

function cloneSecurityControls(
  verification: AcceptedCrudEvidence,
): CrudCoverageReport['executionEvidence']['securityControls'] {
  return {
    permission_denial: {
      passed: verification.securityControls.permission_denial.passed,
      cases: [...verification.securityControls.permission_denial.cases],
    },
    company_isolation: {
      passed: verification.securityControls.company_isolation.passed,
      cases: [...verification.securityControls.company_isolation.cases],
    },
    audit_attribution: {
      passed: verification.securityControls.audit_attribution.passed,
      cases: [...verification.securityControls.audit_attribution.cases],
    },
    service_principal_task_scope: {
      passed: verification.securityControls.service_principal_task_scope.passed,
      cases: [...verification.securityControls.service_principal_task_scope.cases],
    },
  };
}

function buildReleaseGate(input: {
  verification: CrudEvidenceVerification;
  capabilities: readonly CrudCoverageEntry[];
  discoveryEligibleCount: number;
  includedCount: number;
  registeredPositiveFixtures: readonly CrudPositiveFixtureRegistration[];
  executedPositiveFixtures: number;
  securityControlsPassed: number;
}): CrudCoverageReport['releaseGate'] {
  const blockers: CrudCoverageReport['releaseGate']['blockers'] = [];
  const add = (code: CrudReleaseBlockCode, count: number) => {
    if (count > 0) blockers.push({ code, count });
  };

  add('execution_evidence_artifact_rejected', input.verification.status === 'rejected' ? 1 : 0);
  add(
    'discovery_eligible_operations_unverified',
    input.discoveryEligibleCount - input.includedCount,
  );
  add(
    'operations_without_positive_fixture',
    input.capabilities.filter(
      (entry) =>
        entry.discoveryEligibility.status === 'eligible' &&
        (entry.testedExecution.unverifiedReason === 'no_positive_fixture_registered' ||
          entry.testedExecution.unverifiedReason === 'no_deterministic_seeded_positive_control'),
    ).length,
  );
  add(
    'registered_positive_fixtures_not_executed',
    input.registeredPositiveFixtures.length - input.executedPositiveFixtures,
  );
  add(
    'positive_fixtures_failed',
    input.verification.status === 'accepted'
      ? Object.values(input.verification.failedPositiveFixtures).reduce(
          (total, fixtures) => total + fixtures.length,
          0,
        )
      : 0,
  );
  const eligible = input.capabilities.filter(
    (entry) => entry.discoveryEligibility.status === 'eligible',
  );
  const registeredByCapability = new Map<string, CrudPositiveFixtureRegistration[]>();
  for (const fixture of input.registeredPositiveFixtures) {
    const current = registeredByCapability.get(fixture.capabilityId) ?? [];
    current.push(fixture);
    registeredByCapability.set(fixture.capabilityId, current);
  }
  const acceptedGovernance =
    input.verification.status === 'accepted' ? input.verification.governanceEvidence : {};
  add(
    'authorization_contract_missing',
    eligible.filter(
      (entry) => !acceptedGovernance[entry.capabilityId]?.authorizationContract.passed,
    ).length,
  );
  add(
    'shared_permission_guard_runtime_missing',
    input.verification.status === 'accepted' &&
      input.verification.securityControls.permission_denial.passed
      ? 0
      : 1,
  );
  add(
    'service_principal_task_scope_runtime_missing',
    input.verification.status === 'accepted' &&
      input.verification.securityControls.service_principal_task_scope.passed
      ? 0
      : 1,
  );
  add(
    'read_scope_unclassified',
    eligible.filter((entry) => {
      if (entry.operation !== 'read') return false;
      const fixtures = registeredByCapability.get(entry.capabilityId) ?? [];
      if (fixtures.length === 0) return false;
      const scopes = new Set(fixtures.map((fixture) => fixture.governance.scope));
      return (
        scopes.size !== 1 ||
        [...scopes].some(
          (scope) => !['company', 'actor', 'seeded-company', 'global'].includes(scope),
        )
      );
    }).length,
  );
  add(
    'scoped_read_binding_evidence_missing',
    eligible.filter((entry) => {
      if (entry.operation !== 'read') return false;
      const fixtures = registeredByCapability.get(entry.capabilityId) ?? [];
      const scopeRequired = fixtures.some((fixture) =>
        ['company', 'actor', 'seeded-company'].includes(fixture.governance.scope),
      );
      return scopeRequired && !acceptedGovernance[entry.capabilityId]?.scope.passed;
    }).length,
  );
  add(
    'mutation_audit_evidence_missing',
    eligible.filter((entry) => {
      if (entry.operation === 'read') return false;
      const fixtures = registeredByCapability.get(entry.capabilityId) ?? [];
      if (fixtures.length === 0) return false;
      const evidence = acceptedGovernance[entry.capabilityId]?.auditAttribution;
      return !evidence?.required || !evidence.passed;
    }).length,
  );

  return {
    status: blockers.length === 0 ? 'passed' : 'failed',
    target: 'all_discovery_eligible_operations',
    blockers,
  };
}

function noEvidenceConfigured(): CrudEvidenceVerification {
  return {
    status: 'rejected',
    reason: 'artifact_not_configured',
    detail: 'No signed CRUD execution evidence artifact is configured.',
  };
}

function normalizeVerification(verification: CrudEvidenceVerification): CrudEvidenceVerification {
  if (verification.status === 'rejected') return verification;
  if (isVerifierAcceptedCrudEvidence(verification)) return verification;
  return {
    status: 'rejected',
    reason: 'artifact_shape_invalid',
    detail: 'Execution evidence did not originate from the cryptographic artifact verifier.',
  };
}

function exclusionReasonFor(capability: Capability): CoverageExclusionReason | undefined {
  if (capability.agentExcluded) return capability.agentExclusionReason ?? 'agent_excluded';
  if (capability.permissions.length > 0 || capability.anyPermissions.length > 0) return undefined;

  switch (capability.guard) {
    case 'api-key':
      return 'api_key_only';
    case 'role':
      return 'role_only';
    case 'authenticated':
      return 'authenticated_only';
    case 'public':
      return 'public_route';
    default:
      return 'no_permission_code';
  }
}

function operationFor(capability: Capability): CrudOperationKind {
  if (capability.agentExclusionReason === 'read_writes_audit_ledger') return 'action';
  if (capability.verb === 'GET' || capability.verb === 'HEAD') return 'read';
  if (capability.verb === 'DELETE') return 'delete';

  const handler = capability.handler.toLowerCase();
  if (capability.verb === 'POST' && /^(create|add|register|upload|import)/.test(handler)) {
    return 'create';
  }
  if (/^(update|edit|patch|replace|set)/.test(handler)) return 'update';
  return 'action';
}

function hasStrictApplicableSchemas(entry: CrudCoverageEntry): boolean {
  const applicable = [entry.schema.path, entry.schema.query, entry.schema.body].filter(
    (quality) => quality !== 'not_applicable',
  );
  return applicable.length > 0 && applicable.every((quality) => quality === 'strict');
}

function emptyOperationCounts(): Record<CrudOperationKind, number> {
  return { read: 0, create: 0, update: 0, delete: 0, action: 0 };
}
