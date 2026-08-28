import { plainToInstance } from 'class-transformer';
import {
  IsEnum,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  Max,
  Min,
  MinLength,
  validateSync,
} from 'class-validator';
import { isAbsolute } from 'node:path';
import { isIP } from 'node:net';
import { FORBIDDEN_ANTHROPIC_SDK_ENVIRONMENT_OVERRIDES } from '../modules/msaidizi/provider-contract-attestation.protocol';

enum NodeEnv {
  Development = 'development',
  Staging = 'staging',
  Production = 'production',
  Test = 'test',
}

// Known default/placeholder secret values that must never be used in production.
const FORBIDDEN_PROD_SECRETS = new Set([
  'change-me',
  'changeme',
  'itemba-r-2fa-key-change-in-prod!',
  'itemba-r-jwt-access-secret',
  'itemba-r-jwt-refresh-secret',
  'dev-secret',
  'development',
  'test',
  'secret',
]);

export class EnvironmentVariables {
  @IsEnum(NodeEnv)
  NODE_ENV: NodeEnv = NodeEnv.Development;

  @IsNumber()
  @IsOptional()
  PORT: number = 3001;

  @IsString()
  @IsOptional()
  API_PREFIX: string = 'api/v1';

  @IsString()
  @IsOptional()
  CORS_ORIGIN: string = 'http://localhost:3000';

  @IsString()
  @IsOptional()
  FRONTEND_URL?: string;

  @IsString()
  @IsOptional()
  APP_URL?: string;

  @IsString()
  DATABASE_URL!: string;

  @IsString()
  @MinLength(32)
  JWT_ACCESS_SECRET!: string;

  @IsString()
  @IsOptional()
  JWT_ACCESS_EXPIRES_IN: string = 'never';

  @IsString()
  @MinLength(32)
  JWT_REFRESH_SECRET!: string;

  @IsString()
  @IsOptional()
  JWT_REFRESH_EXPIRES_IN: string = 'never';

  // Required outside development. Used to encrypt TOTP secrets at rest.
  @IsString()
  @IsOptional()
  @MinLength(32)
  TWO_FACTOR_ENCRYPTION_KEY?: string;

  // Required outside development. Adds entropy when hashing refresh tokens.
  @IsString()
  @IsOptional()
  REFRESH_TOKEN_PEPPER?: string;

  // Required outside development. Used by EncryptionService for field-level
  // encryption (integration credentials, etc.). MUST be distinct from JWT
  // secrets — never share key material across security domains.
  @IsString()
  @IsOptional()
  @MinLength(32)
  APP_ENCRYPTION_KEY?: string;

  @IsString()
  @IsOptional()
  ALLOW_PUBLIC_REGISTRATION: string = 'false';

  @IsString()
  @IsOptional()
  REDIS_URL?: string;

  @IsString()
  @IsOptional()
  REDIS_HOST?: string;

  @IsNumber()
  @IsOptional()
  REDIS_PORT?: number;

  @IsString()
  @IsOptional()
  REDIS_PASSWORD?: string;

  @IsString()
  @IsOptional()
  SMTP_HOST?: string;

  @IsString()
  @IsOptional()
  SMTP_USER?: string;

  @IsString()
  @IsOptional()
  SMTP_PASS?: string;

  @IsString()
  @IsOptional()
  SMTP_FROM?: string;

  @IsString()
  @IsOptional()
  STORAGE_LOCAL_PATH?: string;

  @IsString()
  @IsOptional()
  LOCAL_STORAGE_PATH?: string;

  @IsString()
  @IsOptional()
  STORAGE_PATH?: string;

  @IsString()
  @IsOptional()
  BACKUPS_DIR?: string;

  @IsString()
  @IsOptional()
  BACKUP_STORAGE_PATH?: string;

  @IsString()
  @IsOptional()
  EXPORTS_DIR?: string;

  @IsString()
  @IsOptional()
  MSAIDIZI_DEVICE_PAIRING_ENABLED: string = 'false';

  @IsString()
  @IsOptional()
  MSAIDIZI_DEVICE_CHANNEL_ENABLED: string = 'false';

  @IsString()
  @IsOptional()
  MSAIDIZI_DIRECT_MTLS_ENABLED: string = 'false';

  @IsInt()
  @Min(1)
  @Max(65_535)
  @IsOptional()
  MSAIDIZI_DIRECT_MTLS_PORT: number = 3443;

  @IsString()
  @IsOptional()
  MSAIDIZI_DIRECT_MTLS_BIND_ADDRESS: string = '0.0.0.0';

  @IsString()
  @IsOptional()
  MSAIDIZI_SUPERVISOR_ENROLLMENT_ENABLED: string = 'false';

  @IsString()
  @IsOptional()
  MSAIDIZI_CLOUD_ZERO_RETENTION_CONFIRMED?: string;

  @IsString()
  @IsOptional()
  MSAIDIZI_PROVIDER_CONTRACT_ATTESTATION_PATH?: string;

  @IsString()
  @IsOptional()
  MSAIDIZI_PROVIDER_CONTRACT_PUBLIC_KEY_PATH?: string;

  @IsString()
  @IsOptional()
  MSAIDIZI_PROVIDER_CONTRACT_KEY_ID?: string;

  @IsString()
  @IsOptional()
  MSAIDIZI_PROVIDER_CONTRACT_ATTESTATION_SHA256?: string;

  @IsString()
  @IsOptional()
  MSAIDIZI_PROVIDER_CONTRACT_SIGNER_SPKI_SHA256?: string;

  @IsString()
  @IsOptional()
  MSAIDIZI_PROVIDER_ACCOUNT_ID?: string;

  @IsString()
  @IsOptional()
  MSAIDIZI_PROVIDER_CREDENTIAL_KEY_ID?: string;

  @IsString()
  @IsOptional()
  MSAIDIZI_MODEL: string = 'claude-opus-5';

  @IsString()
  @IsOptional()
  MSAIDIZI_CLASSIFIER_MODEL: string = 'claude-haiku-4-5';

  @IsString()
  @IsOptional()
  MSAIDIZI_ADAPTIVE_REASONING_ENABLED: string = 'false';

  @IsInt()
  @Min(1)
  @IsOptional()
  MSAIDIZI_AUTONOMY_MAX_WALL_SECONDS: number = 7_200;

  @IsInt()
  @Min(1)
  @IsOptional()
  MSAIDIZI_AUTONOMY_MAX_MODEL_TURNS: number = 200;

  @IsInt()
  @Min(1)
  @IsOptional()
  MSAIDIZI_AUTONOMY_MAX_TOOL_ATTEMPTS: number = 500;

  @IsInt()
  @Min(0)
  @IsOptional()
  MSAIDIZI_AUTONOMY_MAX_MUTATIONS: number = 100;

  @IsString()
  @IsOptional()
  MSAIDIZI_AUTONOMY_MAX_LOCAL_BYTES: string = '5368709120';

  @IsString()
  @IsOptional()
  MSAIDIZI_AUTONOMY_MAX_EGRESS_BYTES: string = '262144000';

  @IsNumber()
  @Min(0)
  @Max(99_999_999.9999)
  @IsOptional()
  MSAIDIZI_AUTONOMY_MAX_MODEL_COST_USD: number = 20;

  @IsInt()
  @Min(1)
  @IsOptional()
  MSAIDIZI_ADAPTIVE_REASONING_MAX_INPUT_BYTES: number = 65_536;

  @IsInt()
  @Min(1)
  @IsOptional()
  MSAIDIZI_ADAPTIVE_REASONING_MAX_OUTPUT_TOKENS: number = 2_048;

  @IsNumber()
  @Min(Number.EPSILON)
  @IsOptional()
  MSAIDIZI_MODEL_INPUT_USD_PER_MILLION_TOKENS: number = 30;

  @IsNumber()
  @Min(Number.EPSILON)
  @IsOptional()
  MSAIDIZI_MODEL_OUTPUT_USD_PER_MILLION_TOKENS: number = 150;

  @IsNumber()
  @Min(Number.EPSILON)
  @IsOptional()
  MSAIDIZI_MODEL_CACHE_READ_USD_PER_MILLION_TOKENS: number = 30;

