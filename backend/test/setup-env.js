// Set env vars before any NestJS modules are imported
process.env.NODE_ENV = process.env.NODE_ENV || 'test';
process.env.APP_ENCRYPTION_KEY =
  process.env.APP_ENCRYPTION_KEY || 'local-dev-itemba-r-encryption-key-32chars-minimum';
process.env.JWT_ACCESS_SECRET =
  process.env.JWT_ACCESS_SECRET || 'local-dev-jwt-access-secret-32chars-min';
process.env.JWT_REFRESH_SECRET =
  process.env.JWT_REFRESH_SECRET || 'local-dev-jwt-refresh-secret-32chars';
process.env.TWO_FACTOR_ENCRYPTION_KEY =
  process.env.TWO_FACTOR_ENCRYPTION_KEY || 'local-dev-two-factor-key-32chars-min';
process.env.REFRESH_TOKEN_PEPPER =
  process.env.REFRESH_TOKEN_PEPPER || 'local-dev-refresh-token-pepper-32chars';
process.env.THROTTLE_LIMIT = process.env.THROTTLE_LIMIT || '100000';
process.env.THROTTLE_TTL = process.env.THROTTLE_TTL || '1';
