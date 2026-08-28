import { extractCapabilities } from '../../common/capabilities/capability-manifest';
import { loadAllControllers } from '../../common/capabilities/load-controllers';
import { ALL_PERMISSIONS, ROLES } from '../../../../database/seeds/permission-matrix';
import {
  CRUD_REMAINING_READ_REVIEWED_DEFINITION_COUNT,
  remainingReadEvidencePack,
} from './crud-remaining-read-evidence';

const REVIEWED = Object.freeze([
  'BackupsController.dashboard',
  'CacheManagementController.getStats',
  'DataIsolationController.getDashboard',
  'DebtsController.getSummary',
  'DepartmentsController.nextCode',
  'EmployeesController.nextCode',
  'IntercompanyTransactionsController.findAll',
  'MobilePosLiteController.dayReports',
  'NotificationsController.getUnreadCount',
  'PositionsController.nextCode',
  'RecordBookController.summary',
  'ReturnablePackagesController.getBalances',
  'SecurityController.dashboard',
  'SecurityController.readiness',
  'SecurityController.summary',
]);

describe('manifest-bound remaining deterministic read evidence', () => {
  const manifest = extractCapabilities(loadAllControllers());
  const byId = new Map(manifest.map((capability) => [capability.id, capability]));
  const pack = remainingReadEvidencePack(manifest);

  it('registers exactly the reviewed 15 read controls', () => {
    expect(CRUD_REMAINING_READ_REVIEWED_DEFINITION_COUNT).toBe(15);
    expect(pack).toMatchObject({ packId: 'remaining-deterministic-reads', packVersion: 1 });
    expect(pack.fixtures).toHaveLength(15);
    expect(pack.fixtures.map((fixture) => fixture.capabilityId).sort()).toEqual(
      [...REVIEWED].sort(),
    );
    expect(new Set(pack.fixtures.map((fixture) => fixture.fixtureId))).toHaveProperty('size', 15);
  });

  it('binds every fixture to a live permission-governed GET with a closed query surface', () => {
    for (const fixture of pack.fixtures) {
      const capability = byId.get(fixture.capabilityId);
      expect(capability).toBeDefined();
      expect(capability?.agentExcluded).toBe(false);
      expect(capability?.verb).toBe('GET');
      expect(capability?.path).toBe(fixture.expectedPath);
      expect(capability?.params.path).toEqual([]);
      expect(
        [...(capability?.permissions ?? []), ...(capability?.anyPermissions ?? [])].length,
      ).toBeGreaterThan(0);
      const querySchema = capability?.params.querySchema;
      const actualQuery = querySchema
        ? Object.keys(querySchema.schema.properties)
        : (capability?.params.query ?? []);
      expect(actualQuery.sort()).toEqual([...fixture.expectedQueryParameters].sort());
      if (querySchema) {
        expect(querySchema.quality).toBe('strict');
        expect(querySchema.schema.additionalProperties).toBe(false);
      } else {
        expect(capability?.params.freeFormQuery).toBe(false);
      }
      expect(new Set(fixture.queryBindings.map((item) => item.name))).toHaveProperty(
        'size',
        fixture.queryBindings.length,
      );
    }
  });

  it('requires causal values or identities plus permission and scope controls', () => {
    for (const fixture of pack.fixtures) {
      expect(
        fixture.oracle.values.length + fixture.oracle.markers.length + fixture.oracle.rows.length,
      ).toBeGreaterThan(0);
      expect(fixture.oracle.permissionProbe).toEqual({
        principal: 'restricted',
        expectedStatus: 403,
      });
    }

    const scoped = pack.fixtures.filter((fixture) => fixture.governance.scope !== 'global');
    expect(scoped).toHaveLength(9);
    expect(scoped.every((fixture) => fixture.oracle.scopeProbe !== undefined)).toBe(true);
    expect(
      pack.fixtures.find((fixture) => fixture.capabilityId === 'DebtsController.getSummary'),
    ).toMatchObject({
      governance: {
        scope: 'company',
        audit: 'required',
        auditScope: {
          scopeKind: 'COMPANY',
          attributionStatus: 'EXPLICIT',
          companyScopeBindings: ['companyA'],
        },
      },
      executionPrincipal: 'group_company_a',
      oracle: {
        scopeProbe: {
          kind: 'group_principal_value',
          auditScope: {
            scopeKind: 'MULTI_COMPANY',
            attributionStatus: 'EXPLICIT',
            companyScopeBindings: ['companyA', 'companyB', 'adminOperationsCompany'],
          },
        },
      },
    });

    for (const capabilityId of [
      'BackupsController.dashboard',
      'CacheManagementController.getStats',
      'SecurityController.dashboard',
      'SecurityController.readiness',
      'SecurityController.summary',
    ]) {
      expect(pack.fixtures.find((fixture) => fixture.capabilityId === capabilityId)).toMatchObject({
        governance: { scope: 'global' },
        executionPrincipal: 'group',
        oracle: {
          scopeProbe: { kind: 'company_principal_denied_group_read', expectedStatus: 403 },
        },
      });
    }
  });

  it('uses group-controlled permissions without widening cache mutation permissions', () => {
    const permissions = new Map(ALL_PERMISSIONS.map((permission) => [permission.code, permission]));
    expect(permissions.get('security.dashboard.view')?.isGroupControl).toBe(true);
    expect(permissions.get('backups.dashboard.view')?.isGroupControl).toBe(true);
    expect(permissions.get('cache.stats.view')).toMatchObject({
      module: 'cache',
      action: 'stats.view',
      isGroupControl: true,
    });
    for (const code of ['cache.view', 'cache.manage', 'cache.invalidate']) {
      expect(permissions.get(code)?.isGroupControl).toBe(false);
    }
    const companyManager = ROLES.find((role) => role.name === 'COMPANY_MANAGER')!;
    for (const code of ['cache.view', 'cache.manage', 'cache.invalidate']) {
      expect(companyManager.filter(permissions.get(code)!)).toBe(true);
    }
    for (const code of ['security.dashboard.view', 'backups.dashboard.view', 'cache.stats.view']) {
      const permission = permissions.get(code)!;
      const seededHolders = ROLES.filter((role) => role.filter(permission));
      expect(seededHolders.length).toBeGreaterThan(0);
      expect(seededHolders.every((role) => role.scope === 'GROUP')).toBe(true);
    }

    expect(byId.get('SecurityController.dashboard')?.permissions).toEqual([
      'security.dashboard.view',
    ]);
    expect(byId.get('SecurityController.readiness')?.permissions).toEqual([
      'security.dashboard.view',
    ]);
    expect(byId.get('SecurityController.summary')?.permissions).toEqual([
      'security.dashboard.view',
    ]);
    expect(byId.get('BackupsController.dashboard')?.permissions).toEqual([
      'backups.dashboard.view',
    ]);
    expect(byId.get('CacheManagementController.getStats')?.permissions).toEqual([
      'cache.stats.view',
    ]);
  });

  it('fails closed when the reviewed route or query contract drifts', () => {
    const target = byId.get('RecordBookController.summary');
    expect(target).toBeDefined();
    const drifted = manifest.map((capability) =>
      capability.id === target?.id
        ? { ...capability, path: 'record-book/drifted-summary' }
        : capability,
    );
    expect(
      remainingReadEvidencePack(drifted).fixtures.some(
        (fixture) => fixture.capabilityId === target?.id,
      ),
    ).toBe(false);
  });
});
