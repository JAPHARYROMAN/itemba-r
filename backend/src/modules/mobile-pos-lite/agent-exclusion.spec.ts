/**
 * The POS write path is invisible to Msaidizi (integration plan §10.6, and a
 * Phase 3 gate that must land while the deployment is still read-only).
 *
 * Two settled positions this encodes:
 *   • The agent stays out of ringing up sales and activating terminals. Both
 *     move business-day state and till custody — invariants the POS reform
 *     established by hand and that an agent has no way to reason about.
 *   • POS *reads* stay available to office roles, because "how much did Kaunta
 *     take today?" is the single most useful thing a manager would ask. A blanket
 *     controller-level exclusion would have been easier and is the wrong answer.
 *
 * Asserted against the real controller class rather than a fixture: the point is
 * that the decorators are on those handlers, so a fixture would prove nothing.
 */
import {
  capabilitiesFor,
  extractCapabilities,
  type Capability,
} from '../../common/capabilities/capability-manifest';
import { buildRegistry } from '../msaidizi/tool-registry';
import { MobilePosLiteController } from './mobile-pos-lite.controller';

const MANIFEST: Capability[] = extractCapabilities([MobilePosLiteController]);

const find = (handler: string): Capability => {
  const cap = MANIFEST.find((c) => c.handler === handler);
  if (!cap) throw new Error(`No capability extracted for handler ${handler}`);
  return cap;
};

/** Every permission this controller mentions — a caller who can do everything. */
const ALL_POS_PERMISSIONS = Array.from(
  new Set(MANIFEST.flatMap((c) => [...c.permissions, ...c.anyPermissions])),
);

describe('the POS write path is excluded from the agent', () => {
  it('marks POST /mobile-pos-lite/sales agent-excluded', () => {
    const cap = find('createSale');
    expect(cap.verb).toBe('POST');
    expect(cap.path).toContain('mobile-pos-lite/sales');
    expect(cap.agentExcluded).toBe(true);
  });

  it('marks POST /mobile-pos-lite/activate agent-excluded', () => {
    const cap = find('activate');
    expect(cap.verb).toBe('POST');
    expect(cap.path).toContain('mobile-pos-lite/activate');
    expect(cap.agentExcluded).toBe(true);
  });

  it('keeps both out of the envelope of a caller who holds every POS permission', () => {
    // Exclusion is checked before any permission reasoning, so holding the
    // permission is exactly the case that must still be withheld.
    const permitted = capabilitiesFor(MANIFEST, ALL_POS_PERMISSIONS).map((c) => c.handler);
    expect(permitted).not.toContain('createSale');
    expect(permitted).not.toContain('activate');
  });

  it('keeps both out of the tool registry at every write mode', () => {
    // Not just green. If the deployment is turned up to amber or red, these two
    // must still be absent — the exclusion is independent of the tier ceiling,
    // and this is the assertion that proves the two ceilings are not confused.
    for (const tiers of [['green'], ['green', 'amber'], ['green', 'amber', 'red']] as const) {
      const names = buildRegistry(MANIFEST, ALL_POS_PERMISSIONS, tiers).map(
        (e) => e.capability.handler,
      );
      expect(names).not.toContain('createSale');
      expect(names).not.toContain('activate');
    }
  });

  it('leaves the POS reads reachable', () => {
    // The exclusion must be two handlers wide. If someone moves @AgentExcluded
    // up to the controller, this fails — and the agent quietly stops being able
    // to answer the question managers most want to ask.
    const permitted = capabilitiesFor(MANIFEST, ALL_POS_PERMISSIONS).map((c) => c.handler);
    expect(permitted).toEqual(
      expect.arrayContaining(['session', 'products', 'stock', 'mySalesToday']),
    );
  });

  it('excludes nothing else in the module', () => {
    // Keeps the blast radius of this change visible: if a later edit excludes
    // another POS route, that is a decision someone should make deliberately,
    // and this test makes them come here and say so.
    const excluded = MANIFEST.filter((c) => c.agentExcluded)
      .map((c) => c.handler)
      .sort();
    expect(excluded).toEqual(['activate', 'createSale']);
  });
});
