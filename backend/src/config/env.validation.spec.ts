import 'reflect-metadata';
import { resolve } from 'node:path';
import { FORBIDDEN_ANTHROPIC_SDK_ENVIRONMENT_OVERRIDES } from '../modules/msaidizi/provider-contract-attestation.protocol';
import { envValidate } from './env.validation';

const STRONG_SECRET = 'a'.repeat(40);
const ANOTHER_STRONG_SECRET = 'b'.repeat(40);
const STRONG_2FA = 'c'.repeat(40);
const STRONG_APP_ENC = 'd'.repeat(40);
const STRONG_PEPPER = 'e'.repeat(40);
const ABSOLUTE_EVIDENCE_PATH = resolve('test-fixtures/crud-evidence.json');
const ABSOLUTE_EVIDENCE_PUBLIC_KEY_PATH = resolve('test-fixtures/crud-evidence-public.pem');
const EVIDENCE_BUILD_DIGEST = 'f'.repeat(64);
const EVIDENCE_PRISMA_DIGEST = 'a'.repeat(64);
const ACCEPTED_IMAGE_DIGEST = `sha256:${'1'.repeat(64)}`;
const PROTECTED_RELEASE_CONFIG = {
  MSAIDIZI_PRODUCTION_PROMOTION_INVENTORY_PATH: resolve(
    'operator-evidence/msaidizi-promotion-inventory.json',
  ),
  MSAIDIZI_PRODUCTION_ACCEPTED_INVENTORY_SHA256: '2'.repeat(64),
  MSAIDIZI_PRODUCTION_ACCEPTED_EVIDENCE_SHA256: '3'.repeat(64),
  MSAIDIZI_PRODUCTION_ACCEPTED_IMAGE_DIGEST: ACCEPTED_IMAGE_DIGEST,
  MSAIDIZI_DEPLOYED_BACKEND_IMAGE_REFERENCE: `ghcr.io/itemba/itemba-r-backend@${ACCEPTED_IMAGE_DIGEST}`,
  MSAIDIZI_DEPLOYED_SOURCE_COMMIT: '4'.repeat(40),
  MSAIDIZI_DEPLOYED_SOURCE_REPOSITORY: 'itemba/itemba-r',
};
const ABSOLUTE_EVALUATOR_ALLOWLIST = resolve('operator-secrets/msaidizi-evaluator-keys.json');
const ABSOLUTE_ARTIFACT_ROOT = resolve('operator-storage/msaidizi-artifacts');
const ARTIFACT_KEY = Buffer.alloc(32, 7).toString('base64');
const EVALUATOR_TRANSPORT = {
  MSAIDIZI_EVALUATOR_MTLS_ENABLED: 'true',
  MSAIDIZI_EVALUATOR_MTLS_PORT: '3444',
  MSAIDIZI_EVALUATOR_MTLS_SERVER_KEY_PATH: resolve('operator-secrets/evaluator-server-key.pem'),
  MSAIDIZI_EVALUATOR_MTLS_SERVER_CERT_PATH: resolve('operator-secrets/evaluator-server-cert.pem'),
  MSAIDIZI_EVALUATOR_MTLS_CLIENT_CA_PATH: resolve('operator-secrets/evaluator-client-ca.pem'),
  MSAIDIZI_EVALUATOR_CLIENT_CERT_SHA256: 'b'.repeat(64),
  MSAIDIZI_EVALUATOR_CLIENT_SPKI_SHA256: 'c'.repeat(64),
};
const PROVIDER_CONTRACT_CONFIG = {
  MSAIDIZI_PROVIDER_CONTRACT_ATTESTATION_PATH: resolve(
    '..',
    'operator-evidence/msaidizi-provider-contract.json',
  ),
  MSAIDIZI_PROVIDER_CONTRACT_PUBLIC_KEY_PATH: resolve(
    '..',
    'operator-evidence/msaidizi-provider-contract-public.pem',
  ),
  MSAIDIZI_PROVIDER_CONTRACT_KEY_ID: 'provider-contract-2026-01',
  MSAIDIZI_PROVIDER_CONTRACT_ATTESTATION_SHA256: 'd'.repeat(64),
  MSAIDIZI_PROVIDER_CONTRACT_SIGNER_SPKI_SHA256: 'e'.repeat(64),
  MSAIDIZI_PROVIDER_ACCOUNT_ID: 'org-itemba-production',
  MSAIDIZI_PROVIDER_CREDENTIAL_KEY_ID: 'anthropic-prod/key-v17',
};

