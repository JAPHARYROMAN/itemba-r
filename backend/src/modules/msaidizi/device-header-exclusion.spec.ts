import {
  capabilitiesFor,
  extractCapabilities,
} from '../../common/capabilities/capability-manifest';
import { loadAllControllers } from '../../common/capabilities/load-controllers';
import { buildCrudCoverageReport } from './crud-coverage.service';
import { crudEvidenceFixturesForManifest } from './crud-execution-evidence';
import { buildRegistry } from './tool-registry';

const DEVICE_HEADER_BOUND_CAPABILITY_IDS = [
  'MobilePosLiteController.catalog',
  'MobilePosLiteController.createDayReport',
  'MobilePosLiteController.createPurchase',
  'MobilePosLiteController.createStockCount',
  'MobilePosLiteController.customers',
  'MobilePosLiteController.dayReportPdf',
  'MobilePosLiteController.mySalesToday',
  'MobilePosLiteController.products',
  'MobilePosLiteController.purchaseHistory',
  'MobilePosLiteController.saleReceipt',
  'MobilePosLiteController.salesHistory',
  'MobilePosLiteController.session',
  'MobilePosLiteController.stock',
  'MobilePosLiteController.suppliers',
] as const;

describe('unrepresented terminal/device credential policy', () => {
  const manifest = extractCapabilities(loadAllControllers());

  it('keeps the complete currently agent-relevant header-bound inventory excluded', () => {
    const excluded = manifest
      .filter((capability) => capability.agentExclusionReason === 'device_headers_not_represented')
      .map((capability) => capability.id)
      .sort();

    expect(excluded).toEqual(DEVICE_HEADER_BOUND_CAPABILITY_IDS);
    for (const capabilityId of DEVICE_HEADER_BOUND_CAPABILITY_IDS) {
      const capability = manifest.find((entry) => entry.id === capabilityId);
      expect(capability).toMatchObject({
        agentExcluded: true,
        agentExclusionReason: 'device_headers_not_represented',
      });
      expect(capability?.params.headers).toEqual(['x-mobile-pos-device', 'x-mobile-pos-terminal']);
    }
  });

  it('cannot expose or positively evidence a fixture-only credential path', () => {
    const everyPermission = [
      ...new Set(
        manifest.flatMap((capability) => [...capability.permissions, ...capability.anyPermissions]),
      ),
    ];

    expect(
      capabilitiesFor(manifest, everyPermission).filter((capability) =>
        DEVICE_HEADER_BOUND_CAPABILITY_IDS.includes(
          capability.id as (typeof DEVICE_HEADER_BOUND_CAPABILITY_IDS)[number],
        ),
      ),
    ).toEqual([]);
    expect(
      buildRegistry(manifest, everyPermission, ['green', 'amber', 'red']).filter((entry) =>
        DEVICE_HEADER_BOUND_CAPABILITY_IDS.includes(
          entry.capability.id as (typeof DEVICE_HEADER_BOUND_CAPABILITY_IDS)[number],
        ),
      ),
    ).toEqual([]);
    expect(
      crudEvidenceFixturesForManifest(manifest).filter((fixture) =>
        DEVICE_HEADER_BOUND_CAPABILITY_IDS.includes(
          fixture.capabilityId as (typeof DEVICE_HEADER_BOUND_CAPABILITY_IDS)[number],
        ),
      ),
    ).toEqual([]);
  });

  it('reports the exact exclusion reason and honest HTTP-effect operation', () => {
    const report = buildCrudCoverageReport(manifest);
    for (const capabilityId of DEVICE_HEADER_BOUND_CAPABILITY_IDS) {
      const entry = report.capabilities.find((item) => item.capabilityId === capabilityId);
      expect(entry).toMatchObject({
        operation: capabilityId.includes('.create') ? 'create' : 'read',
        discoveryEligibility: {
          status: 'ineligible',
          reason: 'device_headers_not_represented',
        },
        inclusion: { status: 'excluded', reason: 'device_headers_not_represented' },
        testedExecution: {
          status: 'not_applicable',
          unverifiedReason: 'capability_excluded',
        },
      });
    }
  });
});
