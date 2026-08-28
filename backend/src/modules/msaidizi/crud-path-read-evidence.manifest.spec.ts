import { Prisma } from '@prisma/client';
import { extractCapabilities } from '../../common/capabilities/capability-manifest';
import { loadAllControllers } from '../../common/capabilities/load-controllers';
import { CRUD_EVIDENCE_FIXTURES, exactRecordReadEvidenceFixtures } from './crud-execution-evidence';
import {
  CRUD_PATH_READ_REMAINING_BLOCKERS,
  pathRecordReadEvidencePacks,
} from './crud-path-read-evidence';

describe('CRUD path-record evidence against the live capability manifest', () => {
  const manifest = extractCapabilities(loadAllControllers());

  it('registers all 144 eligible pending path reads and records 53 policy exclusions', () => {
    const pathReads = manifest.filter(
      (capability) =>
        capability.verb === 'GET' &&
        !capability.agentExcluded &&
        (capability.permissions.length > 0 || capability.anyPermissions.length > 0) &&
        capability.params.path.length > 0,
    );
    const priorPathEvidence = new Set([
      ...CRUD_EVIDENCE_FIXTURES.filter((fixture) => fixture.controlKind === 'positive').map(
        (fixture) => fixture.capabilityId,
      ),
      ...exactRecordReadEvidenceFixtures(manifest).map((fixture) => fixture.capabilityId),
    ]);
    const tranche = pathReads
      .map((capability) => capability.id)
      .filter((capabilityId) => !priorPathEvidence.has(capabilityId))
      .sort();
    const packs = pathRecordReadEvidencePacks(manifest);
    const registered = packs.flatMap((pack) =>
      pack.fixtures.map((fixture) => fixture.capabilityId),
    );
    const eligibleBlocked = CRUD_PATH_READ_REMAINING_BLOCKERS.filter(
      (blocker) =>
        !manifest.find((capability) => capability.id === blocker.capabilityId)?.agentExcluded,
    ).map((blocker) => blocker.capabilityId);
    const policyExcluded = CRUD_PATH_READ_REMAINING_BLOCKERS.filter(
      (blocker) =>
        manifest.find((capability) => capability.id === blocker.capabilityId)?.agentExcluded,
    );

    expect(tranche).toHaveLength(144);
    expect(registered).toHaveLength(144);
    expect(eligibleBlocked).toHaveLength(0);
    expect(policyExcluded).toHaveLength(53);
    expect(new Set(registered).size).toBe(registered.length);
    expect(new Set(eligibleBlocked).size).toBe(eligibleBlocked.length);
    expect(new Set(policyExcluded.map((blocker) => blocker.capabilityId)).size).toBe(
      policyExcluded.length,
    );
    expect(registered.filter((capabilityId) => eligibleBlocked.includes(capabilityId))).toEqual([]);
    expect([...registered, ...eligibleBlocked].sort()).toEqual(tranche);
    for (const blocker of policyExcluded) {
      expect(manifest.find((capability) => capability.id === blocker.capabilityId)).toMatchObject({
        agentExcluded: true,
        agentExclusionReason: blocker.reason,
      });
    }
    expect(packs.map((pack) => [pack.packId, pack.fixtures.length])).toEqual([
      ['path-record-platform', 34],
      ['path-record-governance', 11],
      ['path-record-finance', 22],
      ['path-record-operations', 19],
      ['path-record-hr', 17],
      ['path-record-derived', 41],
    ]);
  });

  it('references only real generated Prisma models for isolated seeds', () => {
    const prismaModels = new Set(Prisma.dmmf.datamodel.models.map((model) => model.name));
    const seedModels = pathRecordReadEvidencePacks(manifest)
      .flatMap((pack) => pack.fixtures)
      .flatMap((fixture) => (fixture.seedModel ? [fixture.seedModel] : []));

    expect([...new Set(seedModels)].filter((model) => !prismaModels.has(model))).toEqual([]);
  });
});
