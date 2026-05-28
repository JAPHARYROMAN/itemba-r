const DEFAULT_SESSION_COOKIE_MAX_AGE_SECONDS = 60 * 60 * 24 * 365 * 10;

const configuredMaxAge = Number(process.env.AUTH_COOKIE_MAX_AGE_SECONDS);

export const SESSION_COOKIE_MAX_AGE_SECONDS =
  Number.isFinite(configuredMaxAge) && configuredMaxAge > 0
    ? configuredMaxAge
    : DEFAULT_SESSION_COOKIE_MAX_AGE_SECONDS;
