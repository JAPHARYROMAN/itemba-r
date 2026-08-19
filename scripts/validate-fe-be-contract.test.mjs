#!/usr/bin/env node
/**
 * Tests for the frontend <-> backend route contract validator.
 *
 *   node --test scripts/validate-fe-be-contract.test.mjs
 *
 * The validator is a repo gate, and a gate can fail in two directions. It can
 * report a contract broken when it is not, which is loud and gets fixed within
 * the hour. Or its COVERAGE can shrink — fewer call sites examined, the same
 * cheerful "OK" printed — which is silent and gets fixed never. Only the second
 * kind matters here, because the first announces itself.
 *
 * The concrete case these tests exist for: the validator used to match `fetch(`
 * exactly, and to read the first argument for path literals only. Under that
 * rule the streaming client's `fetchImpl(endpoint, …)` — where `endpoint` is
 * `options.endpoint ?? MSAIDIZI_STREAM_PATH` — was not a backend call as far as
 * this script could tell, so `POST /msaidizi/ask/stream`, the one endpoint the
 * whole Msaidizi feature runs through, was never checked against any route.
 *
 * Both halves were reverted separately and measured on this tree. The
 * `fetch`-only callee pattern drops the checked set from 1022 call sites to
 * 1021, and the one it drops is the streaming endpoint — a one-line loss that no
 * reviewer reading the gate's output would ever notice. The literals-only
 * first-argument branch drops it to 985. Under both, the gate still printed
 * "OK — every checked call has a matching backend route" and exited 0. So:
 *
 *   - `follows an aliased callee through a module constant` fails if the callee
 *     pattern or the constant resolution goes back.
 *   - `checks the Msaidizi streaming endpoint against this repo's own routes`
 *     fails the same way, against the real tree rather than a fixture, which is
 *     the assertion that would have caught the original gap.
 *
 * Everything else here is the shape of the resolver: the cases that make
 * constant-following safe to leave switched on.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  brokenContracts,
  callsInSource,
  collectBackendRoutes,
  collectFrontendCalls,
  moduleConstants,
  resolveBackendPaths,
} from './validate-fe-be-contract.mjs';

/* ------------------------------------------------------------------------ *
 * Following an identifier to a path
 * ------------------------------------------------------------------------ */

// The real shape, reduced to the four lines that matter. Written as a fixture
// rather than read off `frontend/src/lib/msaidizi-stream.ts` on purpose: a test
// that only asserts what today's file happens to contain cannot say whether the
// MECHANISM works, only that it currently has nothing to do.
const STREAM_CLIENT = `
import { asDoneReason } from './msaidizi-types';

export const MSAIDIZI_STREAM_PATH = '/api/backend/msaidizi/ask/stream';

async function openStream(request, options) {
  const fetchImpl = options.fetchImpl ?? globalThis.fetch;
  const endpoint = options.endpoint ?? MSAIDIZI_STREAM_PATH;
  const attempt = () =>
    fetchImpl(endpoint, {
      method: 'POST',
      headers: requestHeaders(options),
      body: serialiseAsk(request),
    });
  return attempt();
}
`;

test('follows an aliased callee through a module constant to the endpoint it posts to', () => {
  const { calls } = callsInSource(STREAM_CLIENT, 'frontend/src/lib/msaidizi-stream.ts');

  assert.deepEqual(
    calls.map((call) => `${call.method} ${call.route}`),
    ['POST /msaidizi/ask/stream'],
  );
});

test('resolves an identifier through a chain of constants, and stops at a cycle', () => {
  const constants = moduleConstants(`
    const BASE = '/api/backend/reports/trial-balance';
    const endpoint = options.endpoint ?? BASE;
    const looping = alsoLooping;
    const alsoLooping = looping;
  `);

  assert.deepEqual(resolveBackendPaths('endpoint', constants), ['reports/trial-balance']);
  // A `const a = b; const b = a` pair terminates rather than recursing forever.
  // Asserted because the resolver is recursive and this file runs in CI.
  assert.deepEqual(resolveBackendPaths('looping', constants), []);
});

test('leaves a genuinely unresolvable URL alone rather than guessing at one', () => {
  const { calls, dynamicCount } = callsInSource(
    `
      const target = buildUrl(kind);
      fetch(target, { method: 'POST' });
      fetch(\`https://example.invalid/\${kind}\`);
    `,
    'frontend/src/lib/elsewhere.ts',
  );

  // Not a backend call and not claimed to be one. `dynamicCount` counts the
  // helper calls whose path is dynamic; a bare `fetch` to a third-party URL is
  // not a contract this script has any opinion about.
  assert.deepEqual(calls, []);
  assert.equal(dynamicCount, 0);
});

test('still reads a plain literal fetch, which is the ordinary case', () => {
  const { calls } = callsInSource(
    `await fetch('/api/backend/customers/41', { method: 'PATCH' });`,
    'frontend/src/lib/x.ts',
  );

  assert.deepEqual(calls, [
    { method: 'PATCH', route: '/customers/41', file: 'frontend/src/lib/x.ts', line: 1 },
  ]);
});

test('a constant holding no backend path contributes no call', () => {
  const { calls } = callsInSource(
    `
      const REFRESH_PATH = '/api/auth/refresh';
      const endpoint = REFRESH_PATH;
      fetchImpl(endpoint, { method: 'POST' });
    `,
    'frontend/src/lib/y.ts',
  );

  // `/api/auth/*` is a Next route handler, not a backend controller. Following
  // the constant must not turn one into a claim about the other.
  assert.deepEqual(calls, []);
});

/* ------------------------------------------------------------------------ *
 * Coverage of this repo, which is the assertion with teeth
 * ------------------------------------------------------------------------ */

test("checks the Msaidizi streaming endpoint against this repo's own routes", () => {
  const { calls } = collectFrontendCalls();
  const routes = collectBackendRoutes();

  const streaming = calls.filter(
    (call) => call.method === 'POST' && call.route === '/msaidizi/ask/stream',
  );

  assert.ok(
    streaming.length > 0,
    'POST /msaidizi/ask/stream is not in the checked set. The whole Msaidizi feature ' +
      'goes through that one endpoint via an aliased fetch and a module constant; if ' +
      'this validator has stopped following that indirection, a backend rename of the ' +
      'route now passes every gate in the repo and surfaces as a 404 in production.',
  );
  assert.ok(
    streaming.some((call) => call.file.replace(/\\/g, '/').endsWith('lib/msaidizi-stream.ts')),
    `expected the streaming client itself among ${JSON.stringify(streaming)}`,
  );

  // And the endpoint it checks is one the backend actually answers — the half
  // that makes the coverage worth having.
  assert.deepEqual(brokenContracts(streaming, routes), []);
});

test('the checked set is the whole frontend, not one lucky file', () => {
  const { calls } = collectFrontendCalls();

  // A floor, not a fixed number: the exact count moves with every feature, and a
  // test asserting today's figure would be edited to green on the day it broke.
  // What it catches is the failure mode that matters — an extraction that
  // silently collapses to a fraction of the tree.
  assert.ok(calls.length > 500, `only ${calls.length} frontend calls extracted`);
  assert.ok(
    new Set(calls.map((call) => call.file)).size > 50,
    'calls came from too few files for this to be a whole-tree scan',
  );
});

test('the gate this repo ships is green', () => {
  const { calls } = collectFrontendCalls();
  const routes = collectBackendRoutes();
  const failures = brokenContracts(calls, routes);

  assert.deepEqual(
    failures.map((f) => `${f.method} ${f.route} (${f.file}:${f.line})`),
    [],
  );
});
