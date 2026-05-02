import { readdirSync, statSync } from 'node:fs';
import path from 'node:path';

const DASHBOARD_APP_DIR = path.join(process.cwd(), 'src', 'app', '(dashboard)');
const BASE_URL = process.env.FRONTEND_BASE_URL ?? 'http://localhost:3009';
const AUTH_COOKIE = process.env.ROUTE_SMOKE_AUTH_COOKIE ?? 'itemba_auth=1';
const CONCURRENCY = Number(process.env.ROUTE_SMOKE_CONCURRENCY ?? 8);

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
  const relativeDir = path.relative(DASHBOARD_APP_DIR, path.dirname(file));
  const segments = relativeDir
    .split(path.sep)
    .filter(Boolean)
    .filter((segment) => !(segment.startsWith('(') && segment.endsWith(')')));

  if (segments.some((segment) => segment.includes('['))) return null;
  return `/${segments.join('/')}`.replace(/\/$/, '') || '/';
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

const routes = [...new Set(walk(DASHBOARD_APP_DIR).map(routeFromPageFile).filter(Boolean))].sort();

const results = await mapLimit(routes, CONCURRENCY, async (route) => {
  const url = new URL(route, BASE_URL);
  try {
    const response = await fetch(url, {
      headers: { cookie: AUTH_COOKIE },
      redirect: 'manual',
    });
    return { route, status: response.status, ok: response.status === 200 };
  } catch (error) {
    return {
      route,
      status: 0,
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
});

const failures = results.filter((result) => !result.ok);
if (failures.length > 0) {
  console.error(`dashboard route smoke failed: ${failures.length}/${results.length}`);
  console.table(failures);
  process.exitCode = 1;
} else {
  console.log(`dashboard route smoke: OK (${results.length} static dashboard routes)`);
}
