/**
 * The budget knobs, and specifically the one whose NAME was wrong.
 *
 * `maxWritesPerRun` was `maxWritesPerSession`, and its doc promised a
 * per-session guarantee — "a permission that allows an action does not allow it
 * fifty times" — that the counter behind it has never given: `writeCalls` is a
 * local declared inside `MsaidiziService.run()`, reinitialised on every HTTP
 * request. Measured before the rename: three consecutive runs on one session id,
 * 10 + 10 + 10 red-tier postings against a configured ceiling of 10. Wave 3's
 * own report then reasoned from that figure as a session bound, which is how a
 * misleading name becomes a wrong safety argument.
 *
 * The rename is only half of it. `MSAIDIZI_MAX_WRITES_PER_SESSION` is the
 * spelling already sitting in `.env.example` and `docker-compose.production.yml`,
 * and a deployment that set a ceiling must not silently lose it because this
 * file learned a better word — so both names are read, and these tests pin which
 * one wins.
 *
 * The scope claim itself — per run and not per session — is pinned through the
 * real service in `msaidizi.write-path.spec.ts`, since it is a property of the
 * loop rather than of this file.
 */

import { ConfigService } from '@nestjs/config';
import { MsaidiziConfig } from './msaidizi.config';

/** A ConfigService over a fixed environment, defaults honoured as Nest does. */
function configWith(env: Record<string, string>): MsaidiziConfig {
  const service = {
    get: (key: string, fallback?: string) => (key in env ? env[key] : fallback),
  } as unknown as ConfigService;
  return new MsaidiziConfig(service);
}

describe('the write ceiling reads both the old name and the new one', () => {
  it('defaults to 10 when a deployment sets neither', () => {
    expect(configWith({}).maxWritesPerRun).toBe(10);
  });

  it('still honours MSAIDIZI_MAX_WRITES_PER_SESSION, the spelling already deployed', () => {
    // The rename must not quietly raise a ceiling somebody lowered on purpose.
    expect(configWith({ MSAIDIZI_MAX_WRITES_PER_SESSION: '3' }).maxWritesPerRun).toBe(3);
  });

  it('reads MSAIDIZI_MAX_WRITES_PER_RUN, the name that says what it bounds', () => {
    expect(configWith({ MSAIDIZI_MAX_WRITES_PER_RUN: '4' }).maxWritesPerRun).toBe(4);
  });

  it('lets the accurate name win when a deployment sets both', () => {
    expect(
      configWith({
        MSAIDIZI_MAX_WRITES_PER_RUN: '2',
        MSAIDIZI_MAX_WRITES_PER_SESSION: '25',
      }).maxWritesPerRun,
    ).toBe(2);
  });

  it('honours a per-run ceiling of zero rather than reading it as unset', () => {
    // `??` and not `||`: '0' is a deployment saying no writes at all, and a
    // falsy-coalesce would answer 10 to it.
    expect(configWith({ MSAIDIZI_MAX_WRITES_PER_RUN: '0' }).maxWritesPerRun).toBe(0);
  });
});

describe('the tool-call ceiling', () => {
  it('defaults to 40', () => {
    expect(configWith({}).maxToolCallsPerRun).toBe(40);
  });

  it('reads MSAIDIZI_MAX_TOOL_CALLS', () => {
    expect(configWith({ MSAIDIZI_MAX_TOOL_CALLS: '7' }).maxToolCallsPerRun).toBe(7);
  });
});

/**
 * The tier ceiling, which is the single most security-relevant mapping in the
 * module and — until this block — the only one nothing asserted.
 *
 * `READ_ONLY_CLAUSE` tells the model flatly "you have no tools that create,
 * update, or delete, and you cannot obtain any", and prompts.ts justifies
 * saying it flatly on the grounds that `allowedTiers` caps a read-only
 * deployment at green and `buildRegistry` intersects that cap with the
 * caller's permissions. The second half of that is pinned in
 * `tool-registry.spec.ts`. The first half was not pinned anywhere: every spec
 * that exercises read-only behaviour builds its own fixture that re-derives
 * the tier list, so the isolation spec's "emits no write tools at all in a
 * read-only deployment" proves the registry filters by *a* list, never that
 * `read-only` maps to `['green']`.
 *
 * Measured cost of that gap: changing `'read-only'` to `['green', 'amber']` in
 * msaidizi.config.ts left all 13 msaidizi suites and 253 tests passing, while a
 * deployment that had asked for read-only would hold every amber tool its
 * caller has permission for — and still be handed a system prompt stating it
 * has none. A sentence the model is told is a fact about its toolbox has to be
 * a fact about its toolbox.
 */
describe('the tier ceiling', () => {
  it('caps a read-only deployment at green, which is what the prompt promises', () => {
    expect(configWith({ MSAIDIZI_WRITE_MODE: 'read-only' }).allowedTiers).toEqual(['green']);
  });

  it('defaults to read-only when a deployment sets no write mode at all', () => {
    expect(configWith({}).writeMode).toBe('read-only');
    expect(configWith({}).allowedTiers).toEqual(['green']);
  });

  it('admits amber only at amber, and red only at red', () => {
    expect(configWith({ MSAIDIZI_WRITE_MODE: 'amber' }).allowedTiers).toEqual(['green', 'amber']);
    expect(configWith({ MSAIDIZI_WRITE_MODE: 'red' }).allowedTiers).toEqual([
      'green',
      'amber',
      'red',
    ]);
  });

  it('falls back to the read-only ceiling when the write mode is unrecognised', () => {
    // An unknown value must fail closed. A deployment typo is the case where a
    // silent widening would be least likely to be noticed.
    expect(configWith({ MSAIDIZI_WRITE_MODE: 'reed-only' }).allowedTiers).toEqual(['green']);
  });
});
