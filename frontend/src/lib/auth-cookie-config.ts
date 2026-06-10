// Align cookie Max-Age with credential lifetime. The refresh token (the
// longest-lived credential) is ~30 days, and the proxy re-issues all auth
// cookies on every refresh, so a 30-day Max-Age bounds the reuse window of a
// captured cookie without logging active users out. AUTH_COOKIE_MAX_AGE_SECONDS
// remains an opt-in override for deployments that need a different lifetime.
const DEFAULT_SESSION_COOKIE_MAX_AGE_SECONDS = 60 * 60 * 24 * 30;

const configuredMaxAge = Number(process.env.AUTH_COOKIE_MAX_AGE_SECONDS);

export const SESSION_COOKIE_MAX_AGE_SECONDS =
  Number.isFinite(configuredMaxAge) && configuredMaxAge > 0
    ? configuredMaxAge
    : DEFAULT_SESSION_COOKIE_MAX_AGE_SECONDS;
