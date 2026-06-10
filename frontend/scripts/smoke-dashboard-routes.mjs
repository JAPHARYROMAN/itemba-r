import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';

const APP_DIR = path.join(process.cwd(), 'src', 'app');
const FIXTURE_FILE = path.join(process.cwd(), 'scripts', 'route-smoke-fixtures.json');
const BASE_URL = process.env.FRONTEND_BASE_URL ?? 'http://localhost:3009';
const AUTH_COOKIE = process.env.ROUTE_SMOKE_AUTH_COOKIE ?? 'itemba_auth=1';
const CONCURRENCY = Number(process.env.ROUTE_SMOKE_CONCURRENCY ?? 8);
const MIN_PAGE_ROUTES = Number(process.env.ROUTE_SMOKE_MIN_PAGE_ROUTES ?? 190);

const ERROR_SIGNATURES = [
  'id="__next_error__"',
  'NEXT_HTTP_ERROR_FALLBACK;500',
  'Application error',
  'Internal Server Error',
];

function walk(dir, files = []) {
  for (const entry of readdirSync(dir)) {
    const absolute = path.join(dir, entry);
    if (statSync(absolute).isDirectory()) {
      walk(absolute, files);
    } else if (entry === 'page.tsx') {
      files.push(absolute);
    }
  }
  return files;
}

function routeFromPageFile(file) {
  const relativeDir = path.relative(APP_DIR, path.dirname(file));
  const segments = relativeDir
    .split(path.sep)
    .filter(Boolean)
    .filter((segment) => !(segment.startsWith('(') && segment.endsWith(')')));

  return `/${segments.join('/')}`.replace(/\/$/, '') || '/';
}

function routeKind(route) {
  return route.includes('[') ? 'dynamic' : 'static';
}

function loadDynamicFixtures() {
  const parsed = JSON.parse(readFileSync(FIXTURE_FILE, 'utf8'));
  return new Map(Object.entries(parsed));
}

async function mapLimit(items, limit, worker) {
  const results = new Array(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      for (;;) {
        const index = next;
        next += 1;
        if (index >= items.length) return;
        results[index] = await worker(items[index]);
      }
    }),
  );
  return results;
}

const pageRoutes = [...new Set(walk(APP_DIR).map(routeFromPageFile))].sort();
const staticRoutes = pageRoutes.filter((route) => routeKind(route) === 'static');
const dynamicRoutes = pageRoutes.filter((route) => routeKind(route) === 'dynamic');
const dynamicFixtures = loadDynamicFixtures();

const missingFixtures = dynamicRoutes.filter((route) => !dynamicFixtures.has(route));
const unusedFixtures = [...dynamicFixtures.keys()].filter(
  (route) => !dynamicRoutes.includes(route),
);
const invalidFixtures = [...dynamicFixtures.entries()].filter(
  ([, route]) => !route.startsWith('/') || route.includes('['),
);

if (pageRoutes.length < MIN_PAGE_ROUTES) {
  console.error(
    `frontend route smoke coverage too low: ${pageRoutes.length} page routes < ${MIN_PAGE_ROUTES}`,
  );
  process.exit(1);
}

if (missingFixtures.length || unusedFixtures.length || invalidFixtures.length) {
  console.error('frontend route smoke fixture manifest is out of sync');
  if (missingFixtures.length) console.table(missingFixtures.map((route) => ({ missing: route })));
  if (unusedFixtures.length) console.table(unusedFixtures.map((route) => ({ unused: route })));
  if (invalidFixtures.length) {
    console.table(invalidFixtures.map(([pattern, sample]) => ({ pattern, sample })));
  }
  process.exit(1);
}

const routes = [
  ...staticRoutes.map((route) => ({ pattern: route, route, kind: 'static' })),
  ...dynamicRoutes.map((pattern) => ({
    pattern,
    route: dynamicFixtures.get(pattern),
    kind: 'dynamic',
  })),
].sort((a, b) => a.route.localeCompare(b.route));

const results = await mapLimit(routes, CONCURRENCY, async (route) => {
  const url = new URL(route.route, BASE_URL);
  try {
    const response = await fetch(url, {
      headers: { cookie: AUTH_COOKIE },
      redirect: 'follow',
    });
    const html = await response.text();
    const errorSignature = ERROR_SIGNATURES.find((signature) => html.includes(signature));
    const statusOk =
      route.kind === 'dynamic'
        ? response.status === 200 || response.status === 404
        : response.status === 200;
    return {
      ...route,
      status: response.status,
      ok: statusOk && !errorSignature && html.trim().length > 0,
      error: errorSignature ? `Matched error signature: ${errorSignature}` : undefined,
    };
  } catch (error) {
    return {
      ...route,
      status: 0,
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
});

const failures = results.filter((result) => !result.ok);
if (failures.length > 0) {
  console.error(`frontend route smoke failed: ${failures.length}/${results.length}`);
  console.table(failures);
  process.exitCode = 1;
} else {
  console.log(
    `frontend route smoke: OK (${staticRoutes.length} static routes, ${dynamicRoutes.length} dynamic samples; dynamic samples validate rendering/404 tolerance, not real record correctness)`,
  );
}
