#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const args = new Set(process.argv.slice(2));

const targets = [
  {
    name: 'production',
    file: 'docker-compose.production.yml',
    expectedProjectName: 'itemba-r-prod',
    expectedNodeEnv: 'production',
  },
  {
    name: 'staging',
    file: 'docker-compose.staging.yml',
    expectedProjectName: 'itemba-r-staging',
    expectedNodeEnv: 'staging',
  },
].filter((target) => {
  if (args.has('--production-only')) {
    return target.name === 'production';
  }
  if (args.has('--staging-only')) {
    return target.name === 'staging';
  }
  return true;
});

const requiredSecretKeys = [
  'POSTGRES_PASSWORD',
  'REDIS_PASSWORD',
  'JWT_ACCESS_SECRET',
  'JWT_REFRESH_SECRET',
  'TWO_FACTOR_ENCRYPTION_KEY',
  'REFRESH_TOKEN_PEPPER',
  'APP_ENCRYPTION_KEY',
  'FRONTEND_URL',
  'APP_URL',
  'CORS_ORIGIN',
  'NEXT_PUBLIC_API_URL',
  'NEXT_PUBLIC_WEBSITE_URL',
  'APP_HOST',
  'API_HOST',
  'WEBSITE_HOST',
  'WEBSITE_WWW_HOST',
  'SEED_ADMIN_EMAIL',
  'SEED_ADMIN_PASSWORD',
];

const sampleEnv = {
  POSTGRES_DB: 'itemba_r_deploy_validation',
  POSTGRES_USER: 'itemba_deploy_validation',
  POSTGRES_PASSWORD: 'postgres-deploy-validation-secret-40',
  REDIS_PASSWORD: 'redis-deploy-validation-secret-40',
  JWT_ACCESS_SECRET: 'jwt-access-deploy-validation-secret-40',
  JWT_REFRESH_SECRET: 'jwt-refresh-deploy-validation-secret-40',
  TWO_FACTOR_ENCRYPTION_KEY: 'two-factor-deploy-validation-secret-40',
  REFRESH_TOKEN_PEPPER: 'refresh-pepper-deploy-validation-secret-40',
  APP_ENCRYPTION_KEY: 'app-encryption-deploy-validation-secret-40',
  FRONTEND_URL: 'https://app.validation.local',
  APP_URL: 'https://app.validation.local',
  CORS_ORIGIN: 'https://app.validation.local',
  NEXT_PUBLIC_API_URL: 'https://api.validation.local/api/v1',
  NEXT_PUBLIC_WEBSITE_URL: 'https://validation.local',
  BACKEND_INTERNAL_URL: 'http://backend:3001/api/v1',
  APP_HOST: 'app.validation.local',
  API_HOST: 'api.validation.local',
  WEBSITE_HOST: 'validation.local',
  WEBSITE_WWW_HOST: 'www.validation.local',
  ACME_EMAIL: 'ops@validation.local',
  JOB_WORKER_ENABLED: 'true',
  SEED_ADMIN_EMAIL: 'admin@validation.local',
  SEED_ADMIN_PASSWORD: 'seed-admin-deploy-validation-secret-40',
  SEED_DEMO_DATA: 'true',
};

