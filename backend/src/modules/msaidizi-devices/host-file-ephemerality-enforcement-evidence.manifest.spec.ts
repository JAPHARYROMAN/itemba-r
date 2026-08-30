/**
 * Invariant guard for the ephemeral-file-disclosure boundary (issue #52).
 *
 * WHAT THIS TEST DOES
 *   1. Re-reads the source of every enforcement check registered in
 *      `host-file-ephemerality-enforcement-evidence.ts` and fails if the file is
 *      gone, the function that held the check is gone or was renamed, or the
 *      guard fragments no longer appear inside it in the registered order. Each
 *      fragment spans the test and its consequence together, so adding a
 *      condition to the test, or a statement between the test and the refusal,
 *      fails. Three of those checks are boolean helpers, so the test also
 *      re-reads the caller that has to consult them; four are whole-declaration
 *      refusals, whose entire text is pinned so that an early return above a
 *      registered `throw` cannot leave the throw textually present.
 *   2. Derives the enforcement surface (files that import the policy module) and
 *      partitions every capability-handling function in it into registered
 *      enforcement sites and reviewed exclusions. A new function on that surface
 *      belongs to neither set and fails until someone classifies it. A function
 *      counts as capability-handling if it names a capability, touches the host
 *      action table, carries an `outputJson` payload, or names a file.
 *   3. Derives the wider set of files that read a `capability` member of any
 *      record, or that name one of the closed capability ids, and requires each
 *      one to be either on the enforcement surface or in the reviewed
 *      out-of-scope list.
 *   4. Pins the behaviour of the two predicates themselves, so the checks cannot
 *      all be left in place around a predicate that has quietly been opened, and
 *      pins that every reviewed out-of-scope file still exists.
 *
 * WHERE IT LOOKS
 *   Both derived scans are rooted at `src`, so `src/common`, `src/prisma`,
 *   `src/bootstrap` and `src/config` are inside the guard, not only
 *   `src/modules`. Test files are not scanned.
 *
 * WHAT THIS TEST DOES NOT GUARANTEE
 *   - It is not a proof that the boundary is closed. It proves that the checks
 *     someone reviewed are still textually present, in the shape they were
 *     reviewed in, and that the reviewed surface has not silently grown. It
 *     never executes a dispatch path, so it cannot tell you whether a registered
 *     check is reachable, or still on the path the bytes actually take. In
 *     particular, a new branch inserted *above* a registered check, which
 *     returns before the check runs, is not detected.
 *   - Detection is textual. There is no runtime manifest of "functions that
 *     could move a host file capability", the way `Prisma.dmmf` and the
 *     controller manifest ground the `crud-*` evidence registries, so this
 *     inventory is derived from the TypeScript AST and ages against source text
 *     rather than against a compiled artifact.
 *   - It attributes nested helpers to the outermost function that contains them,
 *     so a new closure added inside an already registered function is invisible
 *     to the partition.
 *   - The inventory patterns are heuristics, and pass 2 applies them per
 *     function, not per file. A new method added to a file that already imports
 *     the policy still escapes if its body names no capability, no host action
 *     table, no `outputJson` and no file — being in an enforcing file is not by
 *     itself enough to make it visible. A new file escapes pass 3 if it never
 *     reads a `.capability` member and never names a closed capability id.
 *   - Registering an entry as a reviewed exclusion is a human judgement recorded
 *     as a note. The test checks that the note exists, never that it is true.
 *
 * The reviewed position is that this is the interim guard while the boundary is
 * enforced by scattered predicates instead of one production port. If the port
 * is ever built, delete this registry rather than grow it.
 */
import {
  HOST_FILE_CONTENT_CAPABILITY_IDS,
  HOST_FILE_ENFORCEMENT_SITES,
  HOST_FILE_OUT_OF_SCOPE_FILES,
  HOST_FILE_SURFACE_EXCLUSIONS,
  ScannedFunction,
  capabilityHandlingFunctions,
  containsGuardToken,
  declaredFunctions,
  enforcementSurfaceFiles,
  hostActionCapabilityFiles,
  missingEnforcementMessage,
  msaidiziSourceRoot,
  normalizeSource,
  siteKey,
  sourceFileExists,
  staleOutOfScopeMessage,
  unclassifiedFilesMessage,
  unregisteredFunctionsMessage,
} from './host-file-ephemerality-enforcement-evidence';
import {
  EPHEMERAL_FILE_DISCLOSURE_CAPABILITY,
  LEGACY_DURABLE_FILE_READ_CAPABILITY,
  isForbiddenDurableFileRead,
  isUnavailableHostFileContentCapability,
} from './host-file-ephemerality.policy';

