#!/usr/bin/env node

import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const options = parseArgs(process.argv.slice(2), process.env);
const envValues = options.envFile ? loadEnv(resolve(rootDir, options.envFile)) : {};
const config = { ...envValues, ...process.env };

const apiUrl = normalizeBaseUrl(
  options.apiUrl ??
    config.REGISTRY_SMOKE_API_URL ??
    config.NEXT_PUBLIC_API_URL ??
    'http://127.0.0.1:3001/api/v1',
);
const email =
  options.email ?? config.REGISTRY_SMOKE_EMAIL ?? config.SEED_ADMIN_EMAIL ?? config.AUTH_SMOKE_EMAIL;
const password =
  options.password ??
  config.REGISTRY_SMOKE_PASSWORD ??
  config.SEED_ADMIN_PASSWORD ??
  config.AUTH_SMOKE_PASSWORD;
const configuredCompanyId = options.companyId ?? config.REGISTRY_SMOKE_COMPANY_ID;

const state = {
  accessToken: null,
  divisionId: null,
  branchIds: new Set(),
};

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});

async function main() {
  if (!email || !password) {
    throw new Error(
      'Missing registry smoke credentials. Set REGISTRY_SMOKE_EMAIL/REGISTRY_SMOKE_PASSWORD or SEED_ADMIN_EMAIL/SEED_ADMIN_PASSWORD.',
    );
  }

  try {
    console.log(`Starting registry CRUD smoke against ${apiUrl}`);
    state.accessToken = await login(email, password);

    const company = configuredCompanyId
      ? await getCompany(configuredCompanyId)
      : await selectWritableCompany();

    const suffix = Date.now().toString();
    const short = suffix.slice(-8);

    const division = await createDivision(company.id, short);
    state.divisionId = division.id;
    await assertCompanyHasDivision(company.id, division.id, true);
    console.log(`registry smoke OK: created division ${division.code}`);

    const branch = await createBranch(division.id, short, 'A');
    state.branchIds.add(branch.id);
    await assertBranch(branch.id, { isActive: true, name: branch.name });
    await assertCompanyHasBranch(company.id, division.id, branch.id, true);
    console.log(`registry smoke OK: created branch/station ${branch.code}`);

    const updatedDivisionName = `Registry Smoke Division Updated ${short}`;
    const updatedDivision = await patch(`/divisions/${division.id}`, {
      name: updatedDivisionName,
      description: `Updated by registry CRUD smoke ${suffix}`,
    });
    assertEqual(updatedDivision.name, updatedDivisionName, 'division edit persisted');

    const updatedBranchName = `Registry Smoke Station Updated ${short}`;
    const updatedBranch = await patch(`/branches/${branch.id}`, {
      name: updatedBranchName,
      location: 'Registry Smoke Location Updated',
      address: 'Registry Smoke Address Updated',
      phone: '+255 000 000 001',
    });
    assertEqual(updatedBranch.name, updatedBranchName, 'branch edit persisted');
    assertEqual(updatedBranch.location, 'Registry Smoke Location Updated', 'branch location edit persisted');
    console.log('registry smoke OK: edited division and branch');

    await patch(`/branches/${branch.id}`, { isActive: false });
    await assertBranch(branch.id, { isActive: false });
    await patch(`/branches/${branch.id}`, { isActive: true });
    await assertBranch(branch.id, { isActive: true });
    console.log('registry smoke OK: branch deactivate/reactivate');

    await patch(`/divisions/${division.id}`, { isActive: false });
    await assertDivision(division.id, { isActive: false });
    await assertBranch(branch.id, { isActive: false });
    await expectStatus('branch activation under inactive division', 'PATCH', `/branches/${branch.id}`, 400, {
      isActive: true,
    });
    await patch(`/divisions/${division.id}`, { isActive: true });
    await assertDivision(division.id, { isActive: true });
    await patch(`/branches/${branch.id}`, { isActive: true });
    await assertBranch(branch.id, { isActive: true });
    console.log('registry smoke OK: division deactivate/reactivate rules');

    await del(`/branches/${branch.id}`);
    state.branchIds.delete(branch.id);
    await expectStatus('archived branch lookup', 'GET', `/branches/${branch.id}`, 404);
    await assertCompanyHasBranch(company.id, division.id, branch.id, false);
    console.log('registry smoke OK: branch archive removes it from active registry');

    const branchForDivisionArchive = await createBranch(division.id, short, 'B');
    state.branchIds.add(branchForDivisionArchive.id);
    await del(`/divisions/${division.id}`);
    state.divisionId = null;
    state.branchIds.delete(branchForDivisionArchive.id);
    await expectStatus('archived division lookup', 'GET', `/divisions/${division.id}`, 404);
    await expectStatus(
      'branch archived with parent division lookup',
      'GET',
      `/branches/${branchForDivisionArchive.id}`,
      404,
    );
    await assertCompanyHasDivision(company.id, division.id, false);
    console.log('registry smoke OK: division archive cascades to branches');

    console.log(`smoke-registry-crud: OK company=${company.code ?? company.id}`);
  } catch (error) {
    await cleanup();
    throw error;
  }
}

