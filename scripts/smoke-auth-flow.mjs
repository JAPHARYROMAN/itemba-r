#!/usr/bin/env node

const args = new Set(process.argv.slice(2));
const allowSignupWrite = args.has('--allow-signup-write') || envBoolean('AUTH_SMOKE_ALLOW_SIGNUP_WRITE');
const baseUrl = normalizeBaseUrl(
  process.env.AUTH_SMOKE_FRONTEND_URL ?? process.env.FRONTEND_URL ?? 'http://127.0.0.1:3000',
);
const email = process.env.AUTH_SMOKE_EMAIL ?? process.env.SEED_ADMIN_EMAIL;
const password = process.env.AUTH_SMOKE_PASSWORD ?? process.env.SEED_ADMIN_PASSWORD;

const ERROR_SIGNATURES = [
  'id="__next_error__"',
  'NEXT_HTTP_ERROR_FALLBACK;500',
  'Application error',
  'Internal Server Error',
];

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});

async function main() {
  if (!email || !password) {
    throw new Error(
      'Missing auth smoke credentials. Set AUTH_SMOKE_EMAIL/AUTH_SMOKE_PASSWORD or SEED_ADMIN_EMAIL/SEED_ADMIN_PASSWORD.',
    );
  }

  const results = [];
  const push = (name, details = '') => {
    results.push({ name, details });
    console.log(`auth smoke OK: ${name}${details ? ` (${details})` : ''}`);
  };

  const loginPage = await fetchText('/login');
  assertPageOk('login page', loginPage, ['auth-light', '/brand/itemba-group-logo.png']);
  push('login page renders');

  const signupPage = await fetchText('/signup');
  assertPageOk('signup page', signupPage, ['auth-light', '/brand/itemba-group-logo.png']);
  push('signup page renders');

  const logo = await fetchWithTimeout(`${baseUrl}/brand/itemba-group-logo.png?smoke=${Date.now()}`);
  if (!logo.ok || !contentType(logo).startsWith('image/png')) {
    throw new Error(`logo asset failed: HTTP ${logo.status}, content-type=${contentType(logo)}`);
  }
  const logoBytes = await logo.arrayBuffer();
  if (logoBytes.byteLength < 10_000) {
    throw new Error(`logo asset looks too small: ${logoBytes.byteLength} bytes`);
  }
  push('logo asset serves as PNG', `${logoBytes.byteLength} bytes`);

  const unauthDashboard = await fetchWithTimeout(`${baseUrl}/dashboard`, { redirect: 'manual' });
  const unauthLocation = unauthDashboard.headers.get('location') ?? '';
  if (![302, 303, 307, 308].includes(unauthDashboard.status) || !unauthLocation.includes('/login')) {
    throw new Error(
      `unauthenticated dashboard expected login redirect, received HTTP ${unauthDashboard.status} location=${unauthLocation}`,
    );
  }
  push('unauthenticated dashboard redirects to login', `HTTP ${unauthDashboard.status}`);

  const badLogin = await postJson('/api/auth/login', {
    email,
    password: `wrong-${Date.now()}`,
  });
  if (badLogin.response.ok) {
    throw new Error('wrong-password login unexpectedly succeeded');
  }
  if (cookiesFrom(badLogin.response).some((cookie) => cookie.startsWith('itemba_auth='))) {
    throw new Error('wrong-password login set auth cookies');
  }
  push('wrong login is rejected', `HTTP ${badLogin.response.status}`);

  if (allowSignupWrite) {
    const signupEmail = `auth-smoke-${Date.now()}@itemba.local`;
    const signup = await postJson('/api/auth/register', {
      fullName: 'Auth Smoke User',
      email: signupEmail,
      password: `AuthSmoke${Date.now()}!`,
    });
    if (signup.response.ok) {
      const signupCookies = cookiesFrom(signup.response);
      assertCookieSet(signupCookies, 'itemba_auth');
      push('signup API accepts registration', `HTTP ${signup.response.status}`);
    } else {
      const message = String(signup.body?.message ?? '');
      const expectedDisabled =
        signup.response.status === 400 || signup.response.status === 403 || signup.response.status === 409;
      if (!expectedDisabled || !message) {
        throw new Error(
          `signup API returned unexpected failure: HTTP ${signup.response.status} ${JSON.stringify(signup.body)}`,
        );
      }
      push('signup API returns controlled failure', `HTTP ${signup.response.status}`);
    }
  } else {
    const signupValidation = await postJson('/api/auth/register', {
      fullName: '',
      email: 'not-an-email',
      password: 'short',
    });
    if (signupValidation.response.ok) {
      throw new Error('invalid signup payload unexpectedly succeeded');
    }
    push('signup API rejects invalid payload', `HTTP ${signupValidation.response.status}`);
  }

  const login = await postJson('/api/auth/login', { email, password });
  if (!login.response.ok) {
    throw new Error(`valid login failed: HTTP ${login.response.status} ${JSON.stringify(login.body)}`);
  }
  const authCookies = cookiesFrom(login.response);
  for (const name of ['itemba_access', 'itemba_backend_refresh', 'itemba_auth', 'itemba_csrf']) {
    assertCookieSet(authCookies, name);
  }
  const cookieHeader = cookieHeaderFrom(authCookies);
  push('valid login sets auth cookies');

  const me = await fetchJson('/api/auth/me', { headers: { cookie: cookieHeader } });
  if (!me.response.ok) {
    throw new Error(`api/auth/me failed after login: HTTP ${me.response.status}`);
  }
  const userEmail = me.body?.data?.email ?? me.body?.email ?? me.body?.user?.email;
  if (userEmail && String(userEmail).toLowerCase() !== email.toLowerCase()) {
    throw new Error(`api/auth/me returned unexpected user email`);
  }
  push('api/auth/me returns authenticated user');

  const dashboard = await fetchText('/dashboard', { headers: { cookie: cookieHeader } });
  assertPageOk('authenticated dashboard', dashboard);
  push('authenticated dashboard renders');

  const logout = await postJson('/api/auth/logout', {}, { headers: { cookie: cookieHeader } });
  if (!logout.response.ok) {
    throw new Error(`logout failed: HTTP ${logout.response.status}`);
  }
  const clearedCookies = cookiesFrom(logout.response);
  for (const name of ['itemba_access', 'itemba_auth', 'itemba_csrf']) {
    assertCookieCleared(clearedCookies, name);
  }
  push('logout clears session cookies');

  console.log(`smoke-auth-flow: OK ${baseUrl} (${results.length} checks)`);
}

