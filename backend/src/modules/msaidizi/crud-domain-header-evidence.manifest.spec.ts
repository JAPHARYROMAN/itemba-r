import { Prisma } from '@prisma/client';
import { extractCapabilities } from '../../common/capabilities/capability-manifest';
import { loadAllControllers } from '../../common/capabilities/load-controllers';
import {
  CRUD_QUERY_READ_REMAINING_BLOCKERS,
  crudEvidenceFixturesForManifest,
} from './crud-execution-evidence';
import {
  CRUD_DOMAIN_HEADER_PRIOR_BLOCKER_CAPABILITY_IDS,
  CRUD_DOMAIN_HEADER_REMAINING_BLOCKERS,
  CRUD_DOMAIN_HEADER_TARGETS,
  CRUD_DOMAIN_PARAMETER_DEFINITION_COUNT,
  CRUD_TERMINAL_CONTEXT_BLOCKER_CAPABILITY_IDS,
  CRUD_TERMINAL_CONTEXT_DEFINITION_COUNT,
  domainHeaderEvidencePacks,
} from './crud-domain-header-evidence';

describe('manifest-bound domain-parameter and terminal-context CRUD evidence', () => {
  const manifest = extractCapabilities(loadAllControllers());
  const byId = new Map(manifest.map((capability) => [capability.id, capability]));

  it('keeps the measured 29-route inventory exact and honest', () => {
    expect(CRUD_DOMAIN_HEADER_TARGETS).toHaveLength(29);
    expect(new Set(CRUD_DOMAIN_HEADER_TARGETS)).toHaveProperty('size', 29);
    expect(CRUD_DOMAIN_PARAMETER_DEFINITION_COUNT).toBe(16);
    expect(CRUD_TERMINAL_CONTEXT_DEFINITION_COUNT).toBe(0);
    expect(CRUD_TERMINAL_CONTEXT_BLOCKER_CAPABILITY_IDS).toHaveLength(9);
    expect(CRUD_DOMAIN_HEADER_REMAINING_BLOCKERS).toHaveLength(12);
    expect(CRUD_DOMAIN_HEADER_PRIOR_BLOCKER_CAPABILITY_IDS).toEqual([
      'ProfitController.exportReport',
    ]);
    for (const capabilityId of CRUD_DOMAIN_HEADER_TARGETS) {
      expect(byId.get(capabilityId)).toBeDefined();
    }
  });

  it('registers 16 exact positives and no fixture-only terminal credential path', () => {
    const packs = domainHeaderEvidencePacks(manifest);
    const fixtures = packs.flatMap((pack) => pack.fixtures);

    expect(packs.map((pack) => [pack.packId, pack.fixtures.length])).toEqual([
      ['domain-parameter-reads', 16],
      ['terminal-context-reads', 0],
    ]);
    expect(fixtures).toHaveLength(16);
    expect(new Set(fixtures.map((fixture) => fixture.fixtureId)).size).toBe(16);
    expect(new Set(fixtures.map((fixture) => fixture.capabilityId)).size).toBe(16);

    for (const fixture of fixtures) {
      const capability = byId.get(fixture.capabilityId)!;
      expect(capability.agentExcluded).toBe(false);
      expect(capability.verb).toBe('GET');
      expect(capability.path).toBe(fixture.expectedPath);
      expect(capability.params.path).toEqual([]);
      expect(capability.permissions.length + capability.anyPermissions.length).toBeGreaterThan(0);
      if (capability.params.freeFormQuery) {
        expect(capability.params.querySchema?.quality).toBe('strict');
        expect(capability.params.querySchema?.schema.additionalProperties).toBe(false);
      }
    }

    expect(fixtures.every((fixture) => fixture.contextHeaderBindings.length === 0)).toBe(true);
    expect(fixtures.filter((fixture) => fixture.governance.scope === 'company')).toHaveLength(14);
    expect(fixtures.filter((fixture) => fixture.governance.scope === 'actor')).toHaveLength(1);
    expect(fixtures.filter((fixture) => fixture.governance.scope === 'global')).toHaveLength(1);
    expect(fixtures.filter((fixture) => fixture.governance.scope === 'unclassified')).toEqual([]);
    expect(fixtures.some((fixture) => fixture.governance.scope === 'not_applicable')).toBe(false);

    for (const fixture of fixtures.filter(
      (candidate) => candidate.governance.scope === 'company',
    )) {
      const bindsCompanyA = fixture.queryBindings.some(
        (argument) => argument.name === 'companyId' && argument.binding === 'companyA',
      );
      expect(fixture.executionPrincipal === 'company' || bindsCompanyA).toBe(true);
    }
  });

  it('closes the final eight scopes with signed causal markers or company-B denials', () => {
    const fixtures = domainHeaderEvidencePacks(manifest).flatMap((pack) => pack.fixtures);
    const closed = fixtures.filter((fixture) => fixture.scopeOracle);

    expect(closed.map((fixture) => fixture.capabilityId).sort()).toEqual(
      [
        'AuditLogsController.getSummary',
        'EmployeesController.findLinkableUsers',
        'InventoryBalancesController.live',
        'LoansController.getUpcomingRepayments',
        'MobileMoneyAccountsController.findByEmployee',
        'OfflineSyncController.findCheckpoints',
        'TaxAnomalyDetectionController.scan',
        'WcfAuditController.exposure',
      ].sort(),
    );
    expect(closed.filter((fixture) => fixture.scopeOracle?.kind === 'denied_request')).toHaveLength(
      5,
    );
    expect(
      closed.filter((fixture) => fixture.scopeOracle?.kind === 'response_markers'),
    ).toHaveLength(3);

    for (const fixture of closed) {
      expect(fixture.fixtureVersion).toBe(3);
      expect(fixture.scopeOracle?.controls).toBeDefined();
      if (fixture.scopeOracle?.kind === 'denied_request') {
        expect(fixture.governance.scope).toBe('company');
        expect(fixture.scopeOracle.deniedCompanyBinding).toBe('companyB');
        expect([403, 404]).toContain(fixture.scopeOracle.expectedStatus);
      } else if (fixture.scopeOracle?.kind === 'response_markers') {
        expect(fixture.scopeOracle.scope).toBe(fixture.governance.scope);
        expect(fixture.scopeOracle.presentBindings.length).toBeGreaterThan(0);
        expect(fixture.scopeOracle.controls.length).toBeGreaterThan(0);
      }
    }
  });

  it('retains 13 audited/device-bound reads as exact blockers, not fixtures', () => {
    const packs = domainHeaderEvidencePacks(manifest);
    const fixtures = packs.flatMap((pack) => pack.fixtures);
    const blocked = [
      ...CRUD_DOMAIN_HEADER_REMAINING_BLOCKERS,
      ...CRUD_QUERY_READ_REMAINING_BLOCKERS.filter((blocker) =>
        CRUD_DOMAIN_HEADER_PRIOR_BLOCKER_CAPABILITY_IDS.includes(
          blocker.capabilityId as (typeof CRUD_DOMAIN_HEADER_PRIOR_BLOCKER_CAPABILITY_IDS)[number],
        ),
      ),
    ];

    expect(blocked.map((blocker) => blocker.capabilityId).sort()).toEqual([
      'DocumentsController.findByEntity',
      'MobilePosLiteController.catalog',
      'MobilePosLiteController.customers',
      'MobilePosLiteController.mySalesToday',
      'MobilePosLiteController.products',
      'MobilePosLiteController.purchaseHistory',
      'MobilePosLiteController.salesHistory',
      'MobilePosLiteController.session',
      'MobilePosLiteController.stock',
      'MobilePosLiteController.suppliers',
      'OperationsReportsController.exportSupplier360',
      'OperationsReportsController.getSupplier360',
      'ProfitController.exportReport',
    ]);
    expect(
      fixtures.filter((fixture) =>
        blocked.some((blocker) => blocker.capabilityId === fixture.capabilityId),
      ),
    ).toEqual([]);

    for (const blocker of blocked) {
      const capability = byId.get(blocker.capabilityId)!;
      expect(capability.agentExcluded).toBe(true);
      expect(capability.agentExclusionReason).toBe(blocker.reason);
    }

    expect(
      [
        ...fixtures.map((fixture) => fixture.capabilityId),
        ...blocked.map((item) => item.capabilityId),
      ].sort(),
    ).toEqual([...CRUD_DOMAIN_HEADER_TARGETS]);
  });

  it('registers every positive once in the verifier registry', () => {
    const trancheFixtures = domainHeaderEvidencePacks(manifest).flatMap((pack) => pack.fixtures);
    const tranche = trancheFixtures.map((fixture) => fixture.fixtureId).sort();
    const trancheCapabilities = new Set(trancheFixtures.map((fixture) => fixture.capabilityId));
    const verifier = crudEvidenceFixturesForManifest(manifest)
      .filter((fixture) => trancheCapabilities.has(fixture.capabilityId))
      .map((fixture) => fixture.fixtureId)
      .sort();

    expect(verifier).toHaveLength(16);
    expect(verifier).toEqual(tranche);
  });

  it('references only current Prisma DMMF seed models', () => {
    const knownModels = new Set(Prisma.dmmf.datamodel.models.map((model) => model.name));
    const referencedModels = [
      ...new Set(
        domainHeaderEvidencePacks(manifest)
          .flatMap((pack) => pack.fixtures)
          .flatMap((fixture) => fixture.seedModels),
      ),
    ].sort();

    expect(referencedModels.filter((model) => !knownModels.has(model))).toEqual([]);
    expect(referencedModels).toContain('DeviceRegistration');
    expect(referencedModels).toContain('SyncCheckpoint');
    expect(referencedModels).not.toContain('OfflineDevice');
  });

  it('binds domain-parameter sensitive reads to their exact audit effect', () => {
    const fixtures = domainHeaderEvidencePacks(manifest)
      .flatMap((pack) => pack.fixtures)
      .filter((candidate) => candidate.governance.audit === 'required');

    expect(fixtures.map((fixture) => fixture.capabilityId).sort()).toEqual(
      ['ContractsController.getExpiring', 'LoansController.getUpcomingRepayments'].sort(),
    );
    expect(fixtures.every((fixture) => fixture.mutation.kind === 'single_audit_row')).toBe(true);
    expect(
      fixtures.every(
        (fixture) =>
          fixture.mutation.kind === 'single_audit_row' &&
          fixture.mutation.action === 'VIEW_SENSITIVE',
      ),
    ).toBe(true);
  });
});
