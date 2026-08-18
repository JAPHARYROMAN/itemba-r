/**
 * Drift guard for the capability manifest.
 *
 * The manifest is only useful to Msaidizi if it stays a complete and honest
 * description of the API. These tests fail when a new endpoint lands without a
 * permission code or a reversibility classification, which is the moment to
 * decide what it is — not months later when an agent is already calling it.
 *
 * If one of these fails on a route you just added, the fix is to decorate the
 * route, or to add it to the acknowledged exemption list below with a reason.
 *
 * MEMORY COST: loadAllControllers() requires every controller, which pulls the
 * application's whole dependency graph into the Jest process. Under --runInBand
 * that memory is held for the rest of the run, and it is why the test scripts
 * pass --max-old-space-size=8192. Loading the real routing table is the point —
 * a manifest built from a stubbed subset would not catch drift — so the cost is
 * deliberate. If it grows further, split this suite into its own Jest project
 * rather than narrowing what it loads.
 */

import { extractCapabilities, capabilitiesFor, Capability } from './capability-manifest';
import { loadAllControllers } from './load-controllers';
import { TIER_RANK } from './reversibility';

/**
 * Routes that are deliberately reachable without a permission code, with the
 * reason. Anything not listed here must carry @RequirePermissions or
 * @RequireAnyPermissions.
 *
 * These are excluded from the agent's tool registry regardless — capabilitiesFor()
 * only admits permission-gated routes — so an entry here means "a human may reach
 * this without a permission grant", not "an agent may".
 */
const PERMISSIONLESS_BY_DESIGN: Record<string, string> = {
  // A permission check is meaningless before authentication: login, register,
  // refresh, password reset and 2FA all necessarily precede having permissions.
  AuthController: 'credential endpoints — they run before the user has permissions',
  // Self-scoped: a user editing their own preferences needs no grant.
  UserPreferencesController: 'self-scoped to the authenticated user (/me)',
  // Group governance is gated by @Roles at the class level instead.
  GroupsController: 'role-gated to GROUP_SUPER_ADMIN / GROUP_DIRECTOR',
  // Read-only catalogue and telemetry surfaces behind JwtAuthGuard.
  GlobalSearchController: 'read-only search, results are permission-filtered downstream',
  ReportsCatalogController: 'read-only catalogue listing; each report re-checks its own permission',
  ReportsEnterpriseController: 'report-runner metadata plus self-attributed run/export telemetry',
  SettingsCatalogController: 'read-only settings catalogue',
  // Renders a PDF from a caller-supplied table; auth-only by design, holds no
  // data of its own and reads nothing the caller did not already send.
  GeneratedDocumentsController: 'stateless render of caller-supplied content, auth-only by design',
};

let manifest: Capability[];

beforeAll(() => {
  manifest = extractCapabilities(loadAllControllers());
});

/**
 * A capability that exists only for a test, so an assertion about what
 * capabilitiesFor() *must* do does not depend on the routing table happening to
 * contain a specimen of the right shape. Defaults are the permissive case —
 * admitted whenever its codes are held — so each test overrides only the field
 * it is actually about.
 */
function synthetic(overrides: Partial<Capability> = {}): Capability {
  return {
    id: 'X.y',
    controller: 'X',
    handler: 'y',
    verb: 'POST',
    path: 'x/y',
    permissions: [],
    anyPermissions: [],
    roles: [],
    apiScopes: [],
    guard: 'permission',
    tier: 'amber',
    tierReason: 'write-verb',
    params: { path: [], query: [], freeFormQuery: false, hasBody: false },
    agentExcluded: false,
    ...overrides,
  };
}

describe('capability manifest', () => {
  it('discovers the routing table', () => {
    expect(manifest.length).toBeGreaterThan(1000);
    const controllers = new Set(manifest.map((c) => c.controller));
    expect(controllers.size).toBeGreaterThan(100);
  });

  it('gives every capability a stable id, a verb and a path', () => {
    const ids = manifest.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const cap of manifest) {
      expect(cap.verb).toMatch(/^(GET|POST|PATCH|PUT|DELETE|OPTIONS|HEAD|ALL)$/);
      expect(cap.path).not.toMatch(/^\/|\/\/|\/$/); // normalised, no stray slashes
    }
  });

  it('classifies every capability into a reversibility tier', () => {
    const unclassified = manifest.filter((c) => c.tierReason === 'unclassified-fallback');
    expect(unclassified.map((c) => `${c.verb} ${c.path} (${c.id})`)).toEqual([]);
  });

  it('permission-gates every write outside the acknowledged exemptions', () => {
    const offenders = manifest
      .filter((c) => c.tier !== 'green')
      .filter((c) => c.guard !== 'permission' && c.guard !== 'permission-any')
      // API-key routes authenticate on their own axis (x-api-key + @RequireApiScope)
      // and are machine-to-machine; they are never agent capabilities.
      .filter((c) => c.guard !== 'api-key')
      .filter((c) => !(c.controller in PERMISSIONLESS_BY_DESIGN))
      .map((c) => `${c.verb} ${c.path} (${c.id}) guard=${c.guard}`);

    expect(offenders).toEqual([]);
  });

  it('leaves no genuinely unauthenticated write', () => {
    // A write reaching `public` means neither JWT, nor permissions, nor an API
    // scope gates it. There should be none: @Public on a write is only correct
    // when paired with @RequireApiScope, which classifies as `api-key` instead.
    const unauthenticated = manifest
      .filter((c) => c.tier !== 'green' && c.guard === 'public')
      .filter((c) => c.controller !== 'AuthController')
      .map((c) => `${c.verb} ${c.path} (${c.id})`);

    expect(unauthenticated).toEqual([]);
  });

  it('scope-gates every API-key route', () => {
    const ungated = manifest
      .filter((c) => c.guard === 'api-key' && c.apiScopes.length === 0)
      .map((c) => c.id);
    expect(ungated).toEqual([]);
  });

  it('keeps the exemption list honest — no stale entries', () => {
    const present = new Set(manifest.map((c) => c.controller));
    const stale = Object.keys(PERMISSIONLESS_BY_DESIGN).filter((name) => !present.has(name));
    expect(stale).toEqual([]);
  });

  it('never marks a DELETE as anything but red', () => {
    const wrong = manifest.filter((c) => c.verb === 'DELETE' && c.tier !== 'red').map((c) => c.id);
    expect(wrong).toEqual([]);
  });

  it('never marks a GET as a write tier', () => {
    const wrong = manifest
      .filter((c) => c.verb === 'GET' && TIER_RANK[c.tier] > 0)
      .map((c) => c.id);
    expect(wrong).toEqual([]);
  });
});