const msaidiziInputMounts = [
  {
    hostEnv: 'MSAIDIZI_PROVIDER_CONTRACT_ATTESTATION_HOST_PATH',
    pathEnv: 'MSAIDIZI_PROVIDER_CONTRACT_ATTESTATION_PATH',
    target: '/run/msaidizi-provider-contract/attestation.json',
  },
  {
    hostEnv: 'MSAIDIZI_PROVIDER_CONTRACT_PUBLIC_KEY_HOST_PATH',
    pathEnv: 'MSAIDIZI_PROVIDER_CONTRACT_PUBLIC_KEY_PATH',
    target: '/run/msaidizi-provider-contract/public.pem',
  },
  {
    hostEnv: 'MSAIDIZI_ACTION_SIGNING_KEY_HOST_PATH',
    pathEnv: 'MSAIDIZI_ACTION_SIGNING_KEY_PATH',
    target: '/run/secrets/msaidizi-action-es256.pem',
  },
  {
    hostEnv: 'MSAIDIZI_UPDATE_SIGNING_KEY_HOST_PATH',
    pathEnv: 'MSAIDIZI_UPDATE_SIGNING_KEY_PATH',
    target: '/run/secrets/msaidizi-update-es256.pem',
  },
  {
    hostEnv: 'MSAIDIZI_RECOVERY_SIGNING_KEY_HOST_PATH',
    pathEnv: 'MSAIDIZI_RECOVERY_SIGNING_KEY_PATH',
    target: '/run/secrets/msaidizi-recovery-es256.pem',
  },
  {
    hostEnv: 'MSAIDIZI_EVALUATOR_KEY_ALLOWLIST_HOST_PATH',
    pathEnv: 'MSAIDIZI_EVALUATOR_KEY_ALLOWLIST_PATH',
    target: '/run/secrets/msaidizi-evaluator-keys.json',
  },
  {
    hostEnv: 'MSAIDIZI_EVALUATOR_MTLS_SERVER_KEY_HOST_PATH',
    pathEnv: 'MSAIDIZI_EVALUATOR_MTLS_SERVER_KEY_PATH',
    target: '/run/secrets/msaidizi-evaluator-server-key.pem',
  },
  {
    hostEnv: 'MSAIDIZI_EVALUATOR_MTLS_SERVER_CERT_HOST_PATH',
    pathEnv: 'MSAIDIZI_EVALUATOR_MTLS_SERVER_CERT_PATH',
    target: '/run/secrets/msaidizi-evaluator-server-cert.pem',
  },
  {
    hostEnv: 'MSAIDIZI_EVALUATOR_MTLS_CLIENT_CA_HOST_PATH',
    pathEnv: 'MSAIDIZI_EVALUATOR_MTLS_CLIENT_CA_PATH',
    target: '/run/secrets/msaidizi-evaluator-client-ca.pem',
  },
  {
    hostEnv: 'MSAIDIZI_DIRECT_MTLS_SERVER_KEY_HOST_PATH',
    pathEnv: 'MSAIDIZI_DIRECT_MTLS_SERVER_KEY_PATH',
    target: '/run/secrets/msaidizi-device-server-key.pem',
  },
  {
    hostEnv: 'MSAIDIZI_DIRECT_MTLS_SERVER_CERT_HOST_PATH',
    pathEnv: 'MSAIDIZI_DIRECT_MTLS_SERVER_CERT_PATH',
    target: '/run/secrets/msaidizi-device-server-cert.pem',
  },
  {
    hostEnv: 'MSAIDIZI_DIRECT_MTLS_CLIENT_CA_HOST_PATH',
    pathEnv: 'MSAIDIZI_DIRECT_MTLS_CLIENT_CA_PATH',
    target: '/run/secrets/msaidizi-device-client-ca.pem',
  },
  {
    hostEnv: 'MSAIDIZI_CRUD_EVIDENCE_HOST_PATH',
    pathEnv: 'MSAIDIZI_CRUD_EVIDENCE_PATH',
    target: '/run/msaidizi/crud-evidence.json',
  },
  {
    hostEnv: 'MSAIDIZI_CRUD_EVIDENCE_PUBLIC_KEY_HOST_PATH',
    pathEnv: 'MSAIDIZI_CRUD_EVIDENCE_PUBLIC_KEY_PATH',
    target: '/run/secrets/msaidizi-crud-evidence-public.pem',
  },
];

const configuredMsaidiziHostInputs = Object.fromEntries(
  msaidiziInputMounts.map(({ hostEnv, target }) => [
    hostEnv,
    `/operator/itemba-msaidizi${target}`,
  ]),
);

const substitutedMsaidiziContainerPaths = Object.fromEntries(
  msaidiziInputMounts.map(({ pathEnv, target }) => [pathEnv, `/unreviewed${target}`]),
);

