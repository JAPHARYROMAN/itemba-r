import { extractCapabilities } from '../../common/capabilities/capability-manifest';
import { loadAllControllers } from '../../common/capabilities/load-controllers';
import { buildCrudCoverageReport } from './crud-coverage.service';
import {
  CRUD_MUTATION_EVIDENCE_BLOCKERS,
  mutationEvidencePacksForManifest,
} from './crud-mutation-evidence-registry';
import { validateCrudMutationFixtureContract } from './crud-mutation-evidence';
import {
  CRUD_USER_DASHBOARD_ACTION_CLOSED_IDS,
  CRUD_USER_DASHBOARD_ACTION_EVIDENCE_PACK,
} from './crud-user-dashboard-action-evidence';

describe('user dashboard upsert mutation evidence', () => {
  const manifest = extractCapabilities(loadAllControllers());
  const byId = new Map(manifest.map((capability) => [capability.id, capability]));
  const fixtures = CRUD_USER_DASHBOARD_ACTION_EVIDENCE_PACK.fixtures;

  it('registers the two strict live upsert envelopes without broad arguments', () => {
    expect(CRUD_USER_DASHBOARD_ACTION_CLOSED_IDS).toEqual([
      'UserDashboardPreferencesController.upsertCreate',
      'UserDashboardPreferencesController.upsertUpdate',
    ]);
    expect(fixtures).toHaveLength(2);
    for (const fixture of fixtures) {
      const capability = byId.get(fixture.capabilityId);
      expect(capability).toBeDefined();
      expect(capability?.params.bodySchema?.quality).toBe('strict');
      expect(capability?.params.bodySchema?.schema.additionalProperties).toBe(false);
      expect(Object.keys(fixture.request.path ?? {})).toEqual(['dashboardId']);
      expect(Object.keys(fixture.request.query ?? {})).toEqual([]);
      expect(Object.keys(fixture.request.body ?? {}).sort()).toEqual([
        'filters',
        'isDefault',
        'layoutOverride',
      ]);
      expect(validateCrudMutationFixtureContract(fixture)).toEqual([]);
    }

    const coverageOperations = new Map(
      buildCrudCoverageReport(manifest).capabilities.map((entry) => [
        entry.capabilityId,
        entry.operation,
      ]),
    );
    expect(fixtures.map((fixture) => [fixture.capabilityId, fixture.operation])).toEqual(
      fixtures.map((fixture) => [
        fixture.capabilityId,
        coverageOperations.get(fixture.capabilityId),
      ]),
    );
  });

  it('pins create/update branch identity, exact JSON closure, recovery, and global audit scope', () => {
    const create = fixtures.find((fixture) => fixture.capabilityId.endsWith('upsertCreate'));
    const update = fixtures.find((fixture) => fixture.capabilityId.endsWith('upsertUpdate'));

    expect(create).toMatchObject({
      operation: 'action',
      executionPrincipal: 'poster',
      request: {
        path: { dashboardId: { binding: 'userDashboardCreateDefinition' } },
      },
      effect: {
        kind: 'create',
        model: 'UserDashboardPreference',
        responseIdPath: ['id'],
        expectedFields: {
          dashboardDefinitionId: { binding: 'userDashboardCreateDefinition' },
        },
      },
      audit: {
        action: 'UPSERT',
        entityType: 'UserDashboardPreference',
        companyId: { kind: 'exact', value: { literal: null } },
        scopeKind: 'GLOBAL',
      },
    });
    expect(update).toMatchObject({
      operation: 'action',
      target: { model: 'UserDashboardPreference' },
      preState: {
        model: 'UserDashboardPreference',
        fields: {
          filters: { object: { evidence: { literal: 'dashboard-before-update' } } },
          layoutOverride: {
            object: { columns: { literal: 1 }, compact: { literal: false } },
          },
        },
      },
      effect: {
        kind: 'update',
        model: 'UserDashboardPreference',
        allowedFields: ['updatedAt'],
      },
      audit: {
        action: 'UPSERT',
        entityType: 'UserDashboardPreference',
        companyId: { kind: 'exact', value: { literal: null } },
        scopeKind: 'GLOBAL',
      },
    });
  });

  it('survives aggregate manifest binding and removes only its reviewed blockers', () => {
    const aggregatePack = mutationEvidencePacksForManifest(manifest).find(
      (pack) => pack.packId === CRUD_USER_DASHBOARD_ACTION_EVIDENCE_PACK.packId,
    );
    expect(aggregatePack?.fixtures.map((fixture) => fixture.capabilityId)).toEqual(
      CRUD_USER_DASHBOARD_ACTION_CLOSED_IDS,
    );
    const blockerIds = new Set(
      CRUD_MUTATION_EVIDENCE_BLOCKERS.map((blocker) => blocker.capabilityId),
    );
    expect(CRUD_USER_DASHBOARD_ACTION_CLOSED_IDS.filter((id) => blockerIds.has(id))).toEqual([]);
  });
});
