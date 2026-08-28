import { extractCapabilities } from '../../common/capabilities/capability-manifest';
import { loadAllControllers } from '../../common/capabilities/load-controllers';
import {
  CRUD_GLOBAL_ADMIN_READ_REVIEWED_DEFINITION_COUNT,
  globalAdminReadEvidencePack,
} from './crud-global-admin-read-evidence';

const GLOBAL_ADMIN_READS = Object.freeze([
  'AuditLogsController.getEntityTypes',
  'BackupJobsController.findAll',
  'BackupRunsController.findAll',
  'DataIsolationIssuesController.findAll',
  'DataIsolationTestsController.findAll',
  'IntegrationProvidersController.findAll',
  'JobQueueConfigsController.findAll',
  'PermissionsController.findAll',
  'RolesController.findAll',
  'TaxAuthoritiesController.findAll',
  'TaxTypesController.findAll',
  'UserSecurityProfilesController.findAll',
]);

describe('manifest-bound global and administrative read evidence', () => {
  const manifest = extractCapabilities(loadAllControllers());
  const byId = new Map(manifest.map((capability) => [capability.id, capability]));
  const pack = globalAdminReadEvidencePack(manifest);

  it('registers exactly the 12 reviewed deterministic administrative reads', () => {
    expect(CRUD_GLOBAL_ADMIN_READ_REVIEWED_DEFINITION_COUNT).toBe(12);
    expect(pack.packId).toBe('global-admin-deterministic-reads');
    expect(pack.fixtures).toHaveLength(12);
    expect(new Set(pack.fixtures.map((fixture) => fixture.fixtureId))).toHaveProperty('size', 12);
    expect(pack.fixtures.map((fixture) => fixture.capabilityId)).toEqual(GLOBAL_ADMIN_READS);
  });

  it('binds every fixture to the exact live permission-governed GET contract', () => {
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

      if (fixture.expectedQueryParameters.length === 0) {
        expect(capability?.params.query).toEqual([]);
        expect(capability?.params.freeFormQuery).toBe(false);
        expect(capability?.params.querySchema).toBeUndefined();
      } else if (capability?.params.querySchema) {
        expect(capability.params.querySchema.quality).toBe('strict');
        expect(capability.params.querySchema.schema.additionalProperties).toBe(false);
        expect(Object.keys(capability.params.querySchema.schema.properties).sort()).toEqual(
          [...fixture.expectedQueryParameters].sort(),
        );
      } else {
        expect(capability?.params.freeFormQuery).toBe(false);
        expect(capability?.params.query.sort()).toEqual(
          [...fixture.expectedQueryParameters].sort(),
        );
      }

      expect(fixture.oracle.permissionProbe).toEqual({
        principal: 'restricted',
        expectedStatus: 403,
      });
    }
  });

  it('keeps global, group-only, and company-bound semantics distinct', () => {
    const groupOnly = pack.fixtures.filter(
      (fixture) => fixture.oracle.scopeProbe?.kind === 'company_principal_denied_group_read',
    );
    const companyBound = pack.fixtures.filter(
      (fixture) => fixture.seedScenario === 'company-bound-admin-records-v1',
    );
    const globalRecords = pack.fixtures.filter(
      (fixture) =>
        fixture.seedScenario === 'global-admin-records-v1' &&
        fixture.oracle.scopeProbe?.kind !== 'company_principal_denied_group_read',
    );

    expect(groupOnly.map((fixture) => fixture.capabilityId)).toEqual([
      'DataIsolationIssuesController.findAll',
      'DataIsolationTestsController.findAll',
    ]);
    expect(
      groupOnly.every(
        (fixture) =>
          fixture.governance.scope === 'global' && fixture.executionPrincipal === 'group',
      ),
    ).toBe(true);

    expect(companyBound.map((fixture) => fixture.capabilityId)).toEqual([
      'AuditLogsController.getEntityTypes',
      'UserSecurityProfilesController.findAll',
    ]);
    expect(
      companyBound.every(
        (fixture) =>
          fixture.governance.scope === 'company' &&
          fixture.executionPrincipal === 'company' &&
          fixture.oracle.absentBinding !== undefined,
      ),
    ).toBe(true);
    expect(
      companyBound.find(
        (fixture) => fixture.capabilityId === 'UserSecurityProfilesController.findAll',
      )?.oracle.scopeProbe,
    ).toEqual({
      kind: 'foreign_company_denied',
      deniedCompanyBinding: 'companyB',
      expectedStatus: 403,
    });

    expect(globalRecords).toHaveLength(8);
    expect(
      globalRecords.every(
        (fixture) =>
          fixture.governance.scope === 'global' &&
          fixture.executionPrincipal === 'company' &&
          fixture.oracle.absentBinding === undefined &&
          fixture.oracle.scopeProbe === undefined,
      ),
    ).toBe(true);
  });

  it('fails closed when an exact route contract drifts', () => {
    const target = byId.get('BackupJobsController.findAll');
    if (!target) throw new Error('BackupJobsController.findAll is absent');
    const drifted = manifest.map((capability) =>
      capability.id === target.id ? { ...capability, path: 'backup-jobs-v2' } : capability,
    );

    expect(
      globalAdminReadEvidencePack(drifted).fixtures.map((fixture) => fixture.capabilityId),
    ).not.toContain(target.id);
  });
});