  @IsNumber()
  @Min(Number.EPSILON)
  @IsOptional()
  MSAIDIZI_MODEL_CACHE_CREATION_USD_PER_MILLION_TOKENS: number = 37.5;

  @IsInt()
  @Min(1)
  @IsOptional()
  MSAIDIZI_PROPOSAL_MAX_INPUT_TOKENS_PER_TURN: number = 200_000;

  @IsInt()
  @Min(1)
  @IsOptional()
  MSAIDIZI_PROPOSAL_QUOTA_WINDOW_SECONDS: number = 3_600;

  @IsInt()
  @Min(0)
  @IsOptional()
  MSAIDIZI_PROPOSAL_MAX_MODEL_TURNS_PER_WINDOW: number = 200;

  @IsNumber()
  @Min(0)
  @Max(99_999_999.9999)
  @IsOptional()
  MSAIDIZI_PROPOSAL_MAX_COST_USD_PER_WINDOW: number = 20;

  @IsInt()
  @Min(1)
  @IsOptional()
  MSAIDIZI_PROPOSAL_RECEIPT_TTL_SECONDS: number = 86_400;

  @IsInt()
  @Min(1)
  @IsOptional()
  MSAIDIZI_PROPOSAL_RESERVATION_TIMEOUT_SECONDS: number = 300;

  @IsString()
  @IsOptional()
  MSAIDIZI_DEVICE_PAIRING_PEPPER?: string;

  @IsString()
  @IsOptional()
  MSAIDIZI_DEVICE_LEASE_PEPPER?: string;

  @IsString()
  @IsOptional()
  MSAIDIZI_SUPERVISOR_ENROLLMENT_PEPPER?: string;

  @IsInt()
  @Min(60)
  @Max(900)
  @IsOptional()
  MSAIDIZI_SUPERVISOR_ENROLLMENT_TTL_SECONDS: number = 300;

  @IsString()
  @IsOptional()
  MSAIDIZI_ACTION_SIGNING_KEY_PATH?: string;

  @IsString()
  @IsOptional()
  MSAIDIZI_ACTION_SIGNING_KEY_ID?: string;

  @IsString()
  @IsOptional()
  MSAIDIZI_UPDATE_SUPERVISOR_ENABLED: string = 'false';

  @IsString()
  @IsOptional()
  MSAIDIZI_UPDATE_AUTOMATIC_ROLLOUT_ENABLED: string = 'false';

  @IsInt()
  @Min(-1)
  @Max(100)
  @IsOptional()
  MSAIDIZI_UPDATE_AUTOMATIC_MAX_RING: number = -1;

  @IsInt()
  @Min(5)
  @Max(300)
  @IsOptional()
  MSAIDIZI_UPDATE_ROLLOUT_SWEEP_SECONDS: number = 15;

  @IsInt()
  @Min(5)
  @Max(900)
  @IsOptional()
  MSAIDIZI_UPDATE_HEALTH_TIMEOUT_SECONDS: number = 600;

  @IsInt()
  @Min(1)
  @Max(899)
  @IsOptional()
  MSAIDIZI_UPDATE_MIN_HEALTHY_SOAK_SECONDS: number = 300;

  @IsInt()
  @Min(86_400)
  @Max(2_592_000)
  @IsOptional()
  MSAIDIZI_UPDATE_RING_0_MIN_DWELL_SECONDS: number = 86_400;

  @IsInt()
  @Min(86_400)
  @Max(2_592_000)
  @IsOptional()
  MSAIDIZI_UPDATE_RING_5_MIN_DWELL_SECONDS: number = 86_400;

  @IsInt()
  @Min(172_800)
  @Max(2_592_000)
  @IsOptional()
  MSAIDIZI_UPDATE_RING_25_MIN_DWELL_SECONDS: number = 172_800;

  @IsInt()
  @Min(259_200)
  @Max(2_592_000)
  @IsOptional()
  MSAIDIZI_UPDATE_RING_100_MIN_DWELL_SECONDS: number = 259_200;

  @IsString()
  @IsOptional()
  MSAIDIZI_UPDATE_SIGNING_KEY_PATH?: string;

  @IsString()
  @IsOptional()
  MSAIDIZI_UPDATE_SIGNING_KEY_ID?: string;

  @IsString()
  @IsOptional()
  MSAIDIZI_UPDATE_EVALUATOR_ENABLED: string = 'false';

  @IsString()
  @IsOptional()
  MSAIDIZI_EVALUATOR_KEY_ALLOWLIST_PATH?: string;

  @IsString()
  @IsOptional()
  MSAIDIZI_EVALUATOR_KEY_ALLOWLIST_SHA256?: string;

  @IsInt()
  @Min(0)
  @Max(300)
  @IsOptional()
  MSAIDIZI_EVALUATOR_MAX_CLOCK_SKEW_SECONDS: number = 60;

  @IsInt()
  @Min(60)
  @Max(604_800)
  @IsOptional()
  MSAIDIZI_EVALUATOR_MAX_ATTESTATION_AGE_SECONDS: number = 86_400;

  @IsString()
  @IsOptional()
  MSAIDIZI_EVALUATOR_MTLS_ENABLED: string = 'false';

  @IsInt()
  @Min(1)
  @Max(65_535)
  @IsOptional()
  MSAIDIZI_EVALUATOR_MTLS_PORT: number = 3444;

  @IsString()
  @IsOptional()
  MSAIDIZI_EVALUATOR_MTLS_BIND_ADDRESS: string = '127.0.0.1';

  @IsString()
  @IsOptional()
  MSAIDIZI_EVALUATOR_MTLS_SERVER_KEY_PATH?: string;

  @IsString()
  @IsOptional()
  MSAIDIZI_EVALUATOR_MTLS_SERVER_CERT_PATH?: string;

  @IsString()
  @IsOptional()
  MSAIDIZI_EVALUATOR_MTLS_CLIENT_CA_PATH?: string;

  @IsString()
  @IsOptional()
  MSAIDIZI_EVALUATOR_CLIENT_CERT_SHA256?: string;

  @IsString()
  @IsOptional()
  MSAIDIZI_EVALUATOR_CLIENT_SPKI_SHA256?: string;

  @IsString()
  @IsOptional()
  MSAIDIZI_ARTIFACT_ENCRYPTION_KEY?: string;

  @IsString()
  @IsOptional()
  MSAIDIZI_ARTIFACT_ROOT?: string;

  @IsString()
  @IsOptional()
  MSAIDIZI_RECOVERY_SUPERVISOR_ENABLED: string = 'false';

  @IsString()
  @IsOptional()
  MSAIDIZI_RECOVERY_SIGNING_KEY_PATH?: string;

  @IsString()
  @IsOptional()
  MSAIDIZI_RECOVERY_SIGNING_KEY_ID?: string;

  @IsString()
  @IsOptional()
  MSAIDIZI_AUDIT_SIGNER_ENABLED: string = 'false';

  @IsString()
  @IsOptional()
  MSAIDIZI_AUDIT_SIGNER_KILL_SWITCH: string = 'false';

  @IsString()
  @IsOptional()
  MSAIDIZI_AUDIT_SIGNER_KEY_ID?: string;

  @IsString()
  @IsOptional()
  MSAIDIZI_AUDIT_SIGNER_CLIENT_CERT_SHA256?: string;

  @IsString()
  @IsOptional()
  MSAIDIZI_AUDIT_SIGNER_CLIENT_SPKI_SHA256?: string;

  @IsInt()
  @Min(1)
  @Max(1_000)
  @IsOptional()
  MSAIDIZI_AUDIT_SIGNER_MAX_SEGMENT_EVENTS: number = 256;

  @IsInt()
  @Min(30)
  @Max(3_600)
  @IsOptional()
  MSAIDIZI_AUDIT_SIGNER_CHECKPOINT_TTL_SECONDS: number = 300;

  @IsInt()
  @Min(0)
  @Max(300)
  @IsOptional()
  MSAIDIZI_AUDIT_SIGNER_MAX_CLOCK_SKEW_SECONDS: number = 30;