const sourceRoot = msaidiziSourceRoot();

function functionsOf(file: string): Map<string, ScannedFunction> {
  return new Map(
    declaredFunctions(sourceRoot, file).map((declared) => [declared.symbol, declared]),
  );
}

const surfaceFunctions = new Map<string, Map<string, ScannedFunction>>();
for (const file of enforcementSurfaceFiles(sourceRoot)) {
  surfaceFunctions.set(file, functionsOf(file));
}

function declaredFunction(file: string, symbol: string): ScannedFunction | undefined {
  const cached = surfaceFunctions.get(file) ?? functionsOf(file);
  surfaceFunctions.set(file, cached);
  return cached.get(symbol);
}

describe('host file ephemerality enforcement registry', () => {
  it('keeps every registered enforcement check present in the source', () => {
    const problems: string[] = [];

    for (const site of HOST_FILE_ENFORCEMENT_SITES) {
      if (!sourceFileExists(sourceRoot, site.file)) {
        problems.push(
          `${site.siteId}: ${site.file} no longer exists, so ${site.symbol} cannot be read (it ${site.disposition})`,
        );
        continue;
      }
      const declared = declaredFunction(site.file, site.symbol);
      if (!declared) {
        problems.push(`${site.siteId}: ${siteKey(site)} no longer exists (it ${site.disposition})`);
        continue;
      }
      // Guards must appear in the registered order: searching from the end of
      // the previous match stops a consequence from being accepted above its
      // own test.
      let cursor = 0;
      for (const guard of site.guards) {
        const fragment = normalizeSource(guard);
        const at = declared.source.indexOf(fragment, cursor);
        if (at < 0) {
          problems.push(
            cursor === 0
              ? `${site.siteId}: ${siteKey(site)} no longer contains \`${guard}\``
              : `${site.siteId}: ${siteKey(site)} no longer contains \`${guard}\` after the guard before it`,
          );
          break;
        }
        cursor = at + fragment.length;
      }
      if (site.entireDeclaration != null) {
        const expected = normalizeSource(site.entireDeclaration);
        if (declared.source !== expected) {
          problems.push(
            `${site.siteId}: ${siteKey(site)} is registered as a whole-declaration refusal (${site.disposition}), but its body has changed; nothing may be added to it`,
          );
        }
      }
      if (!site.calledBy) continue;
      const caller = declaredFunction(site.file, site.calledBy.symbol);
      if (!caller) {
        problems.push(
          `${site.siteId}: its caller ${siteKey({ file: site.file, symbol: site.calledBy.symbol })} no longer exists`,
        );
      } else if (!caller.source.includes(normalizeSource(site.calledBy.call))) {
        problems.push(
          `${site.siteId}: ${site.calledBy.symbol} no longer calls \`${site.calledBy.call}\`, so the check decides nothing`,
        );
      }
    }

    if (problems.length > 0) throw new Error(missingEnforcementMessage(problems));
    expect(HOST_FILE_ENFORCEMENT_SITES).toHaveLength(16);
  });

  it('partitions every capability-handling function on the enforcement surface', () => {
    const registered = new Map(HOST_FILE_ENFORCEMENT_SITES.map((site) => [siteKey(site), site]));
    const excluded = new Map(
      HOST_FILE_SURFACE_EXCLUSIONS.map((exclusion) => [siteKey(exclusion), exclusion]),
    );
    const inventory = capabilityHandlingFunctions(sourceRoot);

    const unregistered = inventory.filter(
      (declared) => !registered.has(siteKey(declared)) && !excluded.has(siteKey(declared)),
    );
    if (unregistered.length > 0) throw new Error(unregisteredFunctionsMessage(unregistered));

    const guardedButExcluded = inventory.filter(
      (declared) => excluded.has(siteKey(declared)) && containsGuardToken(declared.source),
    );
    if (guardedButExcluded.length > 0) {
      throw new Error(
        [
          unregisteredFunctionsMessage(guardedButExcluded),
          '',
          'These are currently listed in HOST_FILE_SURFACE_EXCLUSIONS but now refuse',
          'host file bytes. Move them to HOST_FILE_ENFORCEMENT_SITES so that removing',
          'the new check fails this test.',
        ].join('\n'),
      );
    }

    expect(inventory.map(siteKey)).toEqual(
      expect.arrayContaining([...registered.keys(), ...excluded.keys()]),
    );
    expect(inventory).toHaveLength(HOST_FILE_ENFORCEMENT_SITES.length + excluded.size);
  });

  it('keeps the host action capability surface fully classified', () => {
    const surface = new Set(enforcementSurfaceFiles(sourceRoot));
    const reviewed = new Set(HOST_FILE_OUT_OF_SCOPE_FILES.map((entry) => entry.file));
    const unclassified = hostActionCapabilityFiles(sourceRoot).filter(
      (file) => !surface.has(file) && !reviewed.has(file),
    );

    if (unclassified.length > 0) throw new Error(unclassifiedFilesMessage(unclassified));
    expect(unclassified).toEqual([]);
  });

  it('keeps every reviewed out-of-scope file present and off the enforcement surface', () => {
    const missing = HOST_FILE_OUT_OF_SCOPE_FILES.map((entry) => entry.file).filter(
      (file) => !sourceFileExists(sourceRoot, file),
    );
    if (missing.length > 0) throw new Error(staleOutOfScopeMessage(missing));

    const surface = new Set(enforcementSurfaceFiles(sourceRoot));
    const nowEnforcing = HOST_FILE_OUT_OF_SCOPE_FILES.map((entry) => entry.file).filter((file) =>
      surface.has(file),
    );
    expect(nowEnforcing).toEqual([]);
    expect(HOST_FILE_OUT_OF_SCOPE_FILES).toHaveLength(19);
  });

  it('keeps the registry itself unambiguous', () => {
    const siteIds = HOST_FILE_ENFORCEMENT_SITES.map((site) => site.siteId);
    expect(new Set(siteIds).size).toBe(siteIds.length);

    const registered = HOST_FILE_ENFORCEMENT_SITES.map(siteKey);
    const excluded = HOST_FILE_SURFACE_EXCLUSIONS.map(siteKey);
    expect(new Set(registered).size).toBe(registered.length);
    expect(new Set(excluded).size).toBe(excluded.length);
    expect(registered.filter((key) => excluded.includes(key))).toEqual([]);

    for (const site of HOST_FILE_ENFORCEMENT_SITES) {
      expect(site.guards.length).toBeGreaterThan(0);
      expect(site.disposition.length).toBeGreaterThan(0);
    }
    for (const exclusion of HOST_FILE_SURFACE_EXCLUSIONS) {
      expect(exclusion.note.length).toBeGreaterThan(0);
    }
    for (const entry of HOST_FILE_OUT_OF_SCOPE_FILES) {
      expect(entry.note.length).toBeGreaterThan(0);
    }
    expect(new Set(HOST_FILE_OUT_OF_SCOPE_FILES.map((entry) => entry.file)).size).toBe(
      HOST_FILE_OUT_OF_SCOPE_FILES.length,
    );
  });

  it('keeps the two shared predicates closed over both file capabilities', () => {
    for (const capability of HOST_FILE_CONTENT_CAPABILITY_IDS) {
      expect(isUnavailableHostFileContentCapability(capability)).toBe(true);
    }
    expect(isForbiddenDurableFileRead(LEGACY_DURABLE_FILE_READ_CAPABILITY)).toBe(true);
    expect(isForbiddenDurableFileRead(EPHEMERAL_FILE_DISCLOSURE_CAPABILITY)).toBe(false);
    expect(isUnavailableHostFileContentCapability('screen.primary.capture')).toBe(false);
    expect(isUnavailableHostFileContentCapability(undefined)).toBe(false);
    expect([...HOST_FILE_CONTENT_CAPABILITY_IDS]).toEqual([
      LEGACY_DURABLE_FILE_READ_CAPABILITY,
      EPHEMERAL_FILE_DISCLOSURE_CAPABILITY,
    ]);
  });
});
