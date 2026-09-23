import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  assertReadOnlyBenchmark,
  benchmarkConnection,
  benchmarkJson,
} from './tool-search-client.mjs';

test('local fixtures keep defaults; remote targets require HTTPS and explicit credentials', () => {
  assert.equal(benchmarkConnection({}).api, 'http://127.0.0.1:3014/api/v1');
  for (const api of ['http://staging.example/api/v1', 'ftp://localhost/api/v1']) {
    assert.throws(() => benchmarkConnection({ MSAIDIZI_API: api }), /HTTPS/);
  }
  assert.throws(
    () => benchmarkConnection({ MSAIDIZI_API: 'https://staging.example/api/v1' }),
    /explicit/,
  );
  const connection = benchmarkConnection({
    MSAIDIZI_API: 'https://staging.example/api/v1/',
    SEED_ADMIN_EMAIL: 'fixture@example.com',
    SEED_ADMIN_PASSWORD: 'test-only-password',
  });
  assert.equal(connection.api, 'https://staging.example/api/v1');
});

test('URLs cannot smuggle credentials or request parameters', () => {
  for (const api of [
    'https://user:secret@staging.example/api/v1',
    'https://staging.example/api/v1?token=secret',
    'https://staging.example/api/v1#fragment',
  ]) {
    assert.throws(() => benchmarkConnection({ MSAIDIZI_API: api }), /must not contain/);
  }
});

test('disabled, write-enabled and malformed capability responses stop before model requests', () => {
  const caps = { enabled: true, writeMode: 'read-only', capabilities: [] };
  assert.doesNotThrow(() => assertReadOnlyBenchmark(caps));
  for (const other of [
    null,
    {},
    { ...caps, enabled: false },
    { ...caps, enabled: 'true' },
    { ...caps, writeMode: 'full' },
    { ...caps, writeMode: 'confirm' },
    { ...caps, capabilities: undefined },
  ]) {
    assert.throws(() => assertReadOnlyBenchmark(other));
  }
});

test('requests refuse redirects and carry a deadline, including response-body reads', async () => {
  let received;
  const result = await benchmarkJson(
    'https://staging.example/api/v1',
    {},
    {
      fetchImpl: async (_url, init) => {
        received = init;
        return new Response(JSON.stringify({ data: 'ok' }), { status: 201 });
      },
    },
  );
  assert.equal(received.redirect, 'error');
  assert.ok(received.signal instanceof AbortSignal);
  assert.deepEqual(result, { body: { data: 'ok' }, status: 201 });
});

test('timeouts stop a request without automatic retries', async () => {
  let calls = 0;
  // Keep the event loop alive while AbortSignal's unref'ed timer expires.
  const keepAlive = setTimeout(() => {}, 1000);
  try {
    await assert.rejects(
      benchmarkJson(
        'https://staging.example/api/v1',
        {},
        {
          timeoutMs: 10,
          fetchImpl: async (_url, { signal }) => {
            calls += 1;
            return new Promise((_resolve, reject) => {
              signal.addEventListener('abort', () => reject(signal.reason), { once: true });
            });
          },
        },
      ),
      { name: 'TimeoutError' },
    );
    assert.equal(calls, 1);
  } finally {
    clearTimeout(keepAlive);
  }
});

test('proxy errors and malformed bodies do not expose response contents', async () => {
  for (const status of [302, 401, 502]) {
    await assert.rejects(
      benchmarkJson(
        'https://staging.example/api/v1',
        {},
        {
          fetchImpl: async () => new Response('secret echoed by proxy', { status }),
        },
      ),
      (error) => error.message.includes(String(status)) && !error.message.includes('secret'),
    );
  }
  await assert.rejects(
    benchmarkJson(
      'https://staging.example/api/v1',
      {},
      {
        fetchImpl: async () => new Response('secret invalid JSON'),
      },
    ),
    /not valid JSON/,
  );
});

test('CLI preflight stops unhealthy or write-enabled targets; read-only spending writes evidence', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'msaidizi-benchmark-client-'));
  try {
    for (const scenario of ['unhealthy', 'redirect', 'write-enabled', 'read-only']) {
      const paths = [];
      const server = createServer((request, response) => {
        paths.push(request.url);
        response.setHeader('Content-Type', 'application/json');
        if (request.url === '/api/v1/health/ready') {
          response.statusCode = scenario === 'unhealthy' ? 502 : 200;
          response.end(JSON.stringify({ status: 'ok' }));
        } else if (request.url === '/api/v1/auth/login') {
          if (scenario === 'redirect') {
            response.writeHead(307, { Location: '/unexpected-credential-target' });
            response.end();
          } else {
            response.end(JSON.stringify({ data: { accessToken: 'fixture-token' } }));
          }
        } else if (request.url === '/api/v1/msaidizi/capabilities') {
          response.end(
            JSON.stringify({
              data: {
                enabled: true,
                writeMode: scenario === 'write-enabled' ? 'full' : 'read-only',
                capabilities: [
                  { name: 'Expenses_findAll', capabilityId: 'ExpensesController.findAll' },
                ],
              },
            }),
          );
        } else if (request.url === '/api/v1/msaidizi/ask') {
          response.end(
            JSON.stringify({
              data: {
                reason: 'end_turn',
                messages: [],
                events: [
                  { type: 'tool_call', tool: 'Expenses_findAll' },
                  { type: 'tool_result', tool: 'Expenses_findAll', ok: true, status: 200 },
                  { type: 'text', text: 'Fixture expense.' },
                ],
              },
            }),
          );
        } else {
          response.statusCode = 500;
          response.end('{}');
        }
      });
      await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
      try {
        const output = join(directory, `${scenario}.json`);
        const result = await new Promise((resolve, reject) => {
          const child = spawn(
            process.execPath,
            [fileURLToPath(new URL('./tool-search-compare.mjs', import.meta.url)), output],
            {
              windowsHide: true,
              timeout: 10_000,
              env: {
                ...process.env,
                MSAIDIZI_API: `http://127.0.0.1:${server.address().port}/api/v1`,
                SEED_ADMIN_EMAIL: 'fixture@example.com',
                SEED_ADMIN_PASSWORD: 'test-only-password',
                MSAIDIZI_BENCHMARK_CASE: 'spending',
                MSAIDIZI_BENCHMARK_REQUIRE_FAST_PATH: 'true',
              },
              stdio: 'ignore',
            },
          );
          child.once('error', reject);
          child.once('close', (code, signal) => resolve({ code, signal }));
        });
        assert.equal(result.signal, null, `${scenario} should not hang`);
        assert.equal(result.code === 0, scenario === 'read-only', scenario);
        assert.equal(paths.includes('/unexpected-credential-target'), false);
        assert.equal(
          paths.filter((path) => path.endsWith('/ask')).length,
          scenario === 'read-only' ? 1 : 0,
        );
        if (scenario === 'unhealthy') assert.deepEqual(paths, ['/api/v1/health/ready']);
        if (scenario === 'read-only') {
          const report = JSON.parse(await readFile(output, 'utf8'));
          assert.equal(report.cases[0].hit, true);
          assert.equal(report.cases[0].searchCalls, 0);
          assert.deepEqual(report.cases[0].called, ['Expenses_findAll']);
        }
      } finally {
        server.closeAllConnections();
        await new Promise((resolve) => server.close(resolve));
      }
    }
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
