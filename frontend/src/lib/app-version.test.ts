import { createRequire } from 'node:module';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

// next.config.js stamps the version the POS settings show ("Toleo la
// programu"), which read "—" while nothing set it (UI review finding 31).
const require = createRequire(import.meta.url);
const configPath = join(__dirname, '../../next.config.js');
const { version } = require('../../package.json') as { version: string };
const KEYS = ['APP_BUILD_SHA', 'VERCEL_GIT_COMMIT_SHA', 'NEXT_PUBLIC_APP_VERSION'] as const;
// Only these keys are touched and restored: process.env itself is shared with
// the other test files in this worker, so it is never replaced.
const saved = Object.fromEntries(KEYS.map((key) => [key, process.env[key]]));

function loadVersion(env: Record<string, string | undefined>): string {
  for (const key of KEYS) delete process.env[key];
  Object.assign(process.env, env);
  delete require.cache[require.resolve(configPath)];
  return (require(configPath) as { env: Record<string, string> }).env.NEXT_PUBLIC_APP_VERSION;
}

afterEach(() => {
  for (const key of KEYS) {
    if (saved[key] === undefined) delete process.env[key];
    else process.env[key] = saved[key];
  }
  delete require.cache[require.resolve(configPath)];
});

describe('the app version baked into the frontend build', () => {
  it('is the package version and the deploy-provided commit', () => {
    expect(loadVersion({ APP_BUILD_SHA: 'abcdef1234567' })).toBe(`${version} (abcdef12)`);
  });

  it('uses Vercel’s commit when the deploy gives none', () => {
    expect(loadVersion({ VERCEL_GIT_COMMIT_SHA: '0123456789ab' })).toBe(`${version} (01234567)`);
  });

  it('never ends up empty, and an explicit value wins', () => {
    expect(loadVersion({})).toMatch(new RegExp(`^${version.replace(/\./g, '\.')}`));
    expect(loadVersion({ NEXT_PUBLIC_APP_VERSION: '2.0.0-pilot' })).toBe('2.0.0-pilot');
  });
});
