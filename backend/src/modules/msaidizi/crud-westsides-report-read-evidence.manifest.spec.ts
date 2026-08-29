import { extractCapabilities } from '../../common/capabilities/capability-manifest';
import { loadAllControllers } from '../../common/capabilities/load-controllers';
import {
  CRUD_WESTSIDES_REPORT_READ_TARGETS,
  westsidesReportReadEvidencePack,
} from './crud-westsides-report-read-evidence';

describe('manifest-bound Westsides derived-report read evidence', () => {
  const manifest = extractCapabilities(loadAllControllers());
  const byId = new Map(manifest.map((capability) => [capability.id, capability]));

  it('keeps the complete 25-route controller inventory exact', () => {
    const liveTargets = manifest
      .filter(
        (capability) =>
          capability.controller === 'WestsidesReportsController' && capability.verb === 'GET',
      )
      .map((capability) => capability.id)
      .sort();

    expect(CRUD_WESTSIDES_REPORT_READ_TARGETS).toHaveLength(25);
    expect(new Set(CRUD_WESTSIDES_REPORT_READ_TARGETS).size).toBe(25);
    expect([...CRUD_WESTSIDES_REPORT_READ_TARGETS].sort()).toEqual(liveTargets);
  });

  it('registers one strict, permission-governed company fixture per route', () => {
    const pack = westsidesReportReadEvidencePack(manifest);

    expect(pack.packId).toBe('westsides-derived-report-reads');
    expect(pack.packVersion).toBe(2);
    expect(pack.fixtures).toHaveLength(25);
    expect(new Set(pack.fixtures.map((fixture) => fixture.fixtureId)).size).toBe(25);
    expect(new Set(pack.fixtures.map((fixture) => fixture.capabilityId)).size).toBe(25);

    for (const fixture of pack.fixtures) {
      const capability = byId.get(fixture.capabilityId)!;
      expect(capability).toBeDefined();
      expect(capability.agentExcluded).toBe(false);
      expect(capability.verb).toBe('GET');
      expect(capability.path).toBe(fixture.expectedPath);
      expect(capability.params.path).toEqual([]);
      expect(capability.permissions).toContain('westsides.reports.view');
      expect(capability.anyPermissions).toEqual([]);
      if (capability.params.freeFormQuery) {
        expect(capability.params.querySchema?.quality).toBe('strict');
        expect(capability.params.querySchema?.schema.additionalProperties).toBe(false);
      } else {
        expect([...capability.params.query].sort()).toEqual(['branchId', 'companyId', 'date']);
      }
      expect(fixture.governance).toEqual({ scope: 'company', audit: 'not_applicable' });
      expect(fixture.execution).toEqual({
        companyA: 'company',
        companyB: 'group',
        foreignCompanyProbe: { principal: 'company', expectedStatus: 403 },
      });
    }
  });

  it('requires causal, conflicting A/B row identities and exact derived fields', () => {
    const fixtures = westsidesReportReadEvidencePack(manifest).fixtures;

    for (const fixture of fixtures) {
      expect(fixture.companyAOracle.collectionPath).toEqual(fixture.companyBOracle.collectionPath);
      expect(fixture.companyAOracle.match.path).toEqual(fixture.companyBOracle.match.path);
      expect(fixture.companyAOracle.match.binding).toMatch(/A$/);
      expect(fixture.companyBOracle.match.binding).toMatch(/B$/);
      expect(fixture.companyAOracle.match.binding).not.toBe(fixture.companyBOracle.match.binding);
      expect(fixture.companyAOracle.fields.length).toBeGreaterThan(0);
      expect(fixture.companyAOracle.fields).toHaveLength(fixture.companyBOracle.fields.length);

      for (let index = 0; index < fixture.companyAOracle.fields.length; index += 1) {
        const companyAField = fixture.companyAOracle.fields[index];
        const companyBField = fixture.companyBOracle.fields[index];
        expect(companyAField.path).toEqual(companyBField.path);
        expect(companyAField.binding).toMatch(/A$/);
        expect(companyBField.binding).toMatch(/B$/);
      }
    }
  });

  it('uses the daily-close request only for the Z-report and bounded date ranges elsewhere', () => {
    const fixtures = westsidesReportReadEvidencePack(manifest).fixtures;
    const dailyClose = fixtures.filter((fixture) => fixture.requestKind === 'daily-close');

    expect(dailyClose.map((fixture) => fixture.capabilityId)).toEqual([
      'WestsidesReportsController.dailyClose',
    ]);
    expect(fixtures.filter((fixture) => fixture.requestKind === 'report-range')).toHaveLength(24);
  });
});
