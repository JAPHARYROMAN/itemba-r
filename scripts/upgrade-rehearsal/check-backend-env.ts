/**
 * Would the release's backend accept this environment?
 *
 *   node ... check-backend-env.ts < environment.json
 *
 * Reads a JSON object of environment variables on stdin (production's
 * resolved backend environment, see rehearse.sh) and runs the release's own
 * startup validation, envValidate from backend/src/config/env.validation.ts,
 * the same function ConfigModule runs before Nest starts. It starts nothing:
 * no database, queues, schedulers or providers, so production credentials are
 * never used. Prints VALID, or INVALID with the reason, and exits 0 or 1.
 *
 * Why: on 2026-09-24 a release booted fine in CI and migrated production,
 * then its backend refused production's settings (Msaidizi chat on without
 * provider-contract evidence) and the site was down until they changed.
 */
import { join } from 'node:path';

// The backend's own dependencies, loaded the way its main.ts does first.
const backend = join(__dirname, '..', '..', 'backend');
// eslint-disable-next-line @typescript-eslint/no-require-imports
require(require.resolve('reflect-metadata', { paths: [backend] }));
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { envValidate } = require(join(backend, 'src', 'config', 'env.validation'));

let input = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (chunk: string) => (input += chunk));
process.stdin.on('end', () => {
  let environment: Record<string, unknown>;
  try {
    environment = JSON.parse(input);
  } catch {
    console.log('INVALID: the environment on stdin is not JSON');
    process.exit(2);
  }
  try {
    envValidate(environment);
    console.log('VALID');
  } catch (error) {
    console.log(`INVALID: ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  }
});
