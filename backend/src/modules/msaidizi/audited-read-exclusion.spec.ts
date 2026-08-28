import {
  capabilitiesFor,
  extractCapabilities,
} from '../../common/capabilities/capability-manifest';
import { loadAllControllers } from '../../common/capabilities/load-controllers';
import { buildCrudCoverageReport } from './crud-coverage.service';
import { CRUD_QUERY_READ_REMAINING_BLOCKERS } from './crud-execution-evidence';
import { CRUD_PATH_READ_REMAINING_BLOCKERS } from './crud-path-read-evidence';
import { buildRegistry } from './tool-registry';

describe('persistent-write GET policy', () => {
  const manifest = extractCapabilities(loadAllControllers());
  const expectedAuditedReads = [
    ...CRUD_PATH_READ_REMAINING_BLOCKERS.filter(
      (blocker) => blocker.reason === 'read_writes_audit_ledger',
    ).map((blocker) => blocker.capabilityId),
    ...CRUD_QUERY_READ_REMAINING_BLOCKERS.filter(
      (blocker) => blocker.reason === 'read_writes_audit_ledger',
    ).map((blocker) => blocker.capabilityId),
    'CustomersController.findOne',
    'OperationsReportsController.getSupplier360',
    'OperationsReportsController.exportSupplier360',
  ].sort();

  it('keeps the complete source-confirmed audited GET inventory method-excluded', () => {
    expect(new Set(expectedAuditedReads).size).toBe(expectedAuditedReads.length);
    const excluded = manifest
      .filter((capability) => capability.agentExclusionReason === 'read_writes_audit_ledger')
      .map((capability) => capability.id)
      .sort();

    expect(excluded).toEqual(expectedAuditedReads);
    for (const capabilityId of expectedAuditedReads) {
      const capability = manifest.find((entry) => entry.id === capabilityId);
      expect(capability).toMatchObject({
        verb: 'GET',
        agentExcluded: true,
        agentExclusionReason: 'read_writes_audit_ledger',
      });
    }
  });

  it('does not expose audited reads through capabilitiesFor or the tool registry', () => {
    const everyPermission = [
      ...new Set(
        manifest.flatMap((capability) => [...capability.permissions, ...capability.anyPermissions]),
      ),
    ];
    const allowed = capabilitiesFor(manifest, everyPermission);
    const registry = buildRegistry(manifest, everyPermission, ['green', 'amber', 'red']);

    expect(allowed.filter((capability) => expectedAuditedReads.includes(capability.id))).toEqual(
      [],
    );
    expect(registry.filter((entry) => expectedAuditedReads.includes(entry.capability.id))).toEqual(
      [],
    );
  });

  it('reports the exact exclusion reason and classifies the persistent effect as an action', () => {
    const report = buildCrudCoverageReport(manifest);
    for (const capabilityId of expectedAuditedReads) {
      const entry = report.capabilities.find((item) => item.capabilityId === capabilityId);
      expect(entry).toMatchObject({
        operation: 'action',
        discoveryEligibility: {
          status: 'ineligible',
          reason: 'read_writes_audit_ledger',
        },
        inclusion: { status: 'excluded', reason: 'read_writes_audit_ledger' },
        testedExecution: {
          status: 'not_applicable',
          unverifiedReason: 'capability_excluded',
        },
      });
    }
  });
});
