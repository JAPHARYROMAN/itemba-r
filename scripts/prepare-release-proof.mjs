import { randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve, dirname } from 'node:path';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const dir = resolve(root, '.release');
mkdirSync(dir, { recursive: true });
const envFile = resolve(dir, 'rehearsal.env');
if (existsSync(envFile)) {
  console.log('Reusing existing local release rehearsal configuration.');
} else {
  const secret = () => randomBytes(32).toString('hex');
  const password = secret();
  const env = {
    RELEASE_PROOF_PASSWORD: password,
    DATABASE_URL: `postgresql://itemba_proof:${password}@127.0.0.1:5549/itemba_release_proof?schema=public`,
    NODE_ENV: 'test',
    PORT: '3114',
    REDIS_HOST: '127.0.0.1',
    REDIS_PORT: '6399',
    REDIS_PASSWORD: '',
    JWT_ACCESS_SECRET: secret(),
    JWT_REFRESH_SECRET: secret(),
    TWO_FACTOR_ENCRYPTION_KEY: secret(),
    REFRESH_TOKEN_PEPPER: secret(),
    APP_ENCRYPTION_KEY: secret(),
    FRONTEND_URL: 'http://localhost:3109',
    CORS_ORIGIN: 'http://localhost:3109',
    BACKEND_INTERNAL_URL: 'http://127.0.0.1:3114/api/v1',
    MSAIDIZI_ENABLED: 'false',
    MSAIDIZI_AUTONOMY_ENABLED: 'false',
    MSAIDIZI_AUTOPILOT_ENABLED: 'false',
    MSAIDIZI_HOST_EXECUTION_ENABLED: 'false',
    MSAIDIZI_TASK_WORKER_ENABLED: 'false',
    MSAIDIZI_ADAPTIVE_REASONING_ENABLED: 'false',
    MSAIDIZI_UPDATE_EVALUATOR_ENABLED: 'false',
    MSAIDIZI_UPDATE_AUTOMATIC_ROLLOUT_ENABLED: 'false',
    MSAIDIZI_DEVICE_CHANNEL_ENABLED: 'false',
    ANTHROPIC_API_KEY: '',
    SMTP_HOST: '',
    SMTP_USER: '',
    SMTP_PASS: '',
    RELEASE_PROOF_USER_PASSWORD: secret(),
    THROTTLE_LIMIT: '100000',
  };
  writeFileSync(
    envFile,
    Object.entries(env)
      .map(([key, value]) => `${key}=${value}`)
      .join('\n') + '\n',
  );
  console.log('Created private .release/rehearsal.env. Credentials were not printed.');
}
