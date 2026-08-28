import {
  capabilitiesFor,
  extractCapabilities,
} from '../../common/capabilities/capability-manifest';
import { loadAllControllers } from '../../common/capabilities/load-controllers';
import { buildCrudCoverageReport } from './crud-coverage.service';
import { crudEvidenceFixturesForManifest } from './crud-execution-evidence';
import { buildRegistry } from './tool-registry';

const BINARY_RESULT_CAPABILITY_IDS = [
  'CustomerStatementsController.exportExcel',
  'CustomerStatementsController.exportPdf',
  'PrintEngineController.renderExcel',
  'PrintEngineController.renderPdf',
  'ProductsController.getImage',
] as const;

const MULTIPART_CAPABILITY_IDS = [
  'DocumentsController.upload',
  'ProductsController.uploadImage',
] as const;

describe('unrepresented HTTP transport policy', () => {
  const manifest = extractCapabilities(loadAllControllers());
  const everyPermission = [
    ...new Set(
      manifest.flatMap((capability) => [...capability.permissions, ...capability.anyPermissions]),
    ),
  ];

  it.each([
    ['binary_result_not_represented', BINARY_RESULT_CAPABILITY_IDS],
    ['multipart_transport_not_represented', MULTIPART_CAPABILITY_IDS],
  ] as const)('keeps the exact %s inventory method-excluded', (reason, expectedIds) => {
    const excluded = manifest
      .filter((capability) => capability.agentExclusionReason === reason)
      .map((capability) => capability.id)
      .sort();

    expect(excluded).toEqual(expectedIds);
    for (const capabilityId of expectedIds) {
      expect(manifest.find((capability) => capability.id === capabilityId)).toMatchObject({
        agentExcluded: true,
        agentExclusionReason: reason,
      });
    }
  });

  it('cannot expose or positively evidence either unsupported transport', () => {
    const unsupported = [...BINARY_RESULT_CAPABILITY_IDS, ...MULTIPART_CAPABILITY_IDS];
    const isUnsupported = (capabilityId: string) =>
      unsupported.includes(capabilityId as (typeof unsupported)[number]);

    expect(
      capabilitiesFor(manifest, everyPermission).filter((item) => isUnsupported(item.id)),
    ).toEqual([]);
    expect(
      buildRegistry(manifest, everyPermission, ['green', 'amber', 'red']).filter((item) =>
        isUnsupported(item.capability.id),
      ),
    ).toEqual([]);
    expect(
      crudEvidenceFixturesForManifest(manifest).filter((item) => isUnsupported(item.capabilityId)),
    ).toEqual([]);
  });

  it('reports exact transport reasons with their HTTP-effect operation', () => {
    const report = buildCrudCoverageReport(manifest);
    const expected = new Map<string, { reason: string; operation: string }>([
      [
        'CustomerStatementsController.exportExcel',
        { reason: 'binary_result_not_represented', operation: 'action' },
      ],
      [
        'CustomerStatementsController.exportPdf',
        { reason: 'binary_result_not_represented', operation: 'action' },
      ],
      [
        'PrintEngineController.renderExcel',
        { reason: 'binary_result_not_represented', operation: 'action' },
      ],
      [
        'PrintEngineController.renderPdf',
        { reason: 'binary_result_not_represented', operation: 'action' },
      ],
      [
        'ProductsController.getImage',
        { reason: 'binary_result_not_represented', operation: 'read' },
      ],
      [
        'DocumentsController.upload',
        { reason: 'multipart_transport_not_represented', operation: 'create' },
      ],
      [
        'ProductsController.uploadImage',
        { reason: 'multipart_transport_not_represented', operation: 'create' },
      ],
    ]);

    for (const [capabilityId, contract] of expected) {
      expect(report.capabilities.find((item) => item.capabilityId === capabilityId)).toMatchObject({
        operation: contract.operation,
        discoveryEligibility: { status: 'ineligible', reason: contract.reason },
        inclusion: { status: 'excluded', reason: contract.reason },
        testedExecution: {
          status: 'not_applicable',
          unverifiedReason: 'capability_excluded',
        },
      });
    }
  });
});
