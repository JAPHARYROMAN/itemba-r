import { plainToInstance } from 'class-transformer';
import { IsEnum, IsNumber, IsOptional, IsString, MinLength, validateSync } from 'class-validator';

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
  JWT_ACCESS_EXPIRES_IN: string = '15m';

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