  @IsString()
  @IsOptional()
  MSAIDIZI_DIRECT_MTLS_SERVER_KEY_PATH?: string;

  @IsString()
  @IsOptional()
  MSAIDIZI_DIRECT_MTLS_SERVER_CERT_PATH?: string;

  @IsString()
  @IsOptional()
  MSAIDIZI_DIRECT_MTLS_CLIENT_CA_PATH?: string;

  @IsString()
  @IsOptional()
  MSAIDIZI_CRUD_EVIDENCE_PATH?: string;

  @IsString()
  @IsOptional()
  MSAIDIZI_CRUD_EVIDENCE_PUBLIC_KEY_PATH?: string;

  @IsString()
  @IsOptional()
  MSAIDIZI_CRUD_EVIDENCE_KEY_ID?: string;

  @IsString()
  @IsOptional()
  MSAIDIZI_CRUD_EVIDENCE_APPLICATION_BUILD_DIGEST?: string;

  @IsString()
  @IsOptional()
  MSAIDIZI_CRUD_EVIDENCE_PRISMA_SCHEMA_MIGRATION_DIGEST?: string;

  @IsNumber()
  @IsOptional()
  MSAIDIZI_CRUD_EVIDENCE_MAX_AGE_HOURS: number = 168;

  @IsString()
  @IsOptional()
  MSAIDIZI_PRODUCTION_PROMOTION_INVENTORY_PATH?: string;

  @IsString()
  @IsOptional()
  MSAIDIZI_PRODUCTION_ACCEPTED_INVENTORY_SHA256?: string;

  @IsString()
  @IsOptional()
  MSAIDIZI_PRODUCTION_ACCEPTED_EVIDENCE_SHA256?: string;

  @IsString()
  @IsOptional()
  MSAIDIZI_PRODUCTION_ACCEPTED_IMAGE_DIGEST?: string;

  @IsString()
  @IsOptional()
  MSAIDIZI_DEPLOYED_BACKEND_IMAGE_REFERENCE?: string;

  @IsString()
  @IsOptional()
  MSAIDIZI_DEPLOYED_SOURCE_COMMIT?: string;

  @IsString()
  @IsOptional()
  MSAIDIZI_DEPLOYED_SOURCE_REPOSITORY?: string;
}

