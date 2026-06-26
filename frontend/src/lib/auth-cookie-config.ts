// The owner wants the session to persist until they explicitly log out and to
// survive page refreshes/long idle, so the auth cookies get an effectively
// permanent (~10 year) Max-Age. The proxy and /api/auth/refresh re-issue all
// cookies on every refresh, making this a sliding window; the session still
// ends only on logout (which revokes the ActiveSession + refresh token) or when
// the backend refresh token expires (set JWT_REFRESH_EXPIRES_IN=never for a
// truly permanent session). AUTH_COOKIE_MAX_AGE_SECONDS overrides this.
const DEFAULT_SESSION_COOKIE_MAX_AGE_SECONDS = 60 * 60 * 24 * 365 * 10;

const configuredMaxAge = Number(process.env.AUTH_COOKIE_MAX_AGE_SECONDS);

export const SESSION_COOKIE_MAX_AGE_SECONDS =
  Number.isFinite(configuredMaxAge) && configuredMaxAge > 0
    ? configuredMaxAge
    : DEFAULT_SESSION_COOKIE_MAX_AGE_SECONDS;
