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

  it('keeps the exact 25 unsafe-scope and three free-form-query reads excluded', () => {
    expect(expectedByReason.company_scope_not_enforced).toHaveLength(25);
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