async function fetchText(path, options = {}) {
  const response = await fetchWithTimeout(resolveUrl(path), options, 30_000);
  const text = await response.text();
  return { response, text };
}

async function fetchJson(path, options = {}) {
  const response = await fetchWithTimeout(resolveUrl(path), options, 30_000);
  const text = await response.text();
  let body = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    throw new Error(`${path} returned non-JSON response: ${text.slice(0, 200)}`);
  }
  return { response, body };
}

async function postJson(path, body, options = {}) {
  return fetchJson(path, {
    ...options,
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(options.headers ?? {}),
    },
    body: JSON.stringify(body),
  });
}

function assertPageOk(label, result, expectedSubstrings = []) {
  const { response, text } = result;
  const errorSignature = ERROR_SIGNATURES.find((signature) => text.includes(signature));
  if (!response.ok || errorSignature || text.trim().length === 0) {
    throw new Error(
      `${label} failed: HTTP ${response.status}, errorSignature=${errorSignature ?? 'none'}`,
    );
  }
  for (const expected of expectedSubstrings) {
    if (!text.includes(expected)) {
      throw new Error(`${label} did not include ${JSON.stringify(expected)}`);
    }
  }
}

function assertCookieSet(cookies, name) {
  if (!cookies.some((cookie) => cookie.startsWith(`${name}=`) && !cookie.startsWith(`${name}=;`))) {
    throw new Error(`expected ${name} cookie to be set`);
  }
}

function assertCookieCleared(cookies, name) {
  const isCleared = cookies.some(
    (cookie) =>
      cookie.startsWith(`${name}=`) &&
      (/max-age=0/i.test(cookie) || /expires=Thu,\s*01 Jan 1970/i.test(cookie)),
  );
  if (!isCleared) {
    throw new Error(`expected ${name} cookie to be cleared`);
  }
}

function cookiesFrom(response) {
  return response.headers.getSetCookie?.() ?? splitSetCookie(response.headers.get('set-cookie'));
}

function splitSetCookie(header) {
  if (!header) return [];
  return header.split(/,(?=\s*[^;,=\s]+=[^;,]+)/g).map((cookie) => cookie.trim());
}

function cookieHeaderFrom(setCookies) {
  return setCookies
    .map((entry) => entry.split(';')[0])
    .filter(Boolean)
    .join('; ');
}

async function fetchWithTimeout(url, options = {}, timeoutMs = 15_000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

function normalizeBaseUrl(value) {
  return value.replace(/\/+$/, '');
}

function resolveUrl(path) {
  return path.startsWith('http') ? path : `${baseUrl}${path}`;
}

function contentType(response) {
  return response.headers.get('content-type') ?? '';
}

function envBoolean(name) {
  const value = process.env[name];
  return value === '1' || value === 'true' || value === 'yes';
}