const msaidiziEnableSwitches = [
  'MSAIDIZI_ENABLED',
  'MSAIDIZI_AUTONOMY_ENABLED',
  'MSAIDIZI_TASK_WORKER_ENABLED',
  'MSAIDIZI_AUTOPILOT_ENABLED',
  'MSAIDIZI_HOST_EXECUTION_ENABLED',
  'MSAIDIZI_ADAPTIVE_REASONING_ENABLED',
  'MSAIDIZI_DEVICE_PAIRING_ENABLED',
  'MSAIDIZI_DEVICE_CHANNEL_ENABLED',
  'MSAIDIZI_DIRECT_MTLS_ENABLED',
  'MSAIDIZI_SUPERVISOR_ENROLLMENT_ENABLED',
  'MSAIDIZI_UPDATE_SUPERVISOR_ENABLED',
  'MSAIDIZI_UPDATE_AUTOMATIC_ROLLOUT_ENABLED',
  'MSAIDIZI_UPDATE_EVALUATOR_ENABLED',
  'MSAIDIZI_EVALUATOR_MTLS_ENABLED',
  'MSAIDIZI_RECOVERY_SUPERVISOR_ENABLED',
  'MSAIDIZI_AUDIT_SIGNER_ENABLED',
];

const tempDir = mkdtempSync(join(tmpdir(), 'itemba-deploy-validate-'));
const emptyEnvFile = join(tempDir, 'empty.env');
writeFileSync(emptyEnvFile, '', 'utf8');

try {
  for (const target of targets) {
    validateMissingSecretsFail(target);
    const config = validateConfigPasses(target);
    assertDeploymentShape(target, config);
    if (target.name === 'production') {
      const configuredInputs = validateConfigPasses(target, configuredMsaidiziHostInputs);
      assertMsaidiziInputMounts(target, configuredInputs.services?.backend, configuredMsaidiziHostInputs);
      const substitutedPaths = validateConfigPasses(target, substitutedMsaidiziContainerPaths);
      assertMsaidiziInputMounts(
        target,
        substitutedPaths.services?.backend,
        {},
        'when a direct container-path substitution is attempted',
      );
      const configuredWithSubstitution = validateConfigPasses(target, {
        ...configuredMsaidiziHostInputs,
        ...substitutedMsaidiziContainerPaths,
      });
      assertMsaidiziInputMounts(
        target,
        configuredWithSubstitution.services?.backend,
        configuredMsaidiziHostInputs,
      );
    }
    console.log(`OK ${target.name}: compose fail-fast and deployment shape verified`);
  }
  assertProductionDeploymentWorkflow();
} finally {
  rmSync(tempDir, { recursive: true, force: true });
}

function composeConfig(target, extraEnv = {}) {
  const env = {
    ...process.env,
    ...extraEnv,
  };

  for (const key of Object.keys(env)) {
    if (
      key.startsWith('MSAIDIZI_') &&
      !Object.prototype.hasOwnProperty.call(extraEnv, key)
    ) {
      delete env[key];
    }
  }

  for (const key of requiredSecretKeys) {
    if (!Object.prototype.hasOwnProperty.call(extraEnv, key)) {
      delete env[key];
    }
  }

  return spawnSync(
    'docker',
    [
      'compose',
      '--env-file',
      emptyEnvFile,
      '-f',
      resolve(rootDir, target.file),
      '--profile',
      'seed',
      'config',
      '--format',
      'json',
    ],
    {
      cwd: rootDir,
      env,
      encoding: 'utf8',
      windowsHide: true,
    },
  );
}

function validateMissingSecretsFail(target) {
  const result = composeConfig(target);

  if (result.error) {
    fail(`${target.name}: unable to run docker compose: ${result.error.message}`);
  }

  if (result.status === 0) {
    fail(`${target.name}: compose accepted missing required secrets`);
  }
}

function validateConfigPasses(target, extraEnv = {}) {
  const result = composeConfig(target, { ...sampleEnv, ...extraEnv });

  if (result.error) {
    fail(`${target.name}: unable to run docker compose: ${result.error.message}`);
  }

  if (result.status !== 0) {
    fail(
      `${target.name}: compose config failed with required secrets supplied\n${result.stderr || result.stdout}`,
    );
  }

  try {
    return JSON.parse(result.stdout);
  } catch (error) {
    fail(`${target.name}: compose config did not produce valid JSON: ${error.message}`);
  }
}

