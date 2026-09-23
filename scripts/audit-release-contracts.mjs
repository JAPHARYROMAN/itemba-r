import { createRequire } from 'node:module';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// Read-only diagnosis of the same manifest/fixture boundary enforced by backend CI.
// This does not execute a capability, grant access, change exclusions or sign evidence.
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(resolve(root, 'backend/package.json'));
require('reflect-metadata');
require('ts-node').register({
  transpileOnly: true,
  project: resolve(root, 'backend/tsconfig.json'),
});
const source = (name) => require(resolve(root, `backend/src/${name}`));
const { extractCapabilities } = source('common/capabilities/capability-manifest.ts');
const { loadAllControllers } = source('common/capabilities/load-controllers.ts');
const { buildCrudCoverageReport } = source('modules/msaidizi/crud-coverage.service.ts');
const { crudEvidenceFixturesForManifest, manifestContractDigest } = source(
  'modules/msaidizi/crud-execution-evidence.ts',
);
const { CRUD_MUTATION_AM_EVIDENCE_PACKS } = source('modules/msaidizi/crud-mutation-am-evidence.ts');
const { CRUD_MUTATION_NS_EVIDENCE_PACKS } = source('modules/msaidizi/crud-mutation-ns-evidence.ts');
const { CRUD_FINANCIAL_ACTION_POSITIVE_EVIDENCE_PACK } = source(
  'modules/msaidizi/crud-financial-action-positive-evidence.ts',
);
const { CRUD_MUTATION_AUTONOMY_RELEASE_EVIDENCE_PACK } = source(
  'modules/msaidizi/crud-mutation-autonomy-release-evidence.ts',
);

const manifest = extractCapabilities(loadAllControllers());
const byId = new Map(manifest.map((capability) => [capability.id, capability]));
const coverage = buildCrudCoverageReport(manifest);
const fixtures = crudEvidenceFixturesForManifest(manifest);
const registered = new Set(
  fixtures
    .filter((fixture) => fixture.controlKind === 'positive')
    .map((fixture) => fixture.capabilityId),
);
const eligible = new Set(
  coverage.capabilities
    .filter((entry) => entry.discoveryEligibility.status === 'eligible')
    .map((entry) => entry.capabilityId),
);
const missingPositiveFixtures = [...eligible].filter((id) => !registered.has(id)).sort();
const ineligiblePositiveFixtures = [...registered].filter((id) => !eligible.has(id)).sort();
const packs = [
  ...CRUD_MUTATION_AM_EVIDENCE_PACKS,
  ...CRUD_MUTATION_NS_EVIDENCE_PACKS,
  CRUD_FINANCIAL_ACTION_POSITIVE_EVIDENCE_PACK,
  CRUD_MUTATION_AUTONOMY_RELEASE_EVIDENCE_PACK,
];
const requestMismatches = [];
for (const fixture of packs.flatMap((pack) => pack.fixtures)) {
  const capability = byId.get(fixture.capabilityId);
  if (!capability?.params.hasBody) continue;
  const schema = capability.params.bodySchema;
  const bodyKeys = Object.keys(fixture.request.body ?? {});
  const missingRequiredFields = (schema?.schema.required ?? []).filter(
    (name) => !bodyKeys.includes(name),
  );
  const unknownFields = bodyKeys.filter((name) => !schema?.schema.properties[name]);
  if (schema?.quality !== 'strict' || missingRequiredFields.length || unknownFields.length) {
    requestMismatches.push({
      capabilityId: capability.id,
      fixtureId: fixture.fixtureId,
      dto: schema?.dtoName,
      schemaQuality: schema?.quality ?? 'missing',
      missingRequiredFields,
      unknownFields,
    });
  }
}
const needsReview =
  missingPositiveFixtures.length > 0 ||
  ineligiblePositiveFixtures.length > 0 ||
  requestMismatches.length > 0;
const result = {
  createdAt: new Date().toISOString(),
  status: needsReview ? 'needs-review' : 'contracts-consistent',
  manifestDigest: manifestContractDigest(manifest),
  manifestCount: manifest.length,
  eligibleCount: eligible.size,
  registeredPositiveCount: registered.size,
  missingPositiveFixtures,
  ineligiblePositiveFixtures,
  requestMismatches,
  limits:
    'Structural audit only. This does not replace backend tests, signed execution evidence, staging acceptance or approval to deploy.',
};
const output = resolve(root, '.release/os-design');
mkdirSync(output, { recursive: true });
writeFileSync(
  resolve(output, 'acceptance-contract-audit.json'),
  JSON.stringify(result, null, 2) + '\n',
);
console.log(
  `Manifest: ${manifest.length} capabilities; ${missingPositiveFixtures.length} eligible operations missing positive fixtures; ${ineligiblePositiveFixtures.length} positive fixtures no longer eligible; ${requestMismatches.length} request contracts need review.`,
);
console.log('Read-only diagnostic: .release/os-design/acceptance-contract-audit.json');
if (needsReview) process.exitCode = 1;