describe('envValidate', () => {
  const baseValid = {
    DATABASE_URL: 'postgres://localhost/itemba',
    JWT_ACCESS_SECRET: STRONG_SECRET,
    JWT_REFRESH_SECRET: ANOTHER_STRONG_SECRET,
  };

  const validProductionExtras = {
    TWO_FACTOR_ENCRYPTION_KEY: STRONG_2FA,
    APP_ENCRYPTION_KEY: STRONG_APP_ENC,
    REFRESH_TOKEN_PEPPER: STRONG_PEPPER,
    REDIS_PASSWORD: 'redis-production-secret',
    CORS_ORIGIN: 'https://app.itembagrouptz.com',
    FRONTEND_URL: 'https://app.itembagrouptz.com',
    APP_URL: 'https://app.itembagrouptz.com',
    STORAGE_LOCAL_PATH: '/var/lib/itemba-r/storage',
    BACKUPS_DIR: '/var/lib/itemba-r/backups',
    EXPORTS_DIR: '/var/lib/itemba-r/exports',
  };

  it('accepts a minimal valid development config', () => {
    expect(() => envValidate({ ...baseValid, NODE_ENV: 'development' })).not.toThrow();
  });

  it('requires direct mTLS and independently derived pins for the trusted audit signer', () => {
    expect(() =>
      envValidate({
        ...baseValid,
        NODE_ENV: 'development',
        MSAIDIZI_AUDIT_SIGNER_ENABLED: 'true',
      }),
    ).toThrow(/Missing trusted audit-signer configuration/);

    expect(() =>
      envValidate({
        ...baseValid,
        NODE_ENV: 'development',
        MSAIDIZI_AUDIT_SIGNER_ENABLED: 'true',
        MSAIDIZI_AUDIT_SIGNER_KEY_ID: 'audit-signer-1',
        MSAIDIZI_AUDIT_SIGNER_CLIENT_CERT_SHA256: 'a'.repeat(64),
        MSAIDIZI_AUDIT_SIGNER_CLIENT_SPKI_SHA256: 'b'.repeat(64),
      }),
    ).toThrow(/direct-mTLS listener/);

    expect(() =>
      envValidate({
        ...baseValid,
        NODE_ENV: 'development',
        MSAIDIZI_AUDIT_SIGNER_ENABLED: 'true',
        MSAIDIZI_AUDIT_SIGNER_KEY_ID: 'audit-signer-1',
        MSAIDIZI_AUDIT_SIGNER_CLIENT_CERT_SHA256: 'a'.repeat(64),
        MSAIDIZI_AUDIT_SIGNER_CLIENT_SPKI_SHA256: 'b'.repeat(64),
        MSAIDIZI_DIRECT_MTLS_ENABLED: 'true',
        MSAIDIZI_DIRECT_MTLS_SERVER_KEY_PATH: resolve('operator-secrets/server-key.pem'),
        MSAIDIZI_DIRECT_MTLS_SERVER_CERT_PATH: resolve('operator-secrets/server-cert.pem'),
        MSAIDIZI_DIRECT_MTLS_CLIENT_CA_PATH: resolve('operator-secrets/client-ca.pem'),
      }),
    ).not.toThrow();
  });

  it('requires a distinct strong pepper and direct mTLS for supervisor enrollment', () => {
    expect(() =>
      envValidate({
        ...baseValid,
        NODE_ENV: 'development',
        MSAIDIZI_SUPERVISOR_ENROLLMENT_ENABLED: 'true',
      }),
    ).toThrow(/SUPERVISOR_ENROLLMENT_PEPPER is required/);

    const enrollmentPepper = 'supervisor-enrollment-pepper-for-config-tests';
    expect(() =>
      envValidate({
        ...baseValid,
        NODE_ENV: 'development',
        MSAIDIZI_SUPERVISOR_ENROLLMENT_ENABLED: 'true',
        MSAIDIZI_SUPERVISOR_ENROLLMENT_PEPPER: enrollmentPepper,
      }),
    ).toThrow(/Supervisor enrollment requires.*DIRECT_MTLS_ENABLED/);

    const valid = {
      ...baseValid,
      NODE_ENV: 'development',
      MSAIDIZI_SUPERVISOR_ENROLLMENT_ENABLED: 'true',
      MSAIDIZI_SUPERVISOR_ENROLLMENT_PEPPER: enrollmentPepper,
      MSAIDIZI_DIRECT_MTLS_ENABLED: 'true',
      MSAIDIZI_DIRECT_MTLS_SERVER_KEY_PATH: resolve('operator-secrets/server-key.pem'),
      MSAIDIZI_DIRECT_MTLS_SERVER_CERT_PATH: resolve('operator-secrets/server-cert.pem'),
      MSAIDIZI_DIRECT_MTLS_CLIENT_CA_PATH: resolve('operator-secrets/client-ca.pem'),
    };
    expect(() => envValidate(valid)).not.toThrow();
    expect(() =>
      envValidate({ ...valid, MSAIDIZI_DEVICE_PAIRING_PEPPER: enrollmentPepper }),
    ).toThrow(/SUPERVISOR_ENROLLMENT_PEPPER.*DEVICE_PAIRING_PEPPER.*distinct/);
  });

  it('requires a distinct route-isolated direct mTLS listener', () => {
    const direct = {
      ...baseValid,
      NODE_ENV: 'development',
      MSAIDIZI_DIRECT_MTLS_ENABLED: 'true',
      MSAIDIZI_DIRECT_MTLS_SERVER_KEY_PATH: resolve('operator-secrets/server-key.pem'),
      MSAIDIZI_DIRECT_MTLS_SERVER_CERT_PATH: resolve('operator-secrets/server-cert.pem'),
      MSAIDIZI_DIRECT_MTLS_CLIENT_CA_PATH: resolve('operator-secrets/client-ca.pem'),
    };
    expect(() => envValidate(direct)).not.toThrow();
    expect(() => envValidate({ ...direct, MSAIDIZI_DIRECT_MTLS_PORT: '3001' })).toThrow(
      /must differ from the ordinary API port/,
    );
    expect(() =>
      envValidate({ ...direct, MSAIDIZI_DIRECT_MTLS_BIND_ADDRESS: 'all-interfaces' }),
    ).toThrow(/must be a literal IP address/);
    expect(() => envValidate({ ...direct, MSAIDIZI_DIRECT_MTLS_ENABLED: 'sometimes' })).toThrow(
      /must be an explicit boolean value/,
    );
  });

  it('keeps the direct device and evaluator mTLS listener ports distinct', () => {
    expect(() =>
      envValidate({
        ...baseValid,
        NODE_ENV: 'development',
        MSAIDIZI_AUTONOMY_ENABLED: 'true',
        MSAIDIZI_UPDATE_EVALUATOR_ENABLED: 'true',
        ...PROVIDER_CONTRACT_CONFIG,
        MSAIDIZI_EVALUATOR_KEY_ALLOWLIST_PATH: ABSOLUTE_EVALUATOR_ALLOWLIST,
        MSAIDIZI_EVALUATOR_KEY_ALLOWLIST_SHA256: 'a'.repeat(64),
        MSAIDIZI_ARTIFACT_ENCRYPTION_KEY: ARTIFACT_KEY,
        MSAIDIZI_ARTIFACT_ROOT: ABSOLUTE_ARTIFACT_ROOT,
        ...EVALUATOR_TRANSPORT,
        MSAIDIZI_DIRECT_MTLS_ENABLED: 'true',
        MSAIDIZI_DIRECT_MTLS_PORT: '3444',
        MSAIDIZI_DIRECT_MTLS_SERVER_KEY_PATH: resolve('operator-secrets/server-key.pem'),
        MSAIDIZI_DIRECT_MTLS_SERVER_CERT_PATH: resolve('operator-secrets/server-cert.pem'),
        MSAIDIZI_DIRECT_MTLS_CLIENT_CA_PATH: resolve('operator-secrets/client-ca.pem'),
      }),
    ).toThrow(/must differ from the dedicated evaluator mTLS port/);
  });

  it('requires the signed artifact, key and release provenance digests together', () => {
    expect(() =>
      envValidate({
        ...baseValid,
        NODE_ENV: 'development',
        MSAIDIZI_CRUD_EVIDENCE_PATH: ABSOLUTE_EVIDENCE_PATH,
      }),
    ).toThrow(/Missing CRUD evidence configuration/);
  });

  it('accepts complete external signed CRUD evidence configuration', () => {
    expect(() =>
      envValidate({
        ...baseValid,
        NODE_ENV: 'development',
        MSAIDIZI_CRUD_EVIDENCE_PATH: ABSOLUTE_EVIDENCE_PATH,
        MSAIDIZI_CRUD_EVIDENCE_PUBLIC_KEY_PATH: ABSOLUTE_EVIDENCE_PUBLIC_KEY_PATH,
        MSAIDIZI_CRUD_EVIDENCE_KEY_ID: 'crud-evidence-2026-01',
        MSAIDIZI_CRUD_EVIDENCE_APPLICATION_BUILD_DIGEST: EVIDENCE_BUILD_DIGEST,
        MSAIDIZI_CRUD_EVIDENCE_PRISMA_SCHEMA_MIGRATION_DIGEST: EVIDENCE_PRISMA_DIGEST,
        MSAIDIZI_CRUD_EVIDENCE_MAX_AGE_HOURS: 24,
      }),
    ).not.toThrow();
  });

  it('rejects relative CRUD evidence paths', () => {
    expect(() =>
      envValidate({
        ...baseValid,
        NODE_ENV: 'development',
        MSAIDIZI_CRUD_EVIDENCE_PATH: './crud-evidence.json',
        MSAIDIZI_CRUD_EVIDENCE_PUBLIC_KEY_PATH: ABSOLUTE_EVIDENCE_PUBLIC_KEY_PATH,
        MSAIDIZI_CRUD_EVIDENCE_KEY_ID: 'crud-evidence-2026-01',
        MSAIDIZI_CRUD_EVIDENCE_APPLICATION_BUILD_DIGEST: EVIDENCE_BUILD_DIGEST,
        MSAIDIZI_CRUD_EVIDENCE_PRISMA_SCHEMA_MIGRATION_DIGEST: EVIDENCE_PRISMA_DIGEST,
      }),
    ).toThrow(/MSAIDIZI_CRUD_EVIDENCE_PATH must be an absolute external path/);
  });

  it('rejects non-SHA release provenance for signed CRUD evidence', () => {
    expect(() =>
      envValidate({
        ...baseValid,
        NODE_ENV: 'development',
        MSAIDIZI_CRUD_EVIDENCE_PATH: ABSOLUTE_EVIDENCE_PATH,
        MSAIDIZI_CRUD_EVIDENCE_PUBLIC_KEY_PATH: ABSOLUTE_EVIDENCE_PUBLIC_KEY_PATH,
        MSAIDIZI_CRUD_EVIDENCE_KEY_ID: 'crud-evidence-2026-01',
        MSAIDIZI_CRUD_EVIDENCE_APPLICATION_BUILD_DIGEST: 'not-a-digest',
        MSAIDIZI_CRUD_EVIDENCE_PRISMA_SCHEMA_MIGRATION_DIGEST: EVIDENCE_PRISMA_DIGEST,
      }),
    ).toThrow(/MSAIDIZI_CRUD_EVIDENCE_APPLICATION_BUILD_DIGEST must be a lowercase SHA-256/);
  });

  it('requires every protected release coordinate before a production task worker can start', () => {
    expect(() =>
      envValidate({
        ...baseValid,
        ...validProductionExtras,
        NODE_ENV: 'production',
        MSAIDIZI_TASK_WORKER_ENABLED: 'true',
      }),
    ).toThrow(/Missing protected production release configuration/);

    expect(() =>
      envValidate({
        ...baseValid,
        ...validProductionExtras,
        ...PROTECTED_RELEASE_CONFIG,
        NODE_ENV: 'production',
        MSAIDIZI_TASK_WORKER_ENABLED: 'true',
      }),
    ).not.toThrow();
  });

  it('rejects partial or internally inconsistent protected release coordinates', () => {
    expect(() =>
      envValidate({
        ...baseValid,
        NODE_ENV: 'development',
        MSAIDIZI_PRODUCTION_ACCEPTED_INVENTORY_SHA256: '2'.repeat(64),
      }),
    ).toThrow(/Missing protected production release configuration/);

    expect(() =>
      envValidate({
        ...baseValid,
        ...PROTECTED_RELEASE_CONFIG,
        NODE_ENV: 'development',
        MSAIDIZI_DEPLOYED_BACKEND_IMAGE_REFERENCE: `ghcr.io/itemba/itemba-r-backend@sha256:${'5'.repeat(64)}`,
      }),
    ).toThrow(/must be the accepted immutable repository@sha256 reference/);
  });

  it.each([
    ['durable reasoning', 'MSAIDIZI_AUTONOMY_ENABLED'],
    ['Autopilot', 'MSAIDIZI_AUTOPILOT_ENABLED'],
    ['host execution', 'MSAIDIZI_HOST_EXECUTION_ENABLED'],
  ] as const)(
    'fails closed when %s lacks a verified zero-retention provider contract',
    (_, key) => {
      expect(() =>
        envValidate({
          ...baseValid,
          NODE_ENV: 'development',
          [key]: 'true',
          ...(key === 'MSAIDIZI_HOST_EXECUTION_ENABLED'
            ? {
                MSAIDIZI_DEVICE_CHANNEL_ENABLED: 'true',
                MSAIDIZI_DIRECT_MTLS_ENABLED: 'true',
                MSAIDIZI_DEVICE_LEASE_PEPPER: 'lease-pepper-for-zero-retention-test',
                MSAIDIZI_ACTION_SIGNING_KEY_PATH: 'C:\\secrets\\action.pem',
                MSAIDIZI_ACTION_SIGNING_KEY_ID: 'action-zero-retention-test',
                MSAIDIZI_DIRECT_MTLS_SERVER_KEY_PATH: 'C:\\secrets\\server-key.pem',
                MSAIDIZI_DIRECT_MTLS_SERVER_CERT_PATH: 'C:\\secrets\\server-cert.pem',
                MSAIDIZI_DIRECT_MTLS_CLIENT_CA_PATH: 'C:\\secrets\\client-ca.pem',
              }
            : {}),
        }),
      ).toThrow(/zero-training, zero-retention/);
    },
  );

  it('accepts durable reasoning only after an explicit provider-contract attestation', () => {
    expect(() =>
      envValidate({
        ...baseValid,
        NODE_ENV: 'development',
        MSAIDIZI_AUTONOMY_ENABLED: 'true',
        ...PROVIDER_CONTRACT_CONFIG,
      }),
    ).not.toThrow();
  });

  it('requires a canonical non-secret provider credential key identifier', () => {
    const { MSAIDIZI_PROVIDER_CREDENTIAL_KEY_ID: _omitted, ...withoutCredentialKeyId } =
      PROVIDER_CONTRACT_CONFIG;
    void _omitted;
    expect(() =>
      envValidate({
        ...baseValid,
        NODE_ENV: 'development',
        MSAIDIZI_ENABLED: 'true',
        ...withoutCredentialKeyId,
      }),
    ).toThrow(/MSAIDIZI_PROVIDER_CREDENTIAL_KEY_ID/);
    expect(() =>
      envValidate({
        ...baseValid,
        NODE_ENV: 'development',
        MSAIDIZI_ENABLED: 'true',
        ...PROVIDER_CONTRACT_CONFIG,
        MSAIDIZI_PROVIDER_CREDENTIAL_KEY_ID: ' secret version ',
      }),
    ).toThrow(/MSAIDIZI_PROVIDER_CREDENTIAL_KEY_ID has an invalid format/);
  });

  it.each(FORBIDDEN_ANTHROPIC_SDK_ENVIRONMENT_OVERRIDES)(
    'rejects hidden Anthropic SDK override %s when cloud disclosure is enabled',
    (name) => {
      expect(() =>
        envValidate({
          ...baseValid,
          NODE_ENV: 'development',
          MSAIDIZI_ENABLED: 'true',
          ...PROVIDER_CONTRACT_CONFIG,
          [name]: 'forbidden-test-value',
        }),
      ).toThrow(new RegExp(`forbids Anthropic SDK environment overrides: ${name}`));
    },
  );

  it.each(['MSAIDIZI_MODEL', 'MSAIDIZI_CLASSIFIER_MODEL'] as const)(
    'rejects surrounding whitespace in attested model setting %s',
    (name) => {
      expect(() =>
        envValidate({
          ...baseValid,
          NODE_ENV: 'development',
          MSAIDIZI_ENABLED: 'true',
          ...PROVIDER_CONTRACT_CONFIG,
          [name]: ' claude-opus-5 ',
        }),
      ).toThrow(new RegExp(`${name} must be an exact canonical provider model ID`));
    },
  );

  it('rejects partial, relative, unpinned, and legacy Boolean provider-contract claims', () => {
    expect(() =>
      envValidate({
        ...baseValid,
        NODE_ENV: 'development',
        MSAIDIZI_ENABLED: 'true',
        MSAIDIZI_PROVIDER_CONTRACT_ATTESTATION_PATH:
          PROVIDER_CONTRACT_CONFIG.MSAIDIZI_PROVIDER_CONTRACT_ATTESTATION_PATH,
      }),
    ).toThrow(/complete signed zero-training, zero-retention provider-contract evidence/);
    expect(() =>
      envValidate({
        ...baseValid,
        NODE_ENV: 'development',
        MSAIDIZI_ENABLED: 'true',
        ...PROVIDER_CONTRACT_CONFIG,
        MSAIDIZI_PROVIDER_CONTRACT_ATTESTATION_PATH: './provider-contract.json',
      }),
    ).toThrow(/must be an absolute external path/);
    expect(() =>
      envValidate({
        ...baseValid,
        NODE_ENV: 'development',
        MSAIDIZI_ENABLED: 'true',
        ...PROVIDER_CONTRACT_CONFIG,
        MSAIDIZI_PROVIDER_CONTRACT_SIGNER_SPKI_SHA256: 'not-a-pin',
      }),
    ).toThrow(/must be a lowercase SHA-256 digest/);
    expect(() =>
      envValidate({
        ...baseValid,
        NODE_ENV: 'development',
        MSAIDIZI_CLOUD_ZERO_RETENTION_CONFIRMED: 'true',
      }),
    ).toThrow(/no longer accepted/);
  });

  it('accepts explicit adaptive-reasoning limits and model pricing', () => {
    expect(() =>
      envValidate({
        ...baseValid,
        NODE_ENV: 'development',
        MSAIDIZI_ADAPTIVE_REASONING_ENABLED: 'false',
        MSAIDIZI_ADAPTIVE_REASONING_MAX_INPUT_BYTES: '65536',
        MSAIDIZI_ADAPTIVE_REASONING_MAX_OUTPUT_TOKENS: '2048',
        MSAIDIZI_MODEL_INPUT_USD_PER_MILLION_TOKENS: '30',
        MSAIDIZI_MODEL_OUTPUT_USD_PER_MILLION_TOKENS: '150',
        MSAIDIZI_MODEL_CACHE_READ_USD_PER_MILLION_TOKENS: '30',
        MSAIDIZI_MODEL_CACHE_CREATION_USD_PER_MILLION_TOKENS: '37.5',
      }),
    ).not.toThrow();
  });

  it('accepts explicit pre-task proposal quota and receipt limits', () => {
    expect(() =>
      envValidate({
        ...baseValid,
        NODE_ENV: 'development',
        MSAIDIZI_PROPOSAL_MAX_INPUT_TOKENS_PER_TURN: '200000',
        MSAIDIZI_PROPOSAL_QUOTA_WINDOW_SECONDS: '3600',
        MSAIDIZI_PROPOSAL_MAX_MODEL_TURNS_PER_WINDOW: '0',
        MSAIDIZI_PROPOSAL_MAX_COST_USD_PER_WINDOW: '0',
        MSAIDIZI_PROPOSAL_RECEIPT_TTL_SECONDS: '86400',
        MSAIDIZI_PROPOSAL_RESERVATION_TIMEOUT_SECONDS: '300',
      }),
    ).not.toThrow();
  });

  it('accepts zero deny-ceilings for mutation, external egress, and model spend', () => {
    const config = envValidate({
      ...baseValid,
      NODE_ENV: 'development',
      MSAIDIZI_AUTONOMY_MAX_MUTATIONS: '0',
      MSAIDIZI_AUTONOMY_MAX_EGRESS_BYTES: '0',
      MSAIDIZI_AUTONOMY_MAX_MODEL_COST_USD: '0',
    });
    expect(config.MSAIDIZI_AUTONOMY_MAX_MUTATIONS).toBe(0);
    expect(config.MSAIDIZI_AUTONOMY_MAX_EGRESS_BYTES).toBe('0');
    expect(config.MSAIDIZI_AUTONOMY_MAX_MODEL_COST_USD).toBe(0);
  });

  it.each([
    ['MSAIDIZI_AUTONOMY_MAX_WALL_SECONDS', '0'],
    ['MSAIDIZI_AUTONOMY_MAX_MODEL_TURNS', '1.2'],
    ['MSAIDIZI_AUTONOMY_MAX_TOOL_ATTEMPTS', '-1'],
    ['MSAIDIZI_AUTONOMY_MAX_MUTATIONS', '-1'],
  ] as const)('rejects an invalid task ceiling for %s', (key, value) => {
    expect(() => envValidate({ ...baseValid, NODE_ENV: 'development', [key]: value })).toThrow(
      /Invalid environment configuration/,
    );
  });

  it.each([
    ['MSAIDIZI_AUTONOMY_MAX_LOCAL_BYTES', '0'],
    ['MSAIDIZI_AUTONOMY_MAX_LOCAL_BYTES', '01'],
    ['MSAIDIZI_AUTONOMY_MAX_EGRESS_BYTES', '-1'],
    ['MSAIDIZI_AUTONOMY_MAX_EGRESS_BYTES', '9223372036854775808'],
  ] as const)('rejects an invalid byte ceiling for %s', (key, value) => {
    expect(() => envValidate({ ...baseValid, NODE_ENV: 'development', [key]: value })).toThrow(
      new RegExp(key),
    );
  });

  it.each([
    ['MSAIDIZI_ADAPTIVE_REASONING_MAX_INPUT_BYTES', '0'],
    ['MSAIDIZI_ADAPTIVE_REASONING_MAX_INPUT_BYTES', '1.5'],
    ['MSAIDIZI_ADAPTIVE_REASONING_MAX_OUTPUT_TOKENS', '-1'],
    ['MSAIDIZI_MODEL_INPUT_USD_PER_MILLION_TOKENS', '0'],
    ['MSAIDIZI_MODEL_OUTPUT_USD_PER_MILLION_TOKENS', 'not-a-price'],
    ['MSAIDIZI_MODEL_CACHE_READ_USD_PER_MILLION_TOKENS', '0'],
    ['MSAIDIZI_MODEL_CACHE_CREATION_USD_PER_MILLION_TOKENS', '-1'],
  ] as const)('rejects an invalid adaptive runtime value for %s', (key, value) => {
    expect(() =>
      envValidate({
        ...baseValid,
        NODE_ENV: 'development',
        [key]: value,
      }),
    ).toThrow(/Invalid environment configuration/);
  });

  it.each([
    ['MSAIDIZI_PROPOSAL_MAX_INPUT_TOKENS_PER_TURN', '0'],
    ['MSAIDIZI_PROPOSAL_QUOTA_WINDOW_SECONDS', '1.5'],
    ['MSAIDIZI_PROPOSAL_MAX_MODEL_TURNS_PER_WINDOW', '-1'],
    ['MSAIDIZI_PROPOSAL_MAX_COST_USD_PER_WINDOW', '-0.1'],
    ['MSAIDIZI_PROPOSAL_RECEIPT_TTL_SECONDS', '0'],
    ['MSAIDIZI_PROPOSAL_RESERVATION_TIMEOUT_SECONDS', '0'],
  ] as const)('rejects an invalid proposal accounting value for %s', (key, value) => {
    expect(() =>
      envValidate({
        ...baseValid,
        NODE_ENV: 'development',
        [key]: value,
      }),
    ).toThrow(/Invalid environment configuration/);
  });

  it('rejects an ambiguous adaptive-reasoning enable flag', () => {
    expect(() =>
      envValidate({
        ...baseValid,
        NODE_ENV: 'development',
        MSAIDIZI_ADAPTIVE_REASONING_ENABLED: 'sometimes',
      }),
    ).toThrow(/must be an explicit boolean value/);
  });

  it('does not allow adaptive reasoning to bypass the durable-autonomy gate', () => {
    expect(() =>
      envValidate({
        ...baseValid,
        NODE_ENV: 'development',
        MSAIDIZI_ADAPTIVE_REASONING_ENABLED: 'true',
        ...PROVIDER_CONTRACT_CONFIG,
      }),
    ).toThrow(/requires MSAIDIZI_AUTONOMY_ENABLED=true/);
  });

  it('accepts adaptive reasoning only behind autonomy and zero-retention gates', () => {
    expect(() =>
      envValidate({
        ...baseValid,
        NODE_ENV: 'development',
        MSAIDIZI_AUTONOMY_ENABLED: 'true',
        MSAIDIZI_ADAPTIVE_REASONING_ENABLED: 'true',
        ...PROVIDER_CONTRACT_CONFIG,
      }),
    ).not.toThrow();
  });

  it('keeps the signed evaluator safely off without trust configuration', () => {
    expect(() =>
      envValidate({
        ...baseValid,
        NODE_ENV: 'development',
        MSAIDIZI_UPDATE_EVALUATOR_ENABLED: 'false',
      }),
    ).not.toThrow();
  });

  it('fails closed when the signed evaluator lacks its pinned external registry', () => {
    expect(() =>
      envValidate({
        ...baseValid,
        NODE_ENV: 'development',
        MSAIDIZI_UPDATE_EVALUATOR_ENABLED: 'true',
        MSAIDIZI_AUTONOMY_ENABLED: 'true',
        ...PROVIDER_CONTRACT_CONFIG,
      }),
    ).toThrow(/Missing signed evaluator configuration/);
  });

  it('accepts a complete pinned evaluator configuration with a distinct artifact key', () => {
    expect(() =>
      envValidate({
        ...baseValid,
        NODE_ENV: 'development',
        MSAIDIZI_UPDATE_EVALUATOR_ENABLED: 'true',
        MSAIDIZI_AUTONOMY_ENABLED: 'true',
        ...PROVIDER_CONTRACT_CONFIG,
        MSAIDIZI_EVALUATOR_KEY_ALLOWLIST_PATH: ABSOLUTE_EVALUATOR_ALLOWLIST,
        MSAIDIZI_EVALUATOR_KEY_ALLOWLIST_SHA256: 'a'.repeat(64),
        MSAIDIZI_ARTIFACT_ENCRYPTION_KEY: ARTIFACT_KEY,
        MSAIDIZI_ARTIFACT_ROOT: ABSOLUTE_ARTIFACT_ROOT,
        ...EVALUATOR_TRANSPORT,
      }),
    ).not.toThrow();
  });

  it('rejects an unpinned or security-domain-reused evaluator registry', () => {
    const common = {
      ...baseValid,
      NODE_ENV: 'development',
      MSAIDIZI_UPDATE_EVALUATOR_ENABLED: 'true',
      MSAIDIZI_AUTONOMY_ENABLED: 'true',
      ...PROVIDER_CONTRACT_CONFIG,
      MSAIDIZI_EVALUATOR_KEY_ALLOWLIST_PATH: ABSOLUTE_EVALUATOR_ALLOWLIST,
      MSAIDIZI_ARTIFACT_ENCRYPTION_KEY: ARTIFACT_KEY,
      MSAIDIZI_ARTIFACT_ROOT: ABSOLUTE_ARTIFACT_ROOT,
      ...EVALUATOR_TRANSPORT,
    };
    expect(() =>
      envValidate({ ...common, MSAIDIZI_EVALUATOR_KEY_ALLOWLIST_SHA256: 'NOT_A_PIN' }),
    ).toThrow(/lowercase SHA-256 pin/);
    expect(() =>
      envValidate({
        ...common,
        MSAIDIZI_EVALUATOR_KEY_ALLOWLIST_SHA256: 'a'.repeat(64),
        MSAIDIZI_ACTION_SIGNING_KEY_PATH: ABSOLUTE_EVALUATOR_ALLOWLIST,
      }),
    ).toThrow(/must be distinct/);
  });

  it('requires a genuinely distinct evaluator mTLS listener and client CA', () => {
    const valid = {
      ...baseValid,
      NODE_ENV: 'development',
      MSAIDIZI_UPDATE_EVALUATOR_ENABLED: 'true',
      MSAIDIZI_AUTONOMY_ENABLED: 'true',
      ...PROVIDER_CONTRACT_CONFIG,
      MSAIDIZI_EVALUATOR_KEY_ALLOWLIST_PATH: ABSOLUTE_EVALUATOR_ALLOWLIST,
      MSAIDIZI_EVALUATOR_KEY_ALLOWLIST_SHA256: 'a'.repeat(64),
      MSAIDIZI_ARTIFACT_ENCRYPTION_KEY: ARTIFACT_KEY,
      MSAIDIZI_ARTIFACT_ROOT: ABSOLUTE_ARTIFACT_ROOT,
      ...EVALUATOR_TRANSPORT,
    };
    expect(() => envValidate({ ...valid, MSAIDIZI_EVALUATOR_MTLS_PORT: '3001' })).toThrow(
      /must differ from the ordinary API port/,
    );
    expect(() =>
      envValidate({ ...valid, MSAIDIZI_EVALUATOR_MTLS_BIND_ADDRESS: 'all-interfaces' }),
    ).toThrow(/must be a literal IP address/);
    expect(() =>
      envValidate({
        ...valid,
        MSAIDIZI_DIRECT_MTLS_CLIENT_CA_PATH:
          EVALUATOR_TRANSPORT.MSAIDIZI_EVALUATOR_MTLS_CLIENT_CA_PATH,
      }),
    ).toThrow(/must be distinct/);
  });

  it('fails closed when the update supervisor has no dedicated signing key', () => {
    expect(() =>
      envValidate({
        ...baseValid,
        NODE_ENV: 'development',
        MSAIDIZI_UPDATE_SUPERVISOR_ENABLED: 'true',
        MSAIDIZI_DEVICE_CHANNEL_ENABLED: 'true',
        MSAIDIZI_DIRECT_MTLS_ENABLED: 'true',
        MSAIDIZI_DEVICE_LEASE_PEPPER: 'lease-pepper-for-update-supervisor-test',
        MSAIDIZI_ACTION_SIGNING_KEY_PATH: 'C:\\secrets\\action.pem',
        MSAIDIZI_ACTION_SIGNING_KEY_ID: 'action-test',
        MSAIDIZI_DIRECT_MTLS_SERVER_KEY_PATH: 'C:\\secrets\\server-key.pem',
        MSAIDIZI_DIRECT_MTLS_SERVER_CERT_PATH: 'C:\\secrets\\server-cert.pem',
        MSAIDIZI_DIRECT_MTLS_CLIENT_CA_PATH: 'C:\\secrets\\client-ca.pem',
      }),
    ).toThrow(/trusted update-supervisor configuration/);
  });

  it('requires an explicit protected ring ceiling before automatic rollout can be enabled', () => {
    const automaticRollout = {
      ...baseValid,
      NODE_ENV: 'development',
      MSAIDIZI_UPDATE_SUPERVISOR_ENABLED: 'true',
      MSAIDIZI_UPDATE_AUTOMATIC_ROLLOUT_ENABLED: 'true',
      MSAIDIZI_AUTONOMY_ENABLED: 'true',
      MSAIDIZI_AUTOPILOT_ENABLED: 'true',
      MSAIDIZI_DEVICE_CHANNEL_ENABLED: 'true',
      MSAIDIZI_DIRECT_MTLS_ENABLED: 'true',
      MSAIDIZI_DEVICE_LEASE_PEPPER: 'lease-pepper-for-automatic-rollout-test',
      MSAIDIZI_ACTION_SIGNING_KEY_PATH: resolve('operator-secrets/action.pem'),
      MSAIDIZI_ACTION_SIGNING_KEY_ID: 'action-test',
      MSAIDIZI_UPDATE_SIGNING_KEY_PATH: resolve('operator-secrets/update.pem'),
      MSAIDIZI_UPDATE_SIGNING_KEY_ID: 'update-test',
      MSAIDIZI_DIRECT_MTLS_SERVER_KEY_PATH: resolve('operator-secrets/server-key.pem'),
      MSAIDIZI_DIRECT_MTLS_SERVER_CERT_PATH: resolve('operator-secrets/server-cert.pem'),
      MSAIDIZI_DIRECT_MTLS_CLIENT_CA_PATH: resolve('operator-secrets/client-ca.pem'),
      ...PROVIDER_CONTRACT_CONFIG,
    };

    expect(() => envValidate(automaticRollout)).toThrow(
      /requires an explicit MSAIDIZI_UPDATE_AUTOMATIC_MAX_RING/,
    );
    expect(
      envValidate({ ...automaticRollout, MSAIDIZI_UPDATE_AUTOMATIC_MAX_RING: '25' })
        .MSAIDIZI_UPDATE_AUTOMATIC_MAX_RING,
    ).toBe(25);
  });

  it.each(['1', '6', '99'])('rejects a non-policy automatic rollout ring ceiling: %s', (value) => {
    expect(() => envValidate({ ...baseValid, MSAIDIZI_UPDATE_AUTOMATIC_MAX_RING: value })).toThrow(
      /MSAIDIZI_UPDATE_AUTOMATIC_MAX_RING must be -1, 0, 5, 25, or 100/,
    );
  });

  it.each([
    ['MSAIDIZI_UPDATE_RING_0_MIN_DWELL_SECONDS', '86399'],
    ['MSAIDIZI_UPDATE_RING_5_MIN_DWELL_SECONDS', '86399'],
    ['MSAIDIZI_UPDATE_RING_25_MIN_DWELL_SECONDS', '172799'],
    ['MSAIDIZI_UPDATE_RING_100_MIN_DWELL_SECONDS', '259199'],
  ])('rejects a protected rollout dwell below policy: %s', (name, value) => {
    expect(() => envValidate({ ...baseValid, [name]: value })).toThrow(name);
  });

  it('accepts the exact protected rollout dwell boundaries', () => {
    const config = envValidate({
      ...baseValid,
      MSAIDIZI_UPDATE_RING_0_MIN_DWELL_SECONDS: '86400',
      MSAIDIZI_UPDATE_RING_5_MIN_DWELL_SECONDS: '86400',
      MSAIDIZI_UPDATE_RING_25_MIN_DWELL_SECONDS: '172800',
      MSAIDIZI_UPDATE_RING_100_MIN_DWELL_SECONDS: '259200',
    });
    expect(config.MSAIDIZI_UPDATE_RING_0_MIN_DWELL_SECONDS).toBe(86_400);
    expect(config.MSAIDIZI_UPDATE_RING_5_MIN_DWELL_SECONDS).toBe(86_400);
    expect(config.MSAIDIZI_UPDATE_RING_25_MIN_DWELL_SECONDS).toBe(172_800);
    expect(config.MSAIDIZI_UPDATE_RING_100_MIN_DWELL_SECONDS).toBe(259_200);
  });

  it('fails closed when the recovery supervisor has no dedicated signing key', () => {
    expect(() =>
      envValidate({
        ...baseValid,
        NODE_ENV: 'development',
        MSAIDIZI_RECOVERY_SUPERVISOR_ENABLED: 'true',
        MSAIDIZI_DEVICE_CHANNEL_ENABLED: 'true',
        MSAIDIZI_DIRECT_MTLS_ENABLED: 'true',
        MSAIDIZI_DEVICE_LEASE_PEPPER: 'lease-pepper-for-recovery-supervisor-test',
        MSAIDIZI_ACTION_SIGNING_KEY_PATH: 'C:\\secrets\\action.pem',
        MSAIDIZI_ACTION_SIGNING_KEY_ID: 'action-test',
        MSAIDIZI_DIRECT_MTLS_SERVER_KEY_PATH: 'C:\\secrets\\server-key.pem',
        MSAIDIZI_DIRECT_MTLS_SERVER_CERT_PATH: 'C:\\secrets\\server-cert.pem',
        MSAIDIZI_DIRECT_MTLS_CLIENT_CA_PATH: 'C:\\secrets\\client-ca.pem',
      }),
    ).toThrow(/trusted recovery-supervisor configuration/);
  });

  it('requires recovery, update, action, and HTTPS signing keys to remain distinct', () => {
    expect(() =>
      envValidate({
        ...baseValid,
        NODE_ENV: 'development',
        MSAIDIZI_RECOVERY_SUPERVISOR_ENABLED: 'true',
        MSAIDIZI_DEVICE_CHANNEL_ENABLED: 'true',
        MSAIDIZI_DIRECT_MTLS_ENABLED: 'true',
        MSAIDIZI_DEVICE_LEASE_PEPPER: 'lease-pepper-for-recovery-supervisor-test',
        MSAIDIZI_ACTION_SIGNING_KEY_PATH: 'C:\\secrets\\action.pem',
        MSAIDIZI_ACTION_SIGNING_KEY_ID: 'action-test',
        MSAIDIZI_RECOVERY_SIGNING_KEY_PATH: 'C:\\secrets\\action.pem',
        MSAIDIZI_RECOVERY_SIGNING_KEY_ID: 'recovery-test',
        MSAIDIZI_DIRECT_MTLS_SERVER_KEY_PATH: 'C:\\secrets\\server-key.pem',
        MSAIDIZI_DIRECT_MTLS_SERVER_CERT_PATH: 'C:\\secrets\\server-cert.pem',
        MSAIDIZI_DIRECT_MTLS_CLIENT_CA_PATH: 'C:\\secrets\\client-ca.pem',
      }),
    ).toThrow(/RECOVERY_SIGNING_KEY_PATH.*ACTION_SIGNING_KEY_PATH.*distinct/);
  });

  it('rejects missing DATABASE_URL', () => {
    const partial: Partial<typeof baseValid> = { ...baseValid };
    delete partial.DATABASE_URL;
    expect(() => envValidate(partial)).toThrow(/DATABASE_URL/);
  });

  it('rejects JWT secrets shorter than 32 chars', () => {
    expect(() => envValidate({ ...baseValid, JWT_ACCESS_SECRET: 'short' })).toThrow(
      /JWT_ACCESS_SECRET/,
    );
  });

  it('requires TWO_FACTOR_ENCRYPTION_KEY in production', () => {
    expect(() => envValidate({ ...baseValid, NODE_ENV: 'production' })).toThrow(
      /TWO_FACTOR_ENCRYPTION_KEY/,
    );
  });

  it('requires APP_ENCRYPTION_KEY in production', () => {
    const partial: Partial<typeof validProductionExtras> = { ...validProductionExtras };
    delete partial.APP_ENCRYPTION_KEY;
    expect(() => envValidate({ ...baseValid, NODE_ENV: 'production', ...partial })).toThrow(
      /APP_ENCRYPTION_KEY/,
    );
  });

  it('requires REFRESH_TOKEN_PEPPER in production', () => {
    const partial: Partial<typeof validProductionExtras> = { ...validProductionExtras };
    delete partial.REFRESH_TOKEN_PEPPER;
    expect(() => envValidate({ ...baseValid, NODE_ENV: 'production', ...partial })).toThrow(
      /REFRESH_TOKEN_PEPPER/,
    );
  });

  it('rejects localhost deployment URLs in production', () => {
    expect(() =>
      envValidate({
        ...baseValid,
        NODE_ENV: 'production',
        ...validProductionExtras,
        APP_URL: 'http://localhost:3009',
      }),
    ).toThrow(/APP_URL must be set to a public HTTPS URL/);
  });

  it('accepts production config with all required strong secrets', () => {
    expect(() =>
      envValidate({
        ...baseValid,
        NODE_ENV: 'production',
        ...validProductionExtras,
      }),
    ).not.toThrow();
  });

  it('rejects wildcard credentialed CORS origins in production', () => {
    expect(() =>
      envValidate({
        ...baseValid,
        NODE_ENV: 'production',
        ...validProductionExtras,
        CORS_ORIGIN: 'https://*.itembagrouptz.com',
      }),
    ).toThrow(/wildcard/);
  });

  it('requires explicit storage roots in production', () => {
    const partial: Record<string, string> = { ...validProductionExtras };
    delete partial.STORAGE_LOCAL_PATH;
    delete partial.LOCAL_STORAGE_PATH;
    delete partial.STORAGE_PATH;
    expect(() =>
      envValidate({
        ...baseValid,
        NODE_ENV: 'production',
        ...partial,
      }),
    ).toThrow(/STORAGE_LOCAL_PATH/);
  });

  it('rejects known-default JWT secrets in production even if length passes', () => {
    expect(() =>
      envValidate({
        ...baseValid,
        // 'change-me' padded to 40 chars by repeat — but the lowercase trim
        // exact-match guard catches the placeholder regardless of length.
        JWT_ACCESS_SECRET: 'change-me',
        NODE_ENV: 'production',
        ...validProductionExtras,
      }),
    ).toThrow();
  });

  it('rejects the legacy hardcoded 2FA key value in production', () => {
    expect(() =>
      envValidate({
        ...baseValid,
        NODE_ENV: 'production',
        ...validProductionExtras,
        TWO_FACTOR_ENCRYPTION_KEY: 'itemba-r-2fa-key-change-in-prod!',
      }),
    ).toThrow(/TWO_FACTOR_ENCRYPTION_KEY/);
  });

  it('rejects sharing JWT_ACCESS_SECRET as APP_ENCRYPTION_KEY in production', () => {
    expect(() =>
      envValidate({
        ...baseValid,
        NODE_ENV: 'production',
        ...validProductionExtras,
        APP_ENCRYPTION_KEY: STRONG_SECRET, // same as JWT_ACCESS_SECRET
      }),
    ).toThrow(/APP_ENCRYPTION_KEY and JWT_ACCESS_SECRET must be distinct/);
  });

  it('rejects sharing TWO_FACTOR_ENCRYPTION_KEY as APP_ENCRYPTION_KEY in production', () => {
    expect(() =>
      envValidate({
        ...baseValid,
        NODE_ENV: 'production',
        ...validProductionExtras,
        APP_ENCRYPTION_KEY: STRONG_2FA, // same as TWO_FACTOR_ENCRYPTION_KEY
      }),
    ).toThrow(/must be distinct/);
  });
});
