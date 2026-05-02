import 'reflect-metadata';
import { envValidate } from './env.validation';

const STRONG_SECRET = 'a'.repeat(40);
const ANOTHER_STRONG_SECRET = 'b'.repeat(40);
const STRONG_2FA = 'c'.repeat(40);
const STRONG_APP_ENC = 'd'.repeat(40);
const STRONG_PEPPER = 'e'.repeat(40);

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
  };

  it('accepts a minimal valid development config', () => {
    expect(() => envValidate({ ...baseValid, NODE_ENV: 'development' })).not.toThrow();
  });

  it('rejects missing DATABASE_URL', () => {
    const { DATABASE_URL, ...rest } = baseValid;
    expect(() => envValidate({ ...rest })).toThrow(/DATABASE_URL/);
  });

  it('rejects JWT secrets shorter than 32 chars', () => {
    expect(() =>
      envValidate({ ...baseValid, JWT_ACCESS_SECRET: 'short' }),
    ).toThrow(/JWT_ACCESS_SECRET/);
  });

  it('requires TWO_FACTOR_ENCRYPTION_KEY in production', () => {
    expect(() =>
      envValidate({ ...baseValid, NODE_ENV: 'production' }),
    ).toThrow(/TWO_FACTOR_ENCRYPTION_KEY/);
  });

  it('requires APP_ENCRYPTION_KEY in production', () => {
    const { APP_ENCRYPTION_KEY: _, ...partial } = validProductionExtras;
    expect(() =>
      envValidate({ ...baseValid, NODE_ENV: 'production', ...partial }),
    ).toThrow(/APP_ENCRYPTION_KEY/);
  });

  it('requires REFRESH_TOKEN_PEPPER in production', () => {
    const { REFRESH_TOKEN_PEPPER: _, ...partial } = validProductionExtras;
    expect(() =>
      envValidate({ ...baseValid, NODE_ENV: 'production', ...partial }),
    ).toThrow(/REFRESH_TOKEN_PEPPER/);
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