function assertDeploymentShape(target, config) {
  assertEqual(target, config.name, target.expectedProjectName, 'project name');

  const services = config.services ?? {};
  for (const serviceName of [
    'caddy',
    'postgres',
    'redis',
    'backend-migrate',
    'backend-seed',
    'backend',
    'frontend',
    'website',
  ]) {
    assert(target, services[serviceName], `service "${serviceName}" is present`);
  }

  const caddy = services.caddy;
  const backend = services.backend;
  const migrate = services['backend-migrate'];
  const seed = services['backend-seed'];
  const frontend = services.frontend;
  const website = services.website;
  const redis = services.redis;

  assertEqual(target, migrate.build?.target, 'migration', 'backend-migrate uses migration target');
  assertEqual(target, seed.build?.target, 'migration', 'backend-seed uses migration target');
  assert(
    target,
    flatten(seed.command).includes('npm run db:seed'),
    'backend-seed runs the database seed command',
  );
  assertEqual(target, backend.build?.target, 'production', 'backend uses production target');
  assertEqual(target, frontend.build?.target, 'runner', 'frontend uses runner target');
  assert(target, website.build, 'website has build configuration');

  assertEqual(
    target,
    backend.depends_on?.['backend-migrate']?.condition,
    'service_completed_successfully',
    'backend waits for successful migrations',
  );
  assertEqual(
    target,
    backend.depends_on?.redis?.condition,
    'service_healthy',
    'backend waits for healthy redis',
  );
  assertEqual(
    target,
    frontend.depends_on?.backend?.condition,
    'service_healthy',
    'frontend waits for healthy backend',
  );
  assertEqual(
    target,
    caddy.depends_on?.frontend?.condition,
    'service_healthy',
    'caddy waits for healthy frontend',
  );
  assertEqual(
    target,
    caddy.depends_on?.backend?.condition,
    'service_healthy',
    'caddy waits for healthy backend',
  );
  assertEqual(
    target,
    caddy.depends_on?.website?.condition,
    'service_healthy',
    'caddy waits for healthy website',
  );

  assertEqual(target, backend.environment?.NODE_ENV, target.expectedNodeEnv, 'backend NODE_ENV');
  assertEqual(
    target,
    migrate.environment?.NODE_ENV,
    target.expectedNodeEnv,
    'backend-migrate NODE_ENV',
  );
  assertEqual(target, seed.environment?.NODE_ENV, target.expectedNodeEnv, 'backend-seed NODE_ENV');

  for (const envKey of [
    'DATABASE_URL',
    'JWT_ACCESS_SECRET',
    'JWT_REFRESH_SECRET',
    'TWO_FACTOR_ENCRYPTION_KEY',
    'REFRESH_TOKEN_PEPPER',
    'APP_ENCRYPTION_KEY',
    'FRONTEND_URL',
    'APP_URL',
    'CORS_ORIGIN',
    'REDIS_PASSWORD',
  ]) {
    assert(target, migrate.environment?.[envKey], `backend-migrate has ${envKey}`);
    assert(target, seed.environment?.[envKey], `backend-seed has ${envKey}`);
    assert(target, backend.environment?.[envKey], `backend has ${envKey}`);
  }

  for (const envKey of ['SEED_ADMIN_EMAIL', 'SEED_ADMIN_PASSWORD', 'SEED_DEMO_DATA']) {
    assert(target, seed.environment?.[envKey], `backend-seed has ${envKey}`);
  }

  for (const envKey of [
    'FRONTEND_URL',
    'APP_URL',
    'CORS_ORIGIN',
    'REDIS_PASSWORD',
    'JOB_WORKER_ENABLED',
    'STORAGE_LOCAL_PATH',
    'BACKUP_STORAGE_PATH',
    'BACKUPS_DIR',
  ]) {
    assert(target, backend.environment?.[envKey], `backend has ${envKey}`);
  }

  for (const envKey of [
    'SMTP_HOST',
    'SMTP_PORT',
    'SMTP_SECURE',
    'SMTP_USER',
    'SMTP_PASS',
    'SMTP_FROM',
    'AT_API_KEY',
    'AT_USERNAME',
    'MPESA_CONSUMER_KEY',
    'MPESA_CONSUMER_SECRET',
  ]) {
    assert(
      target,
      Object.prototype.hasOwnProperty.call(backend.environment ?? {}, envKey),
      `backend declares optional external integration env ${envKey}`,
    );
  }

  const backendVolumes = (backend.volumes ?? []).map((volume) => volume.target ?? '');
  assert(target, backendVolumes.includes('/app/storage'), 'backend mounts persistent file storage');
  assert(target, backendVolumes.includes('/app/backups'), 'backend mounts persistent backups');
  if (target.name === 'production') {
    for (const envKey of [
      ...msaidiziEnableSwitches,
      'MSAIDIZI_WRITE_MODE',
      'MSAIDIZI_SUPERVISOR_ENROLLMENT_PEPPER',
      'MSAIDIZI_SUPERVISOR_ENROLLMENT_TTL_SECONDS',
      'MSAIDIZI_PROVIDER_CONTRACT_ATTESTATION_PATH',
      'MSAIDIZI_PROVIDER_CONTRACT_PUBLIC_KEY_PATH',
      'MSAIDIZI_PROVIDER_CONTRACT_KEY_ID',
      'MSAIDIZI_PROVIDER_CONTRACT_ATTESTATION_SHA256',
      'MSAIDIZI_PROVIDER_CONTRACT_SIGNER_SPKI_SHA256',
      'MSAIDIZI_PROVIDER_ACCOUNT_ID',
      'MSAIDIZI_PROVIDER_CREDENTIAL_KEY_ID',
      'MSAIDIZI_AUDIT_SIGNER_KILL_SWITCH',
      'MSAIDIZI_AUDIT_SIGNER_KEY_ID',
      'MSAIDIZI_AUDIT_SIGNER_CLIENT_CERT_SHA256',
      'MSAIDIZI_AUDIT_SIGNER_CLIENT_SPKI_SHA256',
      'MSAIDIZI_AUDIT_SIGNER_MAX_SEGMENT_EVENTS',
      'MSAIDIZI_AUDIT_SIGNER_CHECKPOINT_TTL_SECONDS',
      'MSAIDIZI_AUDIT_SIGNER_MAX_CLOCK_SKEW_SECONDS',
      'MSAIDIZI_UPDATE_RING_0_MIN_DWELL_SECONDS',
      'MSAIDIZI_UPDATE_RING_5_MIN_DWELL_SECONDS',
      'MSAIDIZI_UPDATE_RING_25_MIN_DWELL_SECONDS',
      'MSAIDIZI_UPDATE_RING_100_MIN_DWELL_SECONDS',
      'MSAIDIZI_CRUD_EVIDENCE_PATH',
      'MSAIDIZI_CRUD_EVIDENCE_PUBLIC_KEY_PATH',
      'MSAIDIZI_CRUD_EVIDENCE_KEY_ID',
      'MSAIDIZI_CRUD_EVIDENCE_APPLICATION_BUILD_DIGEST',
      'MSAIDIZI_CRUD_EVIDENCE_PRISMA_SCHEMA_MIGRATION_DIGEST',
      'MSAIDIZI_CRUD_EVIDENCE_MAX_AGE_HOURS',
    ]) {
      assert(
        target,
        Object.prototype.hasOwnProperty.call(backend.environment ?? {}, envKey),
        `backend forwards ${envKey}`,
      );
    }
    for (const envKey of msaidiziEnableSwitches) {
      assertEqual(target, backend.environment?.[envKey], 'false', `${envKey} safe default`);
    }
    assertEqual(
      target,
      backend.environment?.MSAIDIZI_WRITE_MODE,
      'read-only',
      'MSAIDIZI_WRITE_MODE safe default',
    );
    assert(
      target,
      String(backend.environment?.MSAIDIZI_ARTIFACT_ROOT ?? '').startsWith('/app/storage/'),
      'Msaidizi artifact root remains under persistent backend storage',
    );
    assertMsaidiziInputMounts(target, backend, {});
  } else {
    for (const { target: inputTarget } of msaidiziInputMounts) {
      assert(
        target,
        !backendVolumes.includes(inputTarget),
        `staging behavior excludes production operator input mount ${inputTarget}`,
      );
    }
  }

  assert(target, redis.environment?.REDIS_PASSWORD, 'redis has password environment');
  assert(
    target,
    flatten(redis.command).includes('--requirepass'),
    'redis requires password at startup',
  );
  assert(
    target,
    flatten(redis.healthcheck?.test).includes('REDISCLI_AUTH'),
    'redis healthcheck authenticates',
  );

  assert(
    target,
    frontend.build?.args?.NEXT_PUBLIC_API_URL,
    'frontend build receives NEXT_PUBLIC_API_URL',
  );
  assert(
    target,
    frontend.build?.args?.NEXT_PUBLIC_WEBSITE_URL,
    'frontend build receives NEXT_PUBLIC_WEBSITE_URL',
  );
  assert(
    target,
    frontend.build?.args?.BACKEND_INTERNAL_URL,
    'frontend build receives BACKEND_INTERNAL_URL',
  );
  assert(target, frontend.environment?.BACKEND_INTERNAL_URL, 'frontend has internal backend URL');
  assert(target, frontend.environment?.NEXT_PUBLIC_API_URL, 'frontend has public API URL');
  assert(target, frontend.environment?.NEXT_PUBLIC_WEBSITE_URL, 'frontend has public website URL');
  assert(target, caddy.environment?.APP_HOST, 'caddy has frontend hostname');
  assert(target, caddy.environment?.API_HOST, 'caddy has API hostname');
  assert(target, caddy.environment?.WEBSITE_HOST, 'caddy has website hostname');
  assert(target, caddy.environment?.WEBSITE_WWW_HOST, 'caddy has website www hostname');
  assert(target, caddy.environment?.ACME_EMAIL, 'caddy has ACME email');

  const caddyPorts = (caddy.ports ?? []).map((port) =>
    String(port.published ?? port.target ?? port),
  );
  assert(target, caddyPorts.includes('80'), 'caddy publishes HTTP port 80');
  assert(target, caddyPorts.includes('443'), 'caddy publishes HTTPS port 443');

  // The ordinary API remains reachable only through Caddy. The autonomous
  // update evaluator has a separate mTLS listener that is intentionally
  // published to the host loopback interface so the isolated verifier can
  // reach it without joining the application network. Accept exactly that one
  // binding; a wildcard/public bind or a second backend port is a release
  // failure.
  const evaluatorPort = String(backend.environment?.MSAIDIZI_EVALUATOR_MTLS_PORT ?? '');
  const backendPorts = backend.ports ?? [];
  assert(
    target,
    backendPorts.length === 1,
    'backend publishes only the dedicated evaluator mTLS port',
  );
  const evaluatorBinding = backendPorts[0] ?? {};
  assertEqual(
    target,
    String(evaluatorBinding.target ?? ''),
    evaluatorPort,
    'evaluator mTLS target port',
  );
  assertEqual(
    target,
    String(evaluatorBinding.published ?? ''),
    evaluatorPort,
    'evaluator mTLS published port',
  );
  assertEqual(target, evaluatorBinding.host_ip, '127.0.0.1', 'evaluator mTLS host bind address');
  assertEqual(target, evaluatorBinding.protocol, 'tcp', 'evaluator mTLS transport');
  assert(target, !(frontend.ports ?? []).length, 'frontend does not publish a public port');
  assert(
    target,
    (backend.expose ?? []).map(String).includes('3001'),
    'backend exposes port 3001 internally',
  );
  assert(
    target,
    (backend.expose ?? []).map(String).includes(evaluatorPort),
    'backend exposes the dedicated evaluator mTLS port',
  );
  assert(
    target,
    (frontend.expose ?? []).map(String).includes('3000'),
    'frontend exposes port 3000 internally',
  );
  assert(
    target,
    (website.expose ?? []).map(String).includes('3001'),
    'website exposes port 3001 internally',
  );

  for (const serviceName of ['caddy', 'postgres', 'redis', 'backend', 'frontend', 'website']) {
    assert(target, services[serviceName].healthcheck?.test, `${serviceName} has a healthcheck`);
  }

  const backendHealthcheck = flatten(backend.healthcheck?.test);
  assert(
    target,
    backendHealthcheck.includes('node -e') &&
      backendHealthcheck.includes('MSAIDIZI_DIRECT_MTLS_ENABLED') &&
      backendHealthcheck.includes("require(t?'https':'http').get"),
    'backend healthcheck follows the configured HTTP or HTTPS transport',
  );
  assert(
    target,
    backendHealthcheck.includes('/api/v1/health/ready'),
    'backend healthcheck probes the readiness endpoint',
  );

  const frontendHealthcheck = flatten(frontend.healthcheck?.test);
  assert(
    target,
    frontendHealthcheck.includes('node -e') && frontendHealthcheck.includes('fetch('),
    'frontend healthcheck uses Node fetch',
  );
  assert(
    target,
    frontendHealthcheck.includes('127.0.0.1:3000/api/health'),
    'frontend healthcheck probes the dedicated health route',
  );

  const websiteHealthcheck = flatten(website.healthcheck?.test);
  assert(
    target,
    websiteHealthcheck.includes('node -e') && websiteHealthcheck.includes('fetch('),
    'website healthcheck uses Node fetch',
  );
  assert(
    target,
    websiteHealthcheck.includes('127.0.0.1:3001/api/health'),
    'website healthcheck probes the dedicated health route',
  );

  const caddyHealthcheck = flatten(caddy.healthcheck?.test);
  assert(
    target,
    caddyHealthcheck.includes('wget -qO-') && caddyHealthcheck.includes('127.0.0.1:2019/config'),
    'caddy healthcheck probes the admin config endpoint',
  );
}

