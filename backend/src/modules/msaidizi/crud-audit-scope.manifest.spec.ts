import { extractCapabilities } from '../../common/capabilities/capability-manifest';
import { loadAllControllers } from '../../common/capabilities/load-controllers';
import { crudEvidenceFixturesForManifest } from './crud-execution-evidence';
import {
  CRUD_MUTATION_RESOLVED_AUDIT_CAPABILITY_IDS,
  crudMutationAuditAttributionStatus,
} from './crud-mutation-audit-provenance';

describe('signed CRUD audit scope contracts', () => {
  const fixtures = crudEvidenceFixturesForManifest(extractCapabilities(loadAllControllers()));
  const governed = fixtures.filter((fixture) => 'governance' in fixture);

  it('gives every governance.audit:required route an exact immutable scope contract', () => {
    const missing: string[] = [];
    for (const fixture of governed) {
      if (fixture.governance.audit !== 'required') continue;
      const mutationAudit = (
        fixture as unknown as {
          audit?: {
            required?: boolean;
            scopeKind?: string;
            attributionStatus?: string;
            companyId?: unknown;
          };
        }
      ).audit;
      if (fixture.governance.auditScope) {
        const scope = fixture.governance.auditScope;
        const companyCount = new Set(scope.companyScopeBindings).size;
        const cardinalityIsExact =
          (scope.scopeKind === 'COMPANY' && companyCount === 1) ||
          (scope.scopeKind === 'MULTI_COMPANY' && companyCount >= 2) ||
          (!['COMPANY', 'MULTI_COMPANY'].includes(scope.scopeKind) && companyCount === 0);
        if (!cardinalityIsExact || !scope.attributionStatus) missing.push(fixture.fixtureId);
        continue;
      }
      if (
        !mutationAudit?.required ||
        !mutationAudit.scopeKind ||
        !['EXPLICIT', 'RESOLVED'].includes(mutationAudit.attributionStatus ?? '') ||
        !mutationAudit.companyId
      ) {
        missing.push(fixture.fixtureId);
      }
    }

    expect(missing).toEqual([]);
  });

  it('does not attach an audit scope to routes declared audit-not-applicable', () => {
    expect(
      governed
        .filter((fixture) => fixture.governance.audit === 'not_applicable')
        .filter((fixture) => fixture.governance.auditScope)
        .map((fixture) => fixture.fixtureId),
    ).toEqual([]);
  });

  it('pins RESOLVED provenance to the reviewed capability allowlist exactly', () => {
    const mutations = governed.filter(
      (
        fixture,
      ): fixture is (typeof governed)[number] & {
        capabilityId: string;
        audit: { attributionStatus: string };
      } => 'audit' in fixture && typeof fixture.audit === 'object' && fixture.audit !== null,
    );
    const declaredResolved = mutations
      .filter((fixture) => fixture.audit.attributionStatus === 'RESOLVED')
      .map((fixture) => fixture.capabilityId)
      .sort();
    const reviewedResolved = [...CRUD_MUTATION_RESOLVED_AUDIT_CAPABILITY_IDS].sort();

    expect(new Set(reviewedResolved).size).toBe(reviewedResolved.length);
    expect(declaredResolved).toEqual(reviewedResolved);
    expect(
      mutations.filter(
        (fixture) =>
          fixture.audit.attributionStatus !==
          crudMutationAuditAttributionStatus(fixture.capabilityId),
      ),
    ).toEqual([]);
  });
});
