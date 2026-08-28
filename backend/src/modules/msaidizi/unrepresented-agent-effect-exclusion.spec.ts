import {
  capabilitiesFor,
  extractCapabilities,
} from '../../common/capabilities/capability-manifest';
import { loadAllControllers } from '../../common/capabilities/load-controllers';
import { buildCrudCoverageReport } from './crud-coverage.service';
import { crudEvidenceFixturesForManifest } from './crud-execution-evidence';
import { buildRegistry } from './tool-registry';

const EXPECTED_BY_REASON = new Map<string, readonly string[]>([
  [
    'asynchronous_effect_not_represented',
    ['BackupRunsController.create', 'BackupRunsController.trigger', 'DataExportsController.create'],
  ],
  [
    'external_egress_not_represented',
    [
      'CustomerStatementsController.emailToCustomer',
      'IntegrationConnectionsController.test',
      'SupplierOrderDraftsController.emailPdf',
    ],
  ],
  ['filesystem_materialization_not_represented', ['GeneratedDocumentsController.generatePdf']],
  ['recent_human_auth_required', ['AuthController.reencryptLegacyTotp']],
]);

describe('unrepresented governed-effect policy', () => {
  const manifest = extractCapabilities(loadAllControllers());
  const everyPermission = [
    ...new Set(
      manifest.flatMap((capability) => [...capability.permissions, ...capability.anyPermissions]),
    ),
  ];
  const excludedIds = [...EXPECTED_BY_REASON.values()].flat();

  it.each([...EXPECTED_BY_REASON.entries()])(
    'keeps the exact %s inventory method-excluded',
    (reason, expectedIds) => {
      const actual = manifest
        .filter((capability) => capability.agentExclusionReason === reason)
        .map((capability) => capability.id)
        .sort();
      expect(actual).toEqual([...expectedIds].sort());
      for (const capabilityId of expectedIds) {
        expect(manifest.find((capability) => capability.id === capabilityId)).toMatchObject({
          agentExcluded: true,
          agentExclusionReason: reason,
        });
      }
    },
  );

  it('preserves the human routes but excludes them from discovery, tools, and positive fixtures', () => {
    for (const capabilityId of excludedIds) {
      const capability = manifest.find((candidate) => candidate.id === capabilityId);
      expect(capability).toBeDefined();
      expect(
        (capability?.permissions.length ?? 0) + (capability?.anyPermissions.length ?? 0),
      ).toBeGreaterThan(0);
      expect(['permission', 'permission-any']).toContain(capability?.guard);
    }
    expect(
      capabilitiesFor(manifest, everyPermission).filter((item) => excludedIds.includes(item.id)),
    ).toEqual([]);
    expect(
      buildRegistry(manifest, everyPermission, ['green', 'amber', 'red']).filter((item) =>
        excludedIds.includes(item.capability.id),
      ),
    ).toEqual([]);
    expect(
      crudEvidenceFixturesForManifest(manifest).filter((item) =>
        excludedIds.includes(item.capabilityId),
      ),
    ).toEqual([]);
  });

  it('reports each exact machine-readable reason without claiming execution evidence', () => {
    const report = buildCrudCoverageReport(manifest);
    for (const [reason, capabilityIds] of EXPECTED_BY_REASON) {
      for (const capabilityId of capabilityIds) {
        expect(
          report.capabilities.find((item) => item.capabilityId === capabilityId),
        ).toMatchObject({
          discoveryEligibility: { status: 'ineligible', reason },
          inclusion: { status: 'excluded', reason },
          testedExecution: {
            status: 'not_applicable',
            unverifiedReason: 'capability_excluded',
          },
        });
      }
    }
  });
});