async function login(loginEmail, loginPassword) {
  const response = await fetchJson('/auth/login', {
    method: 'POST',
    body: { email: loginEmail, password: loginPassword },
    auth: false,
  });
  const data = response.data ?? response;
  const token = data.accessToken ?? data.token;
  if (!token) throw new Error('Login did not return an access token');
  return token;
}

async function selectWritableCompany() {
  const body = await get('/companies?limit=50');
  const companies = asCollection(body);
  if (companies.length === 0) {
    throw new Error('No accessible company found for registry CRUD smoke');
  }
  return companies.find((company) => company.status === 'ACTIVE') ?? companies[0];
}

async function getCompany(companyId) {
  return get(`/companies/${companyId}`);
}

async function createDivision(companyId, short) {
  return post('/divisions', {
    companyId,
    name: `Registry Smoke Division ${short}`,
    code: `RSD${short}`,
    type: 'PETROLEUM',
    description: `Created by registry CRUD smoke ${short}`,
  });
}

async function createBranch(divisionId, short, marker) {
  return post('/branches', {
    divisionId,
    name: `Registry Smoke Station ${short} ${marker}`,
    code: `RSB${marker}${short}`,
    type: 'FUEL_STATION',
    location: 'Registry Smoke Location',
    address: 'Registry Smoke Address',
    phone: '+255 000 000 000',
  });
}

async function assertDivision(divisionId, expected) {
  const division = await get(`/divisions/${divisionId}`);
  for (const [key, value] of Object.entries(expected)) {
    assertEqual(division[key], value, `division ${key}`);
  }
  return division;
}

async function assertBranch(branchId, expected) {
  const branch = await get(`/branches/${branchId}`);
  for (const [key, value] of Object.entries(expected)) {
    assertEqual(branch[key], value, `branch ${key}`);
  }
  return branch;
}

async function assertCompanyHasDivision(companyId, divisionId, expectedPresent) {
  const company = await getCompany(companyId);
  const present = Boolean(company.divisions?.some((division) => division.id === divisionId));
  assertEqual(present, expectedPresent, `company division presence ${divisionId}`);
}

async function assertCompanyHasBranch(companyId, divisionId, branchId, expectedPresent) {
  const company = await getCompany(companyId);
  const division = company.divisions?.find((item) => item.id === divisionId);
  const present = Boolean(division?.branches?.some((branch) => branch.id === branchId));
  assertEqual(present, expectedPresent, `company branch presence ${branchId}`);
}

async function cleanup() {
  if (!state.accessToken) return;
  for (const branchId of state.branchIds) {
    await request('DELETE', `/branches/${branchId}`, undefined, { allowStatuses: [200, 204, 404] }).catch(
      () => undefined,
    );
  }
  if (state.divisionId) {
    await request('DELETE', `/divisions/${state.divisionId}`, undefined, {
      allowStatuses: [200, 204, 404],
    }).catch(() => undefined);
  }
}

async function get(path) {
  return request('GET', path);
}

async function post(path, body) {
  return request('POST', path, body);
}