function assertMsaidiziInputMounts(target, backend, expectedSources, unsetReason = 'by default') {
  const volumes = backend?.volumes ?? [];
  for (const { hostEnv, pathEnv, target: inputTarget } of msaidiziInputMounts) {
    const matches = volumes.filter((volume) => volume.target === inputTarget);
    assert(target, matches.length === 1, `exactly one mount covers ${inputTarget}`);
    const mount = matches[0] ?? {};
    assertEqual(target, mount.type, 'bind', `${inputTarget} uses a bind mount`);
    assertEqual(
      target,
      mount.source,
      expectedSources[hostEnv] ?? '/dev/null',
      `${inputTarget} source`,
    );
    assertEqual(target, mount.read_only, true, `${inputTarget} is read-only`);
    assertEqual(
      target,
      mount.bind?.create_host_path,
      false,
      `${inputTarget} refuses implicit host-path creation`,
    );
    if (Object.prototype.hasOwnProperty.call(expectedSources, hostEnv)) {
      assertEqual(
        target,
        backend?.environment?.[pathEnv],
        inputTarget,
        `${pathEnv} resolves to its fixed container mount`,
      );
    } else {
      assertEqual(target, backend?.environment?.[pathEnv], '', `${pathEnv} stays unset ${unsetReason}`);
    }
  }
}

