import { extractCapabilities } from '../../common/capabilities/capability-manifest';
import { loadAllControllers } from '../../common/capabilities/load-controllers';
import { capabilityRequiresSensitiveAccessAudit } from '../../common/policies/sensitive-access-policy';
import {
  CRUD_MUTATION_EVIDENCE_BLOCKERS,
  mutationEvidencePacksForManifest,
} from './crud-mutation-evidence-registry';

describe('sensitive mutation execution principals', () => {
  const manifest = extractCapabilities(loadAllControllers());
  const capabilityById = new Map(manifest.map((capability) => [capability.id, capability]));
  const fixtures = mutationEvidencePacksForManifest(manifest).flatMap((pack) => pack.fixtures);
  const fixtureById = new Map(fixtures.map((fixture) => [fixture.capabilityId, fixture]));
  const blockerIds = new Set(
    CRUD_MUTATION_EVIDENCE_BLOCKERS.map((blocker) => blocker.capabilityId),
  );
  const liveSensitiveMutations = manifest
    .filter(
      (capability) =>
        capability.verb !== 'GET' &&
        !capability.agentExcluded &&
        (capability.permissions.length > 0 || capability.anyPermissions.length > 0) &&
        capabilityRequiresSensitiveAccessAudit(capability),
    )
    .sort((left, right) => left.id.localeCompare(right.id));

  it('requires a GROUP principal for every included live sensitive mutation', () => {
    const expectedIncludedIds = liveSensitiveMutations
      .filter((capability) => !blockerIds.has(capability.id))
      .map((capability) => capability.id);
    const actualIncludedIds = fixtures
      .filter((fixture) => {
        const capability = capabilityById.get(fixture.capabilityId);
        return capability ? capabilityRequiresSensitiveAccessAudit(capability) : false;
      })
      .map((fixture) => fixture.capabilityId)
      .sort((left, right) => left.localeCompare(right));

    expect(expectedIncludedIds.length).toBeGreaterThan(0);
    expect(actualIncludedIds).toEqual(expectedIncludedIds);
    for (const capabilityId of expectedIncludedIds) {
      const fixture = fixtureById.get(capabilityId);
      expect(fixture).toMatchObject({
        executionPrincipal: 'group',
        audit: {
          required: true,
          scopeKind: 'COMPANY',
        },
      });
      const companyId = fixture!.audit.companyId;
      expect(
        companyId.kind === 'effect-company' ||
          (companyId.kind === 'exact' &&
            'binding' in companyId.value &&
            companyId.value.binding === 'companyA'),
      ).toBe(true);
    }
  });
});