async function patch(path, body) {
  return request('PATCH', path, body);
}

async function del(path) {
  return request('DELETE', path);
}

async function expectStatus(label, method, path, status, body) {
  const response = await rawRequest(method, path, body);
  await response.text().catch(() => '');
  if (response.status !== status) {
    throw new Error(`${label} expected HTTP ${status}, received HTTP ${response.status}`);
  }
}

async function request(method, path, body, options = {}) {
  const response = await rawRequest(method, path, body);
  const text = await response.text();
  const allowed = options.allowStatuses ?? [200, 201];
  if (!allowed.includes(response.status)) {
    throw new Error(`${method} ${path} failed with HTTP ${response.status}: ${text.slice(0, 500)}`);
  }
  if (!text) return null;
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error(`${method} ${path} returned non-JSON response: ${text.slice(0, 200)}`);
  }
  return unwrap(parsed);
}

async function fetchJson(path, { method, body, auth = true }) {
  return request(method, path, body, { auth });
}

async function rawRequest(method, path, body) {
  const headers = { Accept: 'application/json' };
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (state.accessToken) headers.Authorization = `Bearer ${state.accessToken}`;

  return fetchWithTimeout(`${apiUrl}${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

async function fetchWithTimeout(url, options = {}, timeoutMs = 30_000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

function unwrap(body) {
  return body?.data ?? body;
}

function asCollection(body) {
  const unwrapped = unwrap(body);
  if (Array.isArray(unwrapped)) return unwrapped;
  if (Array.isArray(unwrapped?.data)) return unwrapped.data;
  throw new Error(`Expected collection response, received ${JSON.stringify(unwrapped).slice(0, 200)}`);
}

function assertEqual(actual, expected, label) {
  if (actual !== expected) {
    throw new Error(`${label} mismatch: expected ${JSON.stringify(expected)}, received ${JSON.stringify(actual)}`);
  }
}

function parseArgs(argv, env) {
  const parsed = {
    envFile: configValue(env.npm_config_env_file),
    apiUrl: configValue(env.npm_config_api_url),
    email: configValue(env.npm_config_email),
    password: configValue(env.npm_config_password),
    companyId: configValue(env.npm_config_company_id),
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--env-file') {
      parsed.envFile = argv[++index];
      continue;
    }
    if (arg.startsWith('--env-file=')) {
      parsed.envFile = arg.slice('--env-file='.length);
      continue;
    }
    if (arg === '--api-url') {
      parsed.apiUrl = argv[++index];
      continue;
    }
    if (arg.startsWith('--api-url=')) {
      parsed.apiUrl = arg.slice('--api-url='.length);
      continue;
    }
    if (arg === '--company-id') {
      parsed.companyId = argv[++index];
      continue;
    }
    if (arg.startsWith('--company-id=')) {
      parsed.companyId = arg.slice('--company-id='.length);
      continue;
    }
    if (!arg.startsWith('--') && !parsed.envFile) {
      parsed.envFile = arg;
      continue;
    }
    if (!arg.startsWith('--') && !parsed.apiUrl && /^https?:\/\//i.test(arg)) {
      parsed.apiUrl = arg;
      continue;
    }
    throw new Error(`Unknown argument: ${arg}`);
  }

  if (!parsed.envFile && existsSync(resolve(rootDir, '.env.staging'))) {
    parsed.envFile = '.env.staging';
  }

  return parsed;
}

function configValue(value) {
  const normalized = String(value ?? '').trim();
  if (!normalized || ['true', 'false'].includes(normalized.toLowerCase())) return null;
  return normalized;
}

function loadEnv(file) {
  if (!existsSync(file)) throw new Error(`Env file not found: ${file}`);
  const values = {};
  for (const line of readFileSync(file, 'utf8').split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const separator = trimmed.indexOf('=');
    if (separator === -1) continue;
    const key = trimmed.slice(0, separator).trim();
    values[key] = trimmed
      .slice(separator + 1)
      .trim()
      .replace(/^["']|["']$/g, '');
  }
  return values;
}

function normalizeBaseUrl(value) {
  return String(value).replace(/\/+$/, '');
}