function assertProductionDeploymentWorkflow() {
  const target = { name: 'production workflow' };
  const workflow = readFileSync(
    resolve(rootDir, '.github', 'workflows', 'deploy-production.yml'),
    'utf8',
  );
  const postureDeclaration = `POSTURE_KEYS='${msaidiziEnableSwitches.join(' ')}'`;
  const postureStart = workflow.indexOf(postureDeclaration);
  const switchRejection = workflow.indexOf('if [ "$VALUE" != "false" ]; then', postureStart);
  const switchExit = workflow.indexOf('exit 1', switchRejection);
  const modeRead = workflow.indexOf(
    'MODE="$($COMPOSE exec -T backend printenv MSAIDIZI_WRITE_MODE </dev/null || echo unset)"',
    postureStart,
  );
  const modeRejection = workflow.indexOf('if [ "$MODE" != "read-only" ]; then', modeRead);
  const modeExit = workflow.indexOf('exit 1', modeRejection);
  const sentinel = workflow.indexOf('echo "--- verification complete ---"', postureStart);
  assert(target, postureStart >= 0, 'declares the exact independent-switch allowlist');
  assert(
    target,
    workflow.includes('VALUE="$($COMPOSE exec -T backend printenv "$KEY" </dev/null || echo unset)"'),
    'maps a missing or unreadable switch to an unsafe value',
  );
  assert(target, switchRejection > postureStart, 'rejects every switch not exactly false');
  assert(target, switchExit > switchRejection && switchExit < modeRead, 'switch rejection exits nonzero');
  assert(target, modeRead > switchExit, 'reads write mode after all independent switches');
  assert(target, modeRejection > modeRead, 'rejects write mode unless exactly read-only');
  assert(target, modeExit > modeRejection && modeExit < sentinel, 'write-mode rejection exits nonzero');
  assert(target, sentinel > modeExit, 'posture rejection runs before the completion sentinel');

  const relaunch = readFileSync(resolve(rootDir, 'deploy', 'relaunch', 'deploy.sh'), 'utf8');
  const preflightDeclaration = `MSAIDIZI_DARK_SWITCHES='${msaidiziEnableSwitches.join(' ')}'`;
  const resolvedConfig = relaunch.indexOf(
    'docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" config >/dev/null',
  );
  const preflightStart = relaunch.indexOf(preflightDeclaration);
  const pythonDependency = relaunch.indexOf('command -v python3', preflightStart);
  const preflightConfig = relaunch.indexOf('config --format json', pythonDependency);
  const exactSwitchDecision = relaunch.indexOf('environment.get(key) != "false"', preflightConfig);
  const exactModeDecision = relaunch.indexOf('mode != "read-only"', exactSwitchDecision);
  const firstComposeUp = relaunch.indexOf(
    'docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" up',
    exactModeDecision,
  );
  const firstMigration = relaunch.indexOf('prisma migrate', exactModeDecision);
  assert(target, relaunch.indexOf('set -euo pipefail') >= 0, 'relaunch uses pipeline failure propagation');
  assert(target, resolvedConfig >= 0, 'relaunch validates Compose before posture preflight');
  assert(target, preflightStart > resolvedConfig, 'relaunch declares the exact dark switch set after config');
  assert(target, pythonDependency > preflightStart, 'relaunch fails closed when python3 is unavailable');
  assert(target, preflightConfig > pythonDependency, 'relaunch parses resolved Compose JSON');
  assert(target, exactSwitchDecision > preflightConfig, 'relaunch rejects switches not exactly false');
  assert(target, exactModeDecision > exactSwitchDecision, 'relaunch rejects mode not exactly read-only');
  assert(
    target,
    firstComposeUp > exactModeDecision,
    'relaunch posture preflight runs before the first Compose up',
  );
  assert(
    target,
    firstMigration === -1 || firstMigration > exactModeDecision,
    'relaunch posture preflight runs before migration',
  );

  const safe = Object.fromEntries(msaidiziEnableSwitches.map((key) => [key, 'false']));
  safe.MSAIDIZI_WRITE_MODE = 'read-only';
  assert(target, isSafeMsaidiziPosture(safe), 'negative-control baseline accepts exact dark posture');
  for (const key of msaidiziEnableSwitches) {
    assert(
      target,
      !isSafeMsaidiziPosture({ ...safe, [key]: 'true' }),
      `negative control rejects ${key}=true`,
    );
    const missing = { ...safe };
    delete missing[key];
    assert(
      target,
      !isSafeMsaidiziPosture(missing),
      `negative control rejects missing ${key}`,
    );
  }
  for (const mode of ['amber', 'red', 'unset', 'READ-ONLY']) {
    assert(
      target,
      !isSafeMsaidiziPosture({ ...safe, MSAIDIZI_WRITE_MODE: mode }),
      `negative control rejects write mode ${mode}`,
    );
  }
  console.log(
    'OK production workflow: pre/post-deploy dark posture and negative controls verified',
  );
}

function isSafeMsaidiziPosture(values) {
  return (
    msaidiziEnableSwitches.every((key) => values[key] === 'false') &&
    values.MSAIDIZI_WRITE_MODE === 'read-only'
  );
}

function flatten(value) {
  if (Array.isArray(value)) {
    return value.join(' ');
  }
  return String(value ?? '');
}

function assertEqual(target, actual, expected, label) {
  assert(target, actual === expected, `${label}: expected ${expected}, got ${actual}`);
}

function assert(target, condition, label) {
  if (!condition) {
    fail(`${target.name}: ${label}`);
  }
}

function fail(message) {
  console.error(message);
  process.exit(1);
}