describe('capabilitiesFor — the agent envelope', () => {
  it('admits nothing when the user holds no permissions', () => {
    expect(capabilitiesFor(manifest, [])).toEqual([]);
  });

  it('excludes role-gated and permissionless routes even for a broadly granted user', () => {
    const everyCode = [
      ...new Set(manifest.flatMap((c) => [...c.permissions, ...c.anyPermissions])),
    ];
    const admitted = capabilitiesFor(manifest, everyCode);

    for (const exempt of Object.keys(PERMISSIONLESS_BY_DESIGN)) {
      const leaked = admitted.filter(
        (c) => c.controller === exempt && c.guard !== 'permission' && c.guard !== 'permission-any',
      );
      expect(leaked).toEqual([]);
    }
  });

  it('never admits an API-key route — those are machine-to-machine', () => {
    const everyCode = [
      ...new Set(manifest.flatMap((c) => [...c.permissions, ...c.anyPermissions])),
    ];
    const admitted = capabilitiesFor(manifest, everyCode);
    expect(admitted.filter((c) => c.guard === 'api-key')).toEqual([]);
  });

  it('never admits an unauthenticated route', () => {
    const everyCode = [
      ...new Set(manifest.flatMap((c) => [...c.permissions, ...c.anyPermissions])),
    ];
    const admitted = capabilitiesFor(manifest, everyCode);
    expect(admitted.filter((c) => c.guard === 'public')).toEqual([]);
  });

  /**
   * Asserted against a synthetic capability rather than one found in the
   * manifest. A fixture picked by searching live routes is silently vacuous
   * whenever no route happens to match — which was the case here until the
   * first multi-code route existed, so this half of the check had never once
   * run. The synthetic pair always runs, and says what the function must do
   * rather than what today's routing table happens to contain.
   */
  it('requires ALL codes for @RequirePermissions and ANY for @RequireAnyPermissions', () => {
    const andCap = synthetic({ permissions: ['a.view', 'b.view'], guard: 'permission' });
    // Holding only the first code is not enough for AND semantics.
    expect(capabilitiesFor([andCap], ['a.view'])).toEqual([]);
    expect(capabilitiesFor([andCap], ['a.view', 'b.view'])).toHaveLength(1);

    // Holding any single code is enough for OR semantics.
    const orCap = synthetic({ anyPermissions: ['a.view', 'b.view'], guard: 'permission-any' });
    expect(capabilitiesFor([orCap], ['b.view'])).toHaveLength(1);
  });

  /**
   * The same two semantics against whatever real routes exist, so the synthetic
   * check above cannot drift away from the routing table. Agent-excluded routes
   * are skipped when choosing a specimen: capabilitiesFor() drops those before
   * it reasons about permissions at all, so one would fail this for a reason
   * that has nothing to do with AND/OR. Both searches may find nothing, which
   * is why they are a supplement to the synthetic pair and not a replacement.
   */
  it('applies those same semantics to real routes', () => {
    const eligible = manifest.filter((c) => !c.agentExcluded);

    const andCap = eligible.find((c) => c.guard === 'permission' && c.permissions.length > 1);
    if (andCap) {
      expect(capabilitiesFor([andCap], [andCap.permissions[0]])).toEqual([]);
      expect(capabilitiesFor([andCap], andCap.permissions)).toHaveLength(1);
    }

    const orCap = eligible.find((c) => c.guard === 'permission-any' && c.anyPermissions.length > 1);
    if (orCap) {
      expect(capabilitiesFor([orCap], [orCap.anyPermissions[0]])).toHaveLength(1);
    }
  });

  it('demands both sets when a route carries both decorators', () => {
    // No route does this today. The check exists because if one ever did, the
    // envelope would silently become wider than PermissionsGuard — which is the
    // single failure mode this module must not have.
    const both = synthetic({ permissions: ['a.create'], anyPermissions: ['b.view', 'c.view'] });

    expect(capabilitiesFor([both], ['a.create'])).toEqual([]); // AND met, OR unmet
    expect(capabilitiesFor([both], ['b.view'])).toEqual([]); // OR met, AND unmet
    expect(capabilitiesFor([both], ['a.create', 'b.view'])).toHaveLength(1); // both met
  });

  it('mirrors PermissionsGuard: a granted code admits its capability', () => {
    // Skip agent-excluded routes: they are dropped ahead of any permission
    // reasoning, so one picked as the specimen here would fail for the wrong
    // reason. toBeDefined() keeps the search from quietly finding nothing.
    const sample = manifest.find(
      (c) => c.guard === 'permission' && c.permissions.length === 1 && !c.agentExcluded,
    );
    expect(sample).toBeDefined();
    const admitted = capabilitiesFor(manifest, [sample!.permissions[0]]);
    expect(admitted.map((c) => c.id)).toContain(sample!.id);
  });
});
