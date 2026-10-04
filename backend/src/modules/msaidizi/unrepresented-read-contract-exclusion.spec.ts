import {
  capabilitiesFor,
  extractCapabilities,
} from '../../common/capabilities/capability-manifest';
import { loadAllControllers } from '../../common/capabilities/load-controllers';
import { buildCrudCoverageReport } from './crud-coverage.service';
import {
  crudEvidenceFixturesForManifest,
  metadataReadEvidenceBlockers,
} from './crud-execution-evidence';
import { CRUD_PATH_READ_REMAINING_BLOCKERS } from './crud-path-read-evidence';
import { buildRegistry } from './tool-registry';

describe('unrepresented read authorization/query contracts', () => {
  const manifest = extractCapabilities(loadAllControllers());
  const fixtures = crudEvidenceFixturesForManifest(manifest);
  const everyPermission = [
    ...new Set(
      manifest.flatMap((capability) => [...capability.permissions, ...capability.anyPermissions]),
    ),
  ];
  const expectedByReason = {
    company_scope_not_enforced: CRUD_PATH_READ_REMAINING_BLOCKERS.filter(
      (blocker) => blocker.reason === 'company_scope_not_enforced',
    ).map((blocker) => blocker.capabilityId),
    query_schema_not_strict: CRUD_PATH_READ_REMAINING_BLOCKERS.filter(
      (blocker) => blocker.reason === 'query_schema_not_strict',
    ).map((blocker) => blocker.capabilityId),
  } as const;

  const posWorkflowByReason = {
    pos_draft_workflow_not_represented: [
      'PosDraftsController.list',
      'PosDraftsController.scopes',
      'PosDraftsController.context',
      'PosDraftsController.baseline',
      'PosDraftsController.outcome',
      'PosDraftsController.legacyOutcome',
      'PosDraftsController.detail',
      'PosDraftsController.receipt',
      'PosDraftsController.submit',
      'PosDraftsController.correct',
      'PosDraftsController.prepare',
    ],
    mobile_pos_onboarding_not_represented: [
      'MobilePosOnboardingController.branchOptions',
      'MobilePosOnboardingController.setups',
      'MobilePosOnboardingController.enrollments',
    ],
    agent_excluded: [
      'PosDraftsController.approve',
      'PosDraftsController.reject',
      'PosDraftsController.confirmReturn',
      'PosDraftsController.direct',
      'MobilePosOnboardingController.setup',
      'MobilePosOnboardingController.invite',
      'MobilePosOnboardingController.approve',
      'MobilePosOnboardingController.adminLink',
      'MobilePosOnboardingController.reject',
      'MobilePosOnboardingController.reset',
      'MobilePosOnboardingController.revoke',
      'MobilePosAuthController.invite',
      'MobilePosAuthController.register',
      'MobilePosAuthController.enrollment',
      'MobilePosAuthController.setup',
      'MobilePosAuthController.login',
      'MobilePosAuthController.refresh',
      'MobilePosAuthController.reset',
      'MobilePosAuthController.me',
      'MobilePosAuthController.logout',
    ],
  } as const;

  it('keeps the exact POS workflow, credentials and human decisions outside the agent envelope', () => {
    const expectedIds = Object.values(posWorkflowByReason).flat();
    const posIds = new Set<string>(expectedIds);
    expect(
      manifest
        .filter((capability) =>
          [
            'PosDraftsController',
            'MobilePosAuthController',
            'MobilePosOnboardingController',
          ].includes(capability.controller),
        )
        .map((capability) => capability.id)
        .sort(),
    ).toEqual([...expectedIds].sort());
    const reportById = new Map(
      buildCrudCoverageReport(manifest).capabilities.map((capability) => [
        capability.capabilityId,
        capability,
      ]),
    );
    for (const [reason, capabilityIds] of Object.entries(posWorkflowByReason)) {
      for (const capabilityId of capabilityIds) {
        expect(manifest.find((capability) => capability.id === capabilityId)).toMatchObject({
          agentExcluded: true,
          agentExclusionReason: reason,
        });
        expect(reportById.get(capabilityId)).toMatchObject({
          discoveryEligibility: { status: 'ineligible', reason },
          inclusion: { status: 'excluded', reason },
          testedExecution: { status: 'not_applicable', unverifiedReason: 'capability_excluded' },
        });
      }
    }
    expect(
      capabilitiesFor(manifest, everyPermission).filter((item) => posIds.has(item.id)),
    ).toEqual([]);
    expect(
      buildRegistry(manifest, everyPermission, ['green', 'amber', 'red']).filter((item) =>
        posIds.has(item.capability.id),
      ),
    ).toEqual([]);
    expect(fixtures.filter((item) => posIds.has(item.capabilityId))).toEqual([]);
  });

  it('preserves the permission gates on POS financial decisions and device administration', () => {
    const permissions = {
      'PosDraftsController.approve': 'pos_drafts.approve',
      'PosDraftsController.reject': 'pos_drafts.reject',
      'PosDraftsController.confirmReturn': 'pos_drafts.approve',
      'PosDraftsController.direct': 'pos_drafts.direct_post',
      'MobilePosOnboardingController.setup': 'mobile_pos_onboarding.manage',
      'MobilePosOnboardingController.invite': 'mobile_pos_onboarding.manage',
      'MobilePosOnboardingController.approve': 'mobile_pos_onboarding.manage',
      'MobilePosOnboardingController.adminLink': 'mobile_pos_onboarding.manage',
      'MobilePosOnboardingController.reject': 'mobile_pos_onboarding.manage',
      'MobilePosOnboardingController.reset': 'mobile_pos_onboarding.manage',
      'MobilePosOnboardingController.revoke': 'mobile_pos_onboarding.manage',
    };
    for (const [id, permission] of Object.entries(permissions)) {
      expect(manifest.find((capability) => capability.id === id)).toMatchObject({
        guard: 'permission',
        permissions: [permission],
        agentExcluded: true,
        agentExclusionReason: 'agent_excluded',
      });
    }
  });

  it('keeps the exact 21 unsafe-scope and three free-form-query reads excluded', () => {
    // 25 before the ITEMBA OS redesign (4a155f19). It moved four reads onto
    // actor company scoping (CcmNoticesController.cmaReferral / .termination,
    // LoanRepaymentSchedulesController.findOne / .getPayments); they are now
    // plain @AgentExcluded() 'agent_excluded' path-read blockers instead.
    expect(expectedByReason.company_scope_not_enforced).toHaveLength(21);
    expect(expectedByReason.query_schema_not_strict).toHaveLength(3);

    for (const [reason, expectedIds] of Object.entries(expectedByReason)) {
      const actual = manifest
        .filter((capability) => capability.agentExclusionReason === reason)
        .map((capability) => capability.id)
        .sort();
      expect(actual).toEqual([...expectedIds].sort());
      for (const capabilityId of expectedIds) {
        expect(manifest.find((capability) => capability.id === capabilityId)).toMatchObject({
          verb: 'GET',
          agentExcluded: true,
          agentExclusionReason: reason,
        });
      }
    }
  });

  it('does not expose or positively evidence either unrepresented contract', () => {
    const excludedIds = new Set(Object.values(expectedByReason).flat());
    expect(
      capabilitiesFor(manifest, everyPermission).filter((item) => excludedIds.has(item.id)),
    ).toEqual([]);
    expect(
      buildRegistry(manifest, everyPermission, ['green', 'amber', 'red']).filter((item) =>
        excludedIds.has(item.capability.id),
      ),
    ).toEqual([]);
    expect(fixtures.filter((item) => excludedIds.has(item.capabilityId))).toEqual([]);
  });

  it('reports exact exclusion reasons and partitions eligible GETs into positives or blockers', () => {
    const report = buildCrudCoverageReport(manifest);
    for (const [reason, capabilityIds] of Object.entries(expectedByReason)) {
      for (const capabilityId of capabilityIds) {
        expect(
          report.capabilities.find((item) => item.capabilityId === capabilityId),
        ).toMatchObject({
          operation: 'read',
          discoveryEligibility: { status: 'ineligible', reason },
          inclusion: { status: 'excluded', reason },
          testedExecution: {
            status: 'not_applicable',
            unverifiedReason: 'capability_excluded',
          },
        });
      }
    }

    const positiveCapabilityIds = new Set(
      fixtures
        .filter((fixture) => fixture.controlKind === 'positive')
        .map((fixture) => fixture.capabilityId),
    );
    const deterministicBlockers = metadataReadEvidenceBlockers(manifest);
    const deterministicBlockerIds = new Set(
      deterministicBlockers.map((blocker) => blocker.capabilityId),
    );
    for (const blocker of deterministicBlockers) {
      expect(
        report.capabilities.find((item) => item.capabilityId === blocker.capabilityId),
      ).toMatchObject({
        discoveryEligibility: { status: 'eligible' },
        inclusion: { status: 'excluded', reason: blocker.reason },
        testedExecution: {
          level: 'none',
          status: 'unverified',
          unverifiedReason: blocker.reason,
        },
      });
    }
    const uncoveredEligibleReads = manifest
      .filter(
        (capability) =>
          capability.verb === 'GET' &&
          !capability.agentExcluded &&
          (capability.permissions.length > 0 || capability.anyPermissions.length > 0),
      )
      .filter((capability) => !positiveCapabilityIds.has(capability.id))
      .map((capability) => capability.id)
      .sort();
    expect(uncoveredEligibleReads).toEqual([...deterministicBlockerIds].sort());
    expect(
      manifest
        .filter(
          (capability) =>
            capability.verb === 'GET' &&
            !capability.agentExcluded &&
            (capability.permissions.length > 0 || capability.anyPermissions.length > 0),
        )
        .filter(
          (capability) =>
            !positiveCapabilityIds.has(capability.id) &&
            !deterministicBlockerIds.has(capability.id),
        ),
    ).toEqual([]);
  });
});