export function envValidate(raw: Record<string, unknown>) {
  const config = plainToInstance(EnvironmentVariables, raw, { enableImplicitConversion: true });
  const errors = validateSync(config, { skipMissingProperties: false });
  if (errors.length > 0) {
    throw new Error(
      `Invalid environment configuration:\n${errors
        .map((e) => `  - ${e.property}: ${Object.values(e.constraints ?? {}).join(', ')}`)
        .join('\n')}`,
    );
  }

  const enabled = (value: string | undefined) =>
    ['1', 'true', 'yes', 'on'].includes((value ?? '').trim().toLowerCase());
  for (const [name, value] of [
    ['MSAIDIZI_AUDIT_SIGNER_ENABLED', raw.MSAIDIZI_AUDIT_SIGNER_ENABLED],
    ['MSAIDIZI_AUDIT_SIGNER_KILL_SWITCH', raw.MSAIDIZI_AUDIT_SIGNER_KILL_SWITCH],
    ['MSAIDIZI_SUPERVISOR_ENROLLMENT_ENABLED', raw.MSAIDIZI_SUPERVISOR_ENROLLMENT_ENABLED],
    ['MSAIDIZI_DIRECT_MTLS_ENABLED', raw.MSAIDIZI_DIRECT_MTLS_ENABLED],
    ['MSAIDIZI_UPDATE_AUTOMATIC_ROLLOUT_ENABLED', raw.MSAIDIZI_UPDATE_AUTOMATIC_ROLLOUT_ENABLED],
  ] as const) {
    if (
      value !== undefined &&
      !['0', '1', 'false', 'true', 'no', 'yes', 'off', 'on'].includes(
        String(value).trim().toLowerCase(),
      )
    ) {
      throw new Error(`${name} must be an explicit boolean value.`);
    }
  }
  if (
    raw.MSAIDIZI_ADAPTIVE_REASONING_ENABLED !== undefined &&
    !['0', '1', 'false', 'true', 'no', 'yes', 'off', 'on'].includes(
      String(raw.MSAIDIZI_ADAPTIVE_REASONING_ENABLED).trim().toLowerCase(),
    )
  ) {
    throw new Error('MSAIDIZI_ADAPTIVE_REASONING_ENABLED must be an explicit boolean value.');
  }
  if (
    raw.MSAIDIZI_UPDATE_EVALUATOR_ENABLED !== undefined &&
    !['0', '1', 'false', 'true', 'no', 'yes', 'off', 'on'].includes(
      String(raw.MSAIDIZI_UPDATE_EVALUATOR_ENABLED).trim().toLowerCase(),
    )
  ) {
    throw new Error('MSAIDIZI_UPDATE_EVALUATOR_ENABLED must be an explicit boolean value.');
  }
  if (
    raw.MSAIDIZI_EVALUATOR_MTLS_ENABLED !== undefined &&
    !['0', '1', 'false', 'true', 'no', 'yes', 'off', 'on'].includes(
      String(raw.MSAIDIZI_EVALUATOR_MTLS_ENABLED).trim().toLowerCase(),
    )
  ) {
    throw new Error('MSAIDIZI_EVALUATOR_MTLS_ENABLED must be an explicit boolean value.');
  }
  const pgBigIntMax = 9_223_372_036_854_775_807n;
  for (const [name, value, allowZero] of [
    ['MSAIDIZI_AUTONOMY_MAX_LOCAL_BYTES', config.MSAIDIZI_AUTONOMY_MAX_LOCAL_BYTES, false],
    ['MSAIDIZI_AUTONOMY_MAX_EGRESS_BYTES', config.MSAIDIZI_AUTONOMY_MAX_EGRESS_BYTES, true],
  ] as const) {
    if (!/^(0|[1-9][0-9]*)$/.test(value)) {
      throw new Error(`${name} must be a canonical non-negative integer.`);
    }
    const parsed = BigInt(value);
    if ((!allowZero && parsed === 0n) || parsed > pgBigIntMax) {
      throw new Error(`${name} is outside the supported PostgreSQL bigint range.`);
    }
  }
  if (
    enabled(config.MSAIDIZI_DEVICE_PAIRING_ENABLED) &&
    (!config.MSAIDIZI_DEVICE_PAIRING_PEPPER ||
      config.MSAIDIZI_DEVICE_PAIRING_PEPPER.length < 32 ||
      /replace|change.?me|placeholder/i.test(config.MSAIDIZI_DEVICE_PAIRING_PEPPER))
  ) {
    throw new Error('MSAIDIZI_DEVICE_PAIRING_PEPPER is required when device pairing is enabled.');
  }
  if (enabled(config.MSAIDIZI_SUPERVISOR_ENROLLMENT_ENABLED)) {
    if (
      !config.MSAIDIZI_SUPERVISOR_ENROLLMENT_PEPPER ||
      config.MSAIDIZI_SUPERVISOR_ENROLLMENT_PEPPER.length < 32 ||
      /replace|change.?me|placeholder/i.test(config.MSAIDIZI_SUPERVISOR_ENROLLMENT_PEPPER)
    ) {
      throw new Error(
        'MSAIDIZI_SUPERVISOR_ENROLLMENT_PEPPER is required when supervisor enrollment is enabled.',
      );
    }
    if (!enabled(config.MSAIDIZI_DIRECT_MTLS_ENABLED)) {
      throw new Error('Supervisor enrollment requires MSAIDIZI_DIRECT_MTLS_ENABLED=true.');
    }
  }
  if (enabled(config.MSAIDIZI_DEVICE_CHANNEL_ENABLED)) {
    const required: Array<[string, string | undefined]> = [
      ['MSAIDIZI_DEVICE_LEASE_PEPPER', config.MSAIDIZI_DEVICE_LEASE_PEPPER],
      ['MSAIDIZI_ACTION_SIGNING_KEY_PATH', config.MSAIDIZI_ACTION_SIGNING_KEY_PATH],
      ['MSAIDIZI_ACTION_SIGNING_KEY_ID', config.MSAIDIZI_ACTION_SIGNING_KEY_ID],
    ];
    const missing = required.filter(([, value]) => !value).map(([key]) => key);
    if (missing.length > 0) {
      throw new Error(
        `Missing device-channel configuration: ${missing.join(', ')}. The channel fails closed.`,
      );
    }
    if (
      config.MSAIDIZI_DEVICE_LEASE_PEPPER!.length < 32 ||
      /replace|change.?me|placeholder/i.test(config.MSAIDIZI_DEVICE_LEASE_PEPPER!)
    ) {
      throw new Error('MSAIDIZI_DEVICE_LEASE_PEPPER must contain at least 32 characters.');
    }
    if (!isAbsolute(config.MSAIDIZI_ACTION_SIGNING_KEY_PATH!)) {
      throw new Error('MSAIDIZI_ACTION_SIGNING_KEY_PATH must be an absolute external path.');
    }
  }
  if (enabled(config.MSAIDIZI_DIRECT_MTLS_ENABLED)) {
    const required: Array<[string, string | undefined]> = [
      ['MSAIDIZI_DIRECT_MTLS_SERVER_KEY_PATH', config.MSAIDIZI_DIRECT_MTLS_SERVER_KEY_PATH],
      ['MSAIDIZI_DIRECT_MTLS_SERVER_CERT_PATH', config.MSAIDIZI_DIRECT_MTLS_SERVER_CERT_PATH],
      ['MSAIDIZI_DIRECT_MTLS_CLIENT_CA_PATH', config.MSAIDIZI_DIRECT_MTLS_CLIENT_CA_PATH],
    ];
    const missing = required.filter(([, value]) => !value).map(([key]) => key);
    if (missing.length > 0) {
      throw new Error(`Missing direct mTLS configuration: ${missing.join(', ')}.`);
    }
    for (const [name, value] of required) {
      if (!isAbsolute(value!)) throw new Error(`${name} must be an absolute external path.`);
    }
    if (config.MSAIDIZI_DIRECT_MTLS_PORT === config.PORT) {
      throw new Error('MSAIDIZI_DIRECT_MTLS_PORT must differ from the ordinary API port.');
    }
    if (isIP(config.MSAIDIZI_DIRECT_MTLS_BIND_ADDRESS) === 0) {
      throw new Error('MSAIDIZI_DIRECT_MTLS_BIND_ADDRESS must be a literal IP address.');
    }
    if (
      enabled(config.MSAIDIZI_EVALUATOR_MTLS_ENABLED) &&
      config.MSAIDIZI_DIRECT_MTLS_PORT === config.MSAIDIZI_EVALUATOR_MTLS_PORT
    ) {
      throw new Error(
        'MSAIDIZI_DIRECT_MTLS_PORT must differ from the dedicated evaluator mTLS port.',
      );
    }
  }
  if (enabled(config.MSAIDIZI_UPDATE_SUPERVISOR_ENABLED)) {
    const required: Array<[string, string | undefined]> = [
      ['MSAIDIZI_UPDATE_SIGNING_KEY_PATH', config.MSAIDIZI_UPDATE_SIGNING_KEY_PATH],
      ['MSAIDIZI_UPDATE_SIGNING_KEY_ID', config.MSAIDIZI_UPDATE_SIGNING_KEY_ID],
    ];
    const missing = required.filter(([, value]) => !value).map(([name]) => name);
    if (missing.length > 0) {
      throw new Error(`Missing trusted update-supervisor configuration: ${missing.join(', ')}.`);
    }
    if (!isAbsolute(config.MSAIDIZI_UPDATE_SIGNING_KEY_PATH!)) {
      throw new Error('MSAIDIZI_UPDATE_SIGNING_KEY_PATH must be an absolute external path.');
    }
    if (
      !enabled(config.MSAIDIZI_DEVICE_CHANNEL_ENABLED) ||
      !enabled(config.MSAIDIZI_DIRECT_MTLS_ENABLED)
    ) {
      throw new Error(
        'The update supervisor requires the direct-mTLS device channel to be enabled.',
      );
    }
  }
  if (enabled(config.MSAIDIZI_UPDATE_AUTOMATIC_ROLLOUT_ENABLED)) {
    if (
      !enabled(config.MSAIDIZI_UPDATE_SUPERVISOR_ENABLED) ||
      !enabled((raw.MSAIDIZI_AUTONOMY_ENABLED as string | undefined) ?? 'false') ||
      !enabled((raw.MSAIDIZI_AUTOPILOT_ENABLED as string | undefined) ?? 'false')
    ) {
      throw new Error(
        'Automatic update rollout requires the trusted update supervisor, autonomy, and Autopilot to be enabled.',
      );
    }
    if (![0, 5, 25, 100].includes(config.MSAIDIZI_UPDATE_AUTOMATIC_MAX_RING)) {
      throw new Error(
        'Automatic update rollout requires an explicit MSAIDIZI_UPDATE_AUTOMATIC_MAX_RING of 0, 5, 25, or 100.',
      );
    }
  } else if (![-1, 0, 5, 25, 100].includes(config.MSAIDIZI_UPDATE_AUTOMATIC_MAX_RING)) {
    throw new Error('MSAIDIZI_UPDATE_AUTOMATIC_MAX_RING must be -1, 0, 5, 25, or 100.');
  }
  if (
    config.MSAIDIZI_UPDATE_MIN_HEALTHY_SOAK_SECONDS >= config.MSAIDIZI_UPDATE_HEALTH_TIMEOUT_SECONDS
  ) {
    throw new Error(
      'MSAIDIZI_UPDATE_HEALTH_TIMEOUT_SECONDS must exceed MSAIDIZI_UPDATE_MIN_HEALTHY_SOAK_SECONDS.',
    );
  }
  if (enabled(config.MSAIDIZI_UPDATE_EVALUATOR_ENABLED)) {
    const required: Array<[string, string | undefined]> = [
      ['MSAIDIZI_EVALUATOR_KEY_ALLOWLIST_PATH', config.MSAIDIZI_EVALUATOR_KEY_ALLOWLIST_PATH],
      ['MSAIDIZI_EVALUATOR_KEY_ALLOWLIST_SHA256', config.MSAIDIZI_EVALUATOR_KEY_ALLOWLIST_SHA256],
      ['MSAIDIZI_ARTIFACT_ENCRYPTION_KEY', config.MSAIDIZI_ARTIFACT_ENCRYPTION_KEY],
      ['MSAIDIZI_ARTIFACT_ROOT', config.MSAIDIZI_ARTIFACT_ROOT],
      ['MSAIDIZI_EVALUATOR_MTLS_SERVER_KEY_PATH', config.MSAIDIZI_EVALUATOR_MTLS_SERVER_KEY_PATH],
      ['MSAIDIZI_EVALUATOR_MTLS_SERVER_CERT_PATH', config.MSAIDIZI_EVALUATOR_MTLS_SERVER_CERT_PATH],
      ['MSAIDIZI_EVALUATOR_MTLS_CLIENT_CA_PATH', config.MSAIDIZI_EVALUATOR_MTLS_CLIENT_CA_PATH],
      ['MSAIDIZI_EVALUATOR_CLIENT_CERT_SHA256', config.MSAIDIZI_EVALUATOR_CLIENT_CERT_SHA256],
      ['MSAIDIZI_EVALUATOR_CLIENT_SPKI_SHA256', config.MSAIDIZI_EVALUATOR_CLIENT_SPKI_SHA256],
    ];
    const missing = required.filter(([, value]) => !value).map(([name]) => name);
    if (missing.length > 0) {
      throw new Error(`Missing signed evaluator configuration: ${missing.join(', ')}.`);
    }
    if (!isAbsolute(config.MSAIDIZI_EVALUATOR_KEY_ALLOWLIST_PATH!)) {
      throw new Error('MSAIDIZI_EVALUATOR_KEY_ALLOWLIST_PATH must be an absolute external path.');
    }
    if (!enabled(config.MSAIDIZI_EVALUATOR_MTLS_ENABLED)) {
      throw new Error(
        'MSAIDIZI_UPDATE_EVALUATOR_ENABLED requires the dedicated evaluator mTLS listener.',
      );
    }
    if (config.MSAIDIZI_EVALUATOR_MTLS_PORT === config.PORT) {
      throw new Error('MSAIDIZI_EVALUATOR_MTLS_PORT must differ from the ordinary API port.');
    }
    if (isIP(config.MSAIDIZI_EVALUATOR_MTLS_BIND_ADDRESS) === 0) {
      throw new Error('MSAIDIZI_EVALUATOR_MTLS_BIND_ADDRESS must be a literal IP address.');
    }
    const evaluatorTlsPaths: Array<[string, string]> = [
      ['MSAIDIZI_EVALUATOR_MTLS_SERVER_KEY_PATH', config.MSAIDIZI_EVALUATOR_MTLS_SERVER_KEY_PATH!],
      [
        'MSAIDIZI_EVALUATOR_MTLS_SERVER_CERT_PATH',
        config.MSAIDIZI_EVALUATOR_MTLS_SERVER_CERT_PATH!,
      ],
      ['MSAIDIZI_EVALUATOR_MTLS_CLIENT_CA_PATH', config.MSAIDIZI_EVALUATOR_MTLS_CLIENT_CA_PATH!],
    ];
    for (const [name, value] of evaluatorTlsPaths) {
      if (!isAbsolute(value)) throw new Error(`${name} must be an absolute external path.`);
    }
    if (new Set(evaluatorTlsPaths.map(([, value]) => value)).size !== evaluatorTlsPaths.length) {
      throw new Error('Evaluator mTLS key, certificate, and client CA paths must be distinct.');
    }
    for (const [evaluatorName, evaluatorPath] of evaluatorTlsPaths) {
      for (const [otherName, otherPath] of [
        ['MSAIDIZI_ACTION_SIGNING_KEY_PATH', config.MSAIDIZI_ACTION_SIGNING_KEY_PATH],
        ['MSAIDIZI_UPDATE_SIGNING_KEY_PATH', config.MSAIDIZI_UPDATE_SIGNING_KEY_PATH],
        ['MSAIDIZI_RECOVERY_SIGNING_KEY_PATH', config.MSAIDIZI_RECOVERY_SIGNING_KEY_PATH],
        ['MSAIDIZI_DIRECT_MTLS_SERVER_KEY_PATH', config.MSAIDIZI_DIRECT_MTLS_SERVER_KEY_PATH],
        ['MSAIDIZI_DIRECT_MTLS_SERVER_CERT_PATH', config.MSAIDIZI_DIRECT_MTLS_SERVER_CERT_PATH],
        ['MSAIDIZI_DIRECT_MTLS_CLIENT_CA_PATH', config.MSAIDIZI_DIRECT_MTLS_CLIENT_CA_PATH],
        ['MSAIDIZI_EVALUATOR_KEY_ALLOWLIST_PATH', config.MSAIDIZI_EVALUATOR_KEY_ALLOWLIST_PATH],
      ] as const) {
        if (otherPath && evaluatorPath === otherPath) {
          throw new Error(`${evaluatorName} and ${otherName} must be distinct.`);
        }
      }
    }
    for (const [name, value] of [
      ['MSAIDIZI_EVALUATOR_CLIENT_CERT_SHA256', config.MSAIDIZI_EVALUATOR_CLIENT_CERT_SHA256],
      ['MSAIDIZI_EVALUATOR_CLIENT_SPKI_SHA256', config.MSAIDIZI_EVALUATOR_CLIENT_SPKI_SHA256],
    ] as const) {
      if (!/^[0-9a-f]{64}$/.test(value!)) {
        throw new Error(`${name} must be a lowercase SHA-256 pin.`);
      }
    }
    if (
      config.MSAIDIZI_EVALUATOR_CLIENT_CERT_SHA256 === config.MSAIDIZI_EVALUATOR_CLIENT_SPKI_SHA256
    ) {
      throw new Error('Evaluator certificate and SPKI pins must be independently derived.');
    }
    if (!/^[0-9a-f]{64}$/.test(config.MSAIDIZI_EVALUATOR_KEY_ALLOWLIST_SHA256!)) {
      throw new Error('MSAIDIZI_EVALUATOR_KEY_ALLOWLIST_SHA256 must be a lowercase SHA-256 pin.');
    }
    const artifactKey = Buffer.from(config.MSAIDIZI_ARTIFACT_ENCRYPTION_KEY!, 'base64');
    if (
      artifactKey.length !== 32 ||
      artifactKey.toString('base64') !== config.MSAIDIZI_ARTIFACT_ENCRYPTION_KEY
    ) {
      throw new Error('MSAIDIZI_ARTIFACT_ENCRYPTION_KEY must be canonical base64 for 32 bytes.');
    }
    artifactKey.fill(0);
    if (!isAbsolute(config.MSAIDIZI_ARTIFACT_ROOT!)) {
      throw new Error(
        'MSAIDIZI_ARTIFACT_ROOT must be absolute when the signed evaluator is enabled.',
      );
    }
    if (!enabled((raw.MSAIDIZI_AUTONOMY_ENABLED as string | undefined) ?? 'false')) {
      throw new Error('MSAIDIZI_UPDATE_EVALUATOR_ENABLED requires MSAIDIZI_AUTONOMY_ENABLED=true.');
    }
    for (const [otherName, otherPath] of [
      ['MSAIDIZI_ACTION_SIGNING_KEY_PATH', config.MSAIDIZI_ACTION_SIGNING_KEY_PATH],
      ['MSAIDIZI_UPDATE_SIGNING_KEY_PATH', config.MSAIDIZI_UPDATE_SIGNING_KEY_PATH],
      ['MSAIDIZI_RECOVERY_SIGNING_KEY_PATH', config.MSAIDIZI_RECOVERY_SIGNING_KEY_PATH],
      ['MSAIDIZI_DIRECT_MTLS_SERVER_KEY_PATH', config.MSAIDIZI_DIRECT_MTLS_SERVER_KEY_PATH],
      ['MSAIDIZI_DIRECT_MTLS_SERVER_CERT_PATH', config.MSAIDIZI_DIRECT_MTLS_SERVER_CERT_PATH],
      ['MSAIDIZI_DIRECT_MTLS_CLIENT_CA_PATH', config.MSAIDIZI_DIRECT_MTLS_CLIENT_CA_PATH],
      ['MSAIDIZI_EVALUATOR_MTLS_SERVER_KEY_PATH', config.MSAIDIZI_EVALUATOR_MTLS_SERVER_KEY_PATH],
      ['MSAIDIZI_EVALUATOR_MTLS_SERVER_CERT_PATH', config.MSAIDIZI_EVALUATOR_MTLS_SERVER_CERT_PATH],
      ['MSAIDIZI_EVALUATOR_MTLS_CLIENT_CA_PATH', config.MSAIDIZI_EVALUATOR_MTLS_CLIENT_CA_PATH],
    ] as const) {
      if (otherPath && config.MSAIDIZI_EVALUATOR_KEY_ALLOWLIST_PATH === otherPath) {
        throw new Error(`MSAIDIZI_EVALUATOR_KEY_ALLOWLIST_PATH and ${otherName} must be distinct.`);
      }
    }
  }
  if (
    enabled(config.MSAIDIZI_EVALUATOR_MTLS_ENABLED) &&
    !enabled(config.MSAIDIZI_UPDATE_EVALUATOR_ENABLED)
  ) {
    throw new Error('The evaluator mTLS listener cannot be enabled without the signed evaluator.');
  }
  if (enabled(config.MSAIDIZI_RECOVERY_SUPERVISOR_ENABLED)) {
    const required: Array<[string, string | undefined]> = [
      ['MSAIDIZI_RECOVERY_SIGNING_KEY_PATH', config.MSAIDIZI_RECOVERY_SIGNING_KEY_PATH],
      ['MSAIDIZI_RECOVERY_SIGNING_KEY_ID', config.MSAIDIZI_RECOVERY_SIGNING_KEY_ID],
    ];
    const missing = required.filter(([, value]) => !value).map(([name]) => name);
    if (missing.length > 0) {
      throw new Error(`Missing trusted recovery-supervisor configuration: ${missing.join(', ')}.`);
    }
    if (!isAbsolute(config.MSAIDIZI_RECOVERY_SIGNING_KEY_PATH!)) {
      throw new Error('MSAIDIZI_RECOVERY_SIGNING_KEY_PATH must be an absolute external path.');
    }
    if (
      !enabled(config.MSAIDIZI_DEVICE_CHANNEL_ENABLED) ||
      !enabled(config.MSAIDIZI_DIRECT_MTLS_ENABLED)
    ) {
      throw new Error(
        'The recovery supervisor requires the direct-mTLS device channel to be enabled.',
      );
    }
  }
  if (enabled(config.MSAIDIZI_AUDIT_SIGNER_ENABLED)) {
    const required: Array<[string, string | undefined]> = [
      ['MSAIDIZI_AUDIT_SIGNER_KEY_ID', config.MSAIDIZI_AUDIT_SIGNER_KEY_ID],
      ['MSAIDIZI_AUDIT_SIGNER_CLIENT_CERT_SHA256', config.MSAIDIZI_AUDIT_SIGNER_CLIENT_CERT_SHA256],
      ['MSAIDIZI_AUDIT_SIGNER_CLIENT_SPKI_SHA256', config.MSAIDIZI_AUDIT_SIGNER_CLIENT_SPKI_SHA256],
    ];
    const missing = required.filter(([, value]) => !value).map(([name]) => name);
    if (missing.length > 0) {
      throw new Error(`Missing trusted audit-signer configuration: ${missing.join(', ')}.`);
    }
    if (!enabled(config.MSAIDIZI_DIRECT_MTLS_ENABLED)) {
      throw new Error('The audit signer requires the direct-mTLS listener to be enabled.');
    }
    if (!/^[A-Za-z0-9._-]{1,128}$/.test(config.MSAIDIZI_AUDIT_SIGNER_KEY_ID!)) {
      throw new Error('MSAIDIZI_AUDIT_SIGNER_KEY_ID has an invalid format.');
    }
    for (const [name, value] of required.slice(1)) {
      if (!/^[0-9a-f]{64}$/.test(value!)) {
        throw new Error(`${name} must be a lowercase SHA-256 pin.`);
      }
    }
    if (
      config.MSAIDIZI_AUDIT_SIGNER_CLIENT_CERT_SHA256 ===
      config.MSAIDIZI_AUDIT_SIGNER_CLIENT_SPKI_SHA256
    ) {
      throw new Error('Audit-signer certificate and SPKI pins must be independently derived.');
    }
  }
  if (
    (enabled(config.MSAIDIZI_DEVICE_PAIRING_ENABLED) ||
      enabled(config.MSAIDIZI_DEVICE_CHANNEL_ENABLED) ||
      enabled(config.MSAIDIZI_SUPERVISOR_ENROLLMENT_ENABLED)) &&
    !enabled(config.MSAIDIZI_DIRECT_MTLS_ENABLED)
  ) {
    throw new Error(
      'Device pairing/channel activation requires MSAIDIZI_DIRECT_MTLS_ENABLED=true.',
    );
  }
  if (
    config.MSAIDIZI_ACTION_SIGNING_KEY_PATH &&
    config.MSAIDIZI_DIRECT_MTLS_SERVER_KEY_PATH &&
    config.MSAIDIZI_ACTION_SIGNING_KEY_PATH === config.MSAIDIZI_DIRECT_MTLS_SERVER_KEY_PATH
  ) {
    throw new Error('Action-token and HTTPS server private keys must be distinct.');
  }
  for (const [otherName, otherPath] of [
    ['MSAIDIZI_ACTION_SIGNING_KEY_PATH', config.MSAIDIZI_ACTION_SIGNING_KEY_PATH],
    ['MSAIDIZI_DIRECT_MTLS_SERVER_KEY_PATH', config.MSAIDIZI_DIRECT_MTLS_SERVER_KEY_PATH],
  ] as const) {
    if (
      config.MSAIDIZI_UPDATE_SIGNING_KEY_PATH &&
      otherPath &&
      config.MSAIDIZI_UPDATE_SIGNING_KEY_PATH === otherPath
    ) {
      throw new Error(`MSAIDIZI_UPDATE_SIGNING_KEY_PATH and ${otherName} must be distinct.`);
    }
  }
  for (const [otherName, otherPath] of [
    ['MSAIDIZI_ACTION_SIGNING_KEY_PATH', config.MSAIDIZI_ACTION_SIGNING_KEY_PATH],
    ['MSAIDIZI_UPDATE_SIGNING_KEY_PATH', config.MSAIDIZI_UPDATE_SIGNING_KEY_PATH],
    ['MSAIDIZI_DIRECT_MTLS_SERVER_KEY_PATH', config.MSAIDIZI_DIRECT_MTLS_SERVER_KEY_PATH],
  ] as const) {
    if (
      config.MSAIDIZI_RECOVERY_SIGNING_KEY_PATH &&
      otherPath &&
      config.MSAIDIZI_RECOVERY_SIGNING_KEY_PATH === otherPath
    ) {
      throw new Error(`MSAIDIZI_RECOVERY_SIGNING_KEY_PATH and ${otherName} must be distinct.`);
    }
  }
  if (
    config.MSAIDIZI_DEVICE_PAIRING_PEPPER &&
    config.MSAIDIZI_DEVICE_LEASE_PEPPER &&
    config.MSAIDIZI_DEVICE_PAIRING_PEPPER === config.MSAIDIZI_DEVICE_LEASE_PEPPER
  ) {
    throw new Error('Device pairing and lease peppers must be distinct.');
  }
  for (const [otherName, otherPepper] of [
    ['MSAIDIZI_DEVICE_PAIRING_PEPPER', config.MSAIDIZI_DEVICE_PAIRING_PEPPER],
    ['MSAIDIZI_DEVICE_LEASE_PEPPER', config.MSAIDIZI_DEVICE_LEASE_PEPPER],
  ] as const) {
    if (
      config.MSAIDIZI_SUPERVISOR_ENROLLMENT_PEPPER &&
      otherPepper &&
      config.MSAIDIZI_SUPERVISOR_ENROLLMENT_PEPPER === otherPepper
    ) {
      throw new Error(`MSAIDIZI_SUPERVISOR_ENROLLMENT_PEPPER and ${otherName} must be distinct.`);
    }
  }
  const crudEvidenceConfiguration: Array<[string, string | undefined]> = [
    ['MSAIDIZI_CRUD_EVIDENCE_PATH', config.MSAIDIZI_CRUD_EVIDENCE_PATH],
    ['MSAIDIZI_CRUD_EVIDENCE_PUBLIC_KEY_PATH', config.MSAIDIZI_CRUD_EVIDENCE_PUBLIC_KEY_PATH],
    ['MSAIDIZI_CRUD_EVIDENCE_KEY_ID', config.MSAIDIZI_CRUD_EVIDENCE_KEY_ID],
    [
      'MSAIDIZI_CRUD_EVIDENCE_APPLICATION_BUILD_DIGEST',
      config.MSAIDIZI_CRUD_EVIDENCE_APPLICATION_BUILD_DIGEST,
    ],
    [
      'MSAIDIZI_CRUD_EVIDENCE_PRISMA_SCHEMA_MIGRATION_DIGEST',
      config.MSAIDIZI_CRUD_EVIDENCE_PRISMA_SCHEMA_MIGRATION_DIGEST,
    ],
  ];
  if (crudEvidenceConfiguration.some(([, value]) => Boolean(value))) {
    const missing = crudEvidenceConfiguration.filter(([, value]) => !value).map(([name]) => name);
    if (missing.length > 0) {
      throw new Error(`Missing CRUD evidence configuration: ${missing.join(', ')}.`);
    }
    for (const [name, value] of crudEvidenceConfiguration.slice(0, 2)) {
      if (!isAbsolute(value!)) throw new Error(`${name} must be an absolute external path.`);
    }
    for (const [name, value] of crudEvidenceConfiguration.slice(3)) {
      if (!/^[a-f0-9]{64}$/.test(value!)) {
        throw new Error(`${name} must be a lowercase SHA-256 digest.`);
      }
    }
  }
  if (
    !Number.isFinite(config.MSAIDIZI_CRUD_EVIDENCE_MAX_AGE_HOURS) ||
    config.MSAIDIZI_CRUD_EVIDENCE_MAX_AGE_HOURS <= 0
  ) {
    throw new Error('MSAIDIZI_CRUD_EVIDENCE_MAX_AGE_HOURS must be a positive number.');
  }
  const productionReleaseConfiguration: Array<[string, string | undefined]> = [
    [
      'MSAIDIZI_PRODUCTION_PROMOTION_INVENTORY_PATH',
      config.MSAIDIZI_PRODUCTION_PROMOTION_INVENTORY_PATH,
    ],
    [
      'MSAIDIZI_PRODUCTION_ACCEPTED_INVENTORY_SHA256',
      config.MSAIDIZI_PRODUCTION_ACCEPTED_INVENTORY_SHA256,
    ],
    [
      'MSAIDIZI_PRODUCTION_ACCEPTED_EVIDENCE_SHA256',
      config.MSAIDIZI_PRODUCTION_ACCEPTED_EVIDENCE_SHA256,
    ],
    ['MSAIDIZI_PRODUCTION_ACCEPTED_IMAGE_DIGEST', config.MSAIDIZI_PRODUCTION_ACCEPTED_IMAGE_DIGEST],
    ['MSAIDIZI_DEPLOYED_BACKEND_IMAGE_REFERENCE', config.MSAIDIZI_DEPLOYED_BACKEND_IMAGE_REFERENCE],
    ['MSAIDIZI_DEPLOYED_SOURCE_COMMIT', config.MSAIDIZI_DEPLOYED_SOURCE_COMMIT],
    ['MSAIDIZI_DEPLOYED_SOURCE_REPOSITORY', config.MSAIDIZI_DEPLOYED_SOURCE_REPOSITORY],
  ];
  const autonomousProductionReleaseRequired =
    config.NODE_ENV === NodeEnv.Production &&
    [
      'MSAIDIZI_AUTONOMY_ENABLED',
      'MSAIDIZI_TASK_WORKER_ENABLED',
      'MSAIDIZI_AUTOPILOT_ENABLED',
      'MSAIDIZI_HOST_EXECUTION_ENABLED',
      'MSAIDIZI_ADAPTIVE_REASONING_ENABLED',
      'MSAIDIZI_UPDATE_AUTOMATIC_ROLLOUT_ENABLED',
      'MSAIDIZI_UPDATE_EVALUATOR_ENABLED',
    ].some((name) => enabled(String(raw[name] ?? 'false')));
  if (
    autonomousProductionReleaseRequired ||
    productionReleaseConfiguration.some(([, value]) => Boolean(value))
  ) {
    const missing = productionReleaseConfiguration
      .filter(([, value]) => !value)
      .map(([name]) => name);
    if (missing.length > 0) {
      throw new Error(`Missing protected production release configuration: ${missing.join(', ')}.`);
    }
    if (!isAbsolute(config.MSAIDIZI_PRODUCTION_PROMOTION_INVENTORY_PATH!)) {
      throw new Error(
        'MSAIDIZI_PRODUCTION_PROMOTION_INVENTORY_PATH must be an absolute external path.',
      );
    }
    for (const [name, value] of productionReleaseConfiguration.slice(1, 3)) {
      if (!/^[a-f0-9]{64}$/.test(value!)) {
        throw new Error(`${name} must be a lowercase SHA-256 digest.`);
      }
    }
    if (!/^sha256:[a-f0-9]{64}$/.test(config.MSAIDIZI_PRODUCTION_ACCEPTED_IMAGE_DIGEST!)) {
      throw new Error(
        'MSAIDIZI_PRODUCTION_ACCEPTED_IMAGE_DIGEST must be a lowercase sha256 digest.',
      );
    }
    if (
      !/^[a-z0-9.-]+(?::[0-9]{1,5})?\/[a-z0-9._/-]+@sha256:[a-f0-9]{64}$/.test(
        config.MSAIDIZI_DEPLOYED_BACKEND_IMAGE_REFERENCE!,
      ) ||
      !config.MSAIDIZI_DEPLOYED_BACKEND_IMAGE_REFERENCE!.endsWith(
        `@${config.MSAIDIZI_PRODUCTION_ACCEPTED_IMAGE_DIGEST}`,
      )
    ) {
      throw new Error(
        'MSAIDIZI_DEPLOYED_BACKEND_IMAGE_REFERENCE must be the accepted immutable repository@sha256 reference.',
      );
    }
    if (!/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(config.MSAIDIZI_DEPLOYED_SOURCE_COMMIT!)) {
      throw new Error('MSAIDIZI_DEPLOYED_SOURCE_COMMIT must be an exact Git object ID.');
    }
    if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(config.MSAIDIZI_DEPLOYED_SOURCE_REPOSITORY!)) {
      throw new Error(
        'MSAIDIZI_DEPLOYED_SOURCE_REPOSITORY must be an exact owner/repository name.',
      );
    }
  }
  if (
    enabled((raw.MSAIDIZI_HOST_EXECUTION_ENABLED as string | undefined) ?? 'false') &&
    !enabled(config.MSAIDIZI_DEVICE_CHANNEL_ENABLED)
  ) {
    throw new Error(
      'MSAIDIZI_HOST_EXECUTION_ENABLED requires MSAIDIZI_DEVICE_CHANNEL_ENABLED=true.',
    );
  }
  if (
    enabled(config.MSAIDIZI_ADAPTIVE_REASONING_ENABLED) &&
    !enabled((raw.MSAIDIZI_AUTONOMY_ENABLED as string | undefined) ?? 'false')
  ) {
    throw new Error('MSAIDIZI_ADAPTIVE_REASONING_ENABLED requires MSAIDIZI_AUTONOMY_ENABLED=true.');
  }
  const providerContractConfiguration: Array<[string, string | undefined]> = [
    [
      'MSAIDIZI_PROVIDER_CONTRACT_ATTESTATION_PATH',
      config.MSAIDIZI_PROVIDER_CONTRACT_ATTESTATION_PATH,
    ],
    [
      'MSAIDIZI_PROVIDER_CONTRACT_PUBLIC_KEY_PATH',
      config.MSAIDIZI_PROVIDER_CONTRACT_PUBLIC_KEY_PATH,
    ],
    ['MSAIDIZI_PROVIDER_CONTRACT_KEY_ID', config.MSAIDIZI_PROVIDER_CONTRACT_KEY_ID],
    [
      'MSAIDIZI_PROVIDER_CONTRACT_ATTESTATION_SHA256',
      config.MSAIDIZI_PROVIDER_CONTRACT_ATTESTATION_SHA256,
    ],
    [
      'MSAIDIZI_PROVIDER_CONTRACT_SIGNER_SPKI_SHA256',
      config.MSAIDIZI_PROVIDER_CONTRACT_SIGNER_SPKI_SHA256,
    ],
    ['MSAIDIZI_PROVIDER_ACCOUNT_ID', config.MSAIDIZI_PROVIDER_ACCOUNT_ID],
    ['MSAIDIZI_PROVIDER_CREDENTIAL_KEY_ID', config.MSAIDIZI_PROVIDER_CREDENTIAL_KEY_ID],
  ];
  const providerContractRequired =
    enabled((raw.MSAIDIZI_ENABLED as string | undefined) ?? 'false') ||
    enabled((raw.MSAIDIZI_AUTONOMY_ENABLED as string | undefined) ?? 'false') ||
    enabled((raw.MSAIDIZI_AUTOPILOT_ENABLED as string | undefined) ?? 'false') ||
    enabled((raw.MSAIDIZI_HOST_EXECUTION_ENABLED as string | undefined) ?? 'false') ||
    enabled(config.MSAIDIZI_ADAPTIVE_REASONING_ENABLED) ||
    enabled(config.MSAIDIZI_UPDATE_EVALUATOR_ENABLED);
  if (
    providerContractRequired ||
    providerContractConfiguration.some(([, value]) => Boolean(value))
  ) {
    const sdkOverrides = FORBIDDEN_ANTHROPIC_SDK_ENVIRONMENT_OVERRIDES.filter(
      (name) => String(raw[name] ?? '').trim().length > 0,
    );
    if (sdkOverrides.length > 0) {
      throw new Error(
        `Msaidizi forbids Anthropic SDK environment overrides: ${sdkOverrides.join(', ')}.`,
      );
    }
    const missing = providerContractConfiguration
      .filter(([, value]) => !value)
      .map(([name]) => name);
    if (missing.length > 0) {
      throw new Error(
        `Msaidizi cloud disclosure requires complete signed zero-training, zero-retention provider-contract evidence; missing: ${missing.join(', ')}.`,
      );
    }
    for (const [name, value] of providerContractConfiguration.slice(0, 2)) {
      if (!isAbsolute(value!)) throw new Error(`${name} must be an absolute external path.`);
    }
    for (const [name, value] of providerContractConfiguration.slice(3, 5)) {
      if (!/^[a-f0-9]{64}$/.test(value!)) {
        throw new Error(`${name} must be a lowercase SHA-256 digest.`);
      }
    }
    if (!/^[A-Za-z0-9._:-]{1,128}$/.test(config.MSAIDIZI_PROVIDER_CONTRACT_KEY_ID!)) {
      throw new Error('MSAIDIZI_PROVIDER_CONTRACT_KEY_ID has an invalid format.');
    }
    if (!/^[A-Za-z0-9._:@/-]{1,256}$/.test(config.MSAIDIZI_PROVIDER_ACCOUNT_ID!)) {
      throw new Error('MSAIDIZI_PROVIDER_ACCOUNT_ID has an invalid format.');
    }
    if (!/^[A-Za-z0-9._:@/-]{1,256}$/.test(config.MSAIDIZI_PROVIDER_CREDENTIAL_KEY_ID!)) {
      throw new Error('MSAIDIZI_PROVIDER_CREDENTIAL_KEY_ID has an invalid format.');
    }
    for (const [name, value] of [
      ['MSAIDIZI_MODEL', config.MSAIDIZI_MODEL],
      ['MSAIDIZI_CLASSIFIER_MODEL', config.MSAIDIZI_CLASSIFIER_MODEL],
    ] as const) {
      if (value.trim() !== value || !/^[A-Za-z0-9][A-Za-z0-9._:@/-]{0,199}$/.test(value)) {
        throw new Error(`${name} must be an exact canonical provider model ID.`);
      }
    }
  }
  if (enabled(config.MSAIDIZI_CLOUD_ZERO_RETENTION_CONFIRMED)) {
    throw new Error(
      'MSAIDIZI_CLOUD_ZERO_RETENTION_CONFIRMED is no longer accepted; configure signed provider-contract evidence.',
    );
  }

  // Production hardening: enforce strong, non-default secrets.
  if (config.NODE_ENV === NodeEnv.Production || config.NODE_ENV === NodeEnv.Staging) {
    const required: Array<[string, string | undefined]> = [
      ['TWO_FACTOR_ENCRYPTION_KEY', config.TWO_FACTOR_ENCRYPTION_KEY],
      ['APP_ENCRYPTION_KEY', config.APP_ENCRYPTION_KEY],
      ['REFRESH_TOKEN_PEPPER', config.REFRESH_TOKEN_PEPPER],
      ['FRONTEND_URL', config.FRONTEND_URL],
      ['APP_URL', config.APP_URL],
      ['REDIS_PASSWORD', config.REDIS_PASSWORD],
    ];
    const missing = required.filter(([, v]) => !v).map(([k]) => k);
    if (missing.length > 0) {
      throw new Error(
        `Missing required ${config.NODE_ENV} environment variables: ${missing.join(', ')}`,
      );
    }

    const secretsToCheck: Array<[string, string]> = [
      ['JWT_ACCESS_SECRET', config.JWT_ACCESS_SECRET],
      ['JWT_REFRESH_SECRET', config.JWT_REFRESH_SECRET],
      ['TWO_FACTOR_ENCRYPTION_KEY', config.TWO_FACTOR_ENCRYPTION_KEY!],
      ['APP_ENCRYPTION_KEY', config.APP_ENCRYPTION_KEY!],
      ['REFRESH_TOKEN_PEPPER', config.REFRESH_TOKEN_PEPPER!],
    ];
    for (const [name, value] of secretsToCheck) {
      if (FORBIDDEN_PROD_SECRETS.has(value.toLowerCase().trim())) {
        throw new Error(
          `${name} is set to a known default/placeholder value. Generate a new secret before deploying to ${config.NODE_ENV}.`,
        );
      }
    }

    // Refuse to share key material across security domains. JWT signing and
    // field-level encryption MUST use distinct keys so rotating one does not
    // implicitly break the other.
    const distinctPairs: Array<[string, string, string, string]> = [
      [
        'APP_ENCRYPTION_KEY',
        config.APP_ENCRYPTION_KEY!,
        'JWT_ACCESS_SECRET',
        config.JWT_ACCESS_SECRET,
      ],
      [
        'APP_ENCRYPTION_KEY',
        config.APP_ENCRYPTION_KEY!,
        'JWT_REFRESH_SECRET',
        config.JWT_REFRESH_SECRET,
      ],
      [
        'TWO_FACTOR_ENCRYPTION_KEY',
        config.TWO_FACTOR_ENCRYPTION_KEY!,
        'JWT_ACCESS_SECRET',
        config.JWT_ACCESS_SECRET,
      ],
      [
        'TWO_FACTOR_ENCRYPTION_KEY',
        config.TWO_FACTOR_ENCRYPTION_KEY!,
        'APP_ENCRYPTION_KEY',
        config.APP_ENCRYPTION_KEY!,
      ],
    ];
    for (const [aName, aVal, bName, bVal] of distinctPairs) {
      if (aVal && bVal && aVal === bVal) {
        throw new Error(
          `${aName} and ${bName} must be distinct. Sharing key material across security domains breaks rotation safety.`,
        );
      }
    }

    const urlChecks: Array<[string, string | undefined]> = [
      ['CORS_ORIGIN', config.CORS_ORIGIN],
      ['FRONTEND_URL', config.FRONTEND_URL],
      ['APP_URL', config.APP_URL],
    ];
    for (const [name, value] of urlChecks) {
      if (!value || value.includes('localhost') || value.includes('127.0.0.1')) {
        throw new Error(`${name} must be set to a public HTTPS URL in ${config.NODE_ENV}.`);
      }
      if (value.split(',').some((url) => !url.trim() || url.includes('*'))) {
        throw new Error(`${name} cannot contain empty or wildcard origins in ${config.NODE_ENV}.`);
      }
      if (!value.split(',').every((url) => url.trim().startsWith('https://'))) {
        throw new Error(`${name} must use HTTPS in ${config.NODE_ENV}.`);
      }
    }

    const smtpValues = [config.SMTP_HOST, config.SMTP_USER, config.SMTP_PASS, config.SMTP_FROM];
    if (smtpValues.some(Boolean) && smtpValues.some((value) => !value)) {
      throw new Error(
        `SMTP_HOST, SMTP_USER, SMTP_PASS, and SMTP_FROM must be configured together in ${config.NODE_ENV}.`,
      );
    }

    const hasStorageRoot = Boolean(
      config.STORAGE_LOCAL_PATH || config.LOCAL_STORAGE_PATH || config.STORAGE_PATH,
    );
    if (!hasStorageRoot) {
      throw new Error(
        `STORAGE_LOCAL_PATH, LOCAL_STORAGE_PATH, or STORAGE_PATH is required in ${config.NODE_ENV}.`,
      );
    }
    if (!config.BACKUPS_DIR && !config.BACKUP_STORAGE_PATH) {
      throw new Error(`BACKUPS_DIR or BACKUP_STORAGE_PATH is required in ${config.NODE_ENV}.`);
    }
    if (!config.EXPORTS_DIR) {
      throw new Error(`EXPORTS_DIR is required in ${config.NODE_ENV}.`);
    }
  }

  return config;
}
