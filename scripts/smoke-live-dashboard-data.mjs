#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const options = parseArgs(process.argv.slice(2), process.env);
const envFile = options.envFile ?? '.env.staging';
const envFilePath = resolve(rootDir, envFile);
const env = existsSync(envFilePath) ? { ...loadEnv(envFilePath), ...process.env } : process.env;

const apiUrl = normalizeUrl(
  options.apiUrl ?? env.LIVE_SMOKE_API_URL ?? env.NEXT_PUBLIC_API_URL ?? 'http://127.0.0.1:3001/api/v1',
);
const backendContainer = options.backendContainer ?? env.LIVE_SMOKE_BACKEND_CONTAINER ?? 'itemba_r_backend_staging';

let fixture;

main()
  .catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  })
  .finally(async () => {
    if (fixture && !options.keepFixture) {
      cleanupFixture(fixture);
    }
  });

async function main() {
  fixture = createFixture();

  const companyToken = await login(fixture.companyUser.email, fixture.password);
  const groupToken = await login(fixture.groupUser.email, fixture.password);
  const noPermissionToken = await login(fixture.noPermissionUser.email, fixture.password);

  await assertStatus(
    'dashboard requires group-control.view permission',
    noPermissionToken,
    '/dashboard/executive-summary',
    403,
  );
  await assertStatus(
    'company user cannot request another company',
    companyToken,
    `/dashboard/executive-summary?companyId=${fixture.companyB.id}`,
    403,
  );

  const companySummary = await getDashboardSummary(companyToken);
  assertCompanyScopedSummary(companySummary, fixture.companyA, 'company user / company A');

  const groupCompanyBSummary = await getDashboardSummary(groupToken, fixture.companyB.id);
  assertCompanyScopedSummary(groupCompanyBSummary, fixture.companyB, 'group user / company B filter');

  console.log(`smoke-live-dashboard-data: OK ${apiUrl}`);
}

function createFixture() {
  const suffix = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
  const script = `
const { PrismaClient } = require('@prisma/client');
const argon2 = require('argon2');
const prisma = new PrismaClient();
const suffix = ${JSON.stringify(suffix)};
const password = 'DashboardSmoke123!';
const now = new Date();
const in10 = new Date(now.getTime() + 10 * 24 * 3600 * 1000);

async function createUser(emailPrefix, fullName, roleId, companyId) {
  const email = emailPrefix + '-' + suffix + '@itemba.local';
  const passwordHash = await argon2.hash(password);
  const user = await prisma.user.create({
    data: {
      email,
      passwordHash,
      fullName,
      status: 'ACTIVE',
      companyId,
      userRoles: { create: { roleId } },
      ...(companyId
        ? { companyAccess: { create: { companyId, accessLevel: 'MANAGE' } } }
        : {}),
    },
  });
  return { id: user.id, email };
}

async function seedCompany(company, marker, amounts) {
  const division = await prisma.division.create({
    data: {
      companyId: company.id,
      name: 'Live Dashboard Smoke Division ' + marker + ' ' + suffix,
      code: 'LDSD' + marker + suffix.slice(-6),
      type: 'OTHER',
    },
  });
  const branch = await prisma.branch.create({
    data: {
      divisionId: division.id,
      name: 'Live Dashboard Smoke Branch ' + marker + ' ' + suffix,
      code: 'LDSB' + marker + suffix.slice(-6),
      type: 'BRANCH',
    },
  });
  await prisma.bankAccount.create({
    data: {
      companyId: company.id,
      bankName: 'Live Dashboard Smoke Bank ' + marker,
      accountName: 'Live Dashboard Smoke Account ' + marker,
      accountNumber: 'LDASH' + marker + suffix,
      accountType: 'CURRENT',
      currency: 'TZS',
      isActive: true,
    },
  });
  await prisma.loan.create({
    data: {
      companyId: company.id,
      obligationType: 'BANK_LOAN',
      borrowerLevel: 'COMPANY',
      lenderName: 'Live Dashboard Smoke Lender ' + marker + ' ' + suffix,
      principalAmount: String(amounts.loan),
      interestRate: '0.1200',
      disbursementDate: now,
      maturityDate: in10,
      repaymentFrequency: 'MONTHLY',
      outstandingBalance: String(amounts.loan),
      status: 'ACTIVE',
      riskLevel: 'HIGH',
    },
  });
  await prisma.debt.create({
    data: {
      companyId: company.id,
      creditorName: 'Live Dashboard Smoke Creditor ' + marker + ' ' + suffix,
      amount: String(amounts.debt),
      description: 'Live dashboard smoke debt ' + marker + ' ' + suffix,
      status: 'OUTSTANDING',
      riskLevel: 'MEDIUM',
    },
  });
  await prisma.contract.create({
    data: {
      companyId: company.id,
      owningLevel: 'COMPANY',
      title: 'Live Dashboard Smoke Active Contract ' + marker + ' ' + suffix,
      contractType: 'SERVICE',
      counterpartyName: 'Live Dashboard Smoke Counterparty ' + marker,
      startDate: now,
      endDate: in10,
      status: 'ACTIVE',
      riskLevel: 'LOW',
    },
  });
  await prisma.contract.create({
    data: {
      companyId: company.id,
      owningLevel: 'COMPANY',
      title: 'Live Dashboard Smoke Pending Contract ' + marker + ' ' + suffix,
      contractType: 'SERVICE',
      counterpartyName: 'Live Dashboard Smoke Approval ' + marker,
      startDate: now,
      endDate: in10,
      status: 'PENDING_APPROVAL',
      riskLevel: 'LOW',
    },
  });
  await prisma.fixedAsset.create({
    data: {
      companyId: company.id,
      ownershipLevel: 'COMPANY',
      divisionId: division.id,
      branchId: branch.id,
      assetCode: 'LDSA-' + marker + '-' + suffix.slice(-8),
      name: 'Live Dashboard Smoke Asset ' + marker + ' ' + suffix,
      category: 'EQUIPMENT',
      acquisitionDate: now,
      acquisitionCost: String(amounts.asset),
      currentBookValue: String(amounts.asset),
      collateralStatus: 'USED_AS_COLLATERAL',
      insuranceStatus: 'NOT_INSURED',
      status: 'ACTIVE',
    },
  });
  await prisma.document.create({
    data: {
      title: 'Live Dashboard Smoke Document ' + marker + ' ' + suffix,
      category: 'OTHER',
      ownerType: 'COMPANY',
      ownerId: company.id,
      fileName: 'live-dashboard-smoke-' + marker + '.txt',
      storageKey: 'live-dashboard-smoke/' + suffix + '/' + marker + '.txt',
      mimeType: 'text/plain',
      fileSizeBytes: 32,
      isConfidential: true,
      status: 'ACTIVE',
      expiryDate: in10,
      companyId: company.id,
    },
  });
  await prisma.auditLog.create({
    data: {
      action: 'LIVE_DASHBOARD_SMOKE',
      entityType: 'DashboardLiveSmoke',
      entityId: company.id,
      companyId: company.id,
      severity: 'CRITICAL',
      metadata: { marker, suffix },
    },
  });
  return { id: company.id, divisionId: division.id, branchId: branch.id, amounts };
}

(async () => {
  const permission = await prisma.permission.upsert({
    where: { code: 'group-control.view' },
    update: {},
    create: {
      code: 'group-control.view',
      description: 'View group control dashboard',
      module: 'group-control',
      action: 'view',
      isGroupControl: true,
    },
  });

  const group = await prisma.group.create({
    data: {
      code: 'LDSG' + suffix.slice(-8),
      name: 'Live Dashboard Smoke Group ' + suffix,
    },
  });
  const companyA = await prisma.company.create({
    data: {
      groupId: group.id,
      code: 'LDSA' + suffix.slice(-8),
      name: 'Live Dashboard Smoke Company A ' + suffix,
    },
  });
  const companyB = await prisma.company.create({
    data: {
      groupId: group.id,
      code: 'LDSB' + suffix.slice(-8),
      name: 'Live Dashboard Smoke Company B ' + suffix,
    },
  });

  const companyRole = await prisma.role.create({
    data: {
      name: 'live_dashboard_smoke_company_' + suffix,
      displayName: 'Live Dashboard Smoke Company',
      scope: 'COMPANY',
      rolePermissions: { create: [{ permissionId: permission.id }] },
    },
  });
  const groupRole = await prisma.role.create({
    data: {
      name: 'live_dashboard_smoke_group_' + suffix,
      displayName: 'Live Dashboard Smoke Group',
      scope: 'GROUP',
      rolePermissions: { create: [{ permissionId: permission.id }] },
    },
  });
  const noPermissionRole = await prisma.role.create({
    data: {
      name: 'live_dashboard_smoke_no_permission_' + suffix,
      displayName: 'Live Dashboard Smoke No Permission',
      scope: 'COMPANY',
    },
  });

  const companyUser = await createUser(
    'live-dashboard-company-user',
    'Live Dashboard Smoke Company User',
    companyRole.id,
    companyA.id,
  );
  const groupUser = await createUser(
    'live-dashboard-group-user',
    'Live Dashboard Smoke Group User',
    groupRole.id,
    null,
  );
  const noPermissionUser = await createUser(
    'live-dashboard-no-permission-user',
    'Live Dashboard Smoke No Permission User',
    noPermissionRole.id,
    companyB.id,
  );

  const seededA = await seedCompany(companyA, 'A', { loan: 111, debt: 222, asset: 333 });
  const seededB = await seedCompany(companyB, 'B', { loan: 444, debt: 555, asset: 666 });

  console.log(JSON.stringify({
    suffix,
    password,
    group: { id: group.id },
    companyA: { id: companyA.id, ...seededA },
    companyB: { id: companyB.id, ...seededB },
    companyUser,
    groupUser,
    noPermissionUser,
  }));
})()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => prisma.$disconnect());
`;
  const result = dockerExecNode(script);
  const output = result.stdout.trim().split(/\r?\n/).at(-1);
  if (!output) throw new Error('Fixture creation returned no output');
  const parsed = JSON.parse(output);
  console.log('live dashboard smoke OK: fixture created');
  return parsed;
}

function cleanupFixture(currentFixture) {
  const script = `
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
const fixture = ${JSON.stringify({
    suffix: currentFixture.suffix,
    groupId: currentFixture.group.id,
    companyIds: [currentFixture.companyA.id, currentFixture.companyB.id],
    userIds: [
      currentFixture.companyUser.id,
      currentFixture.groupUser.id,
      currentFixture.noPermissionUser.id,
    ],
  })};
const now = new Date();
(async () => {
  const companyFilter = { in: fixture.companyIds };
  await prisma.auditLog.deleteMany({
    where: { action: 'LIVE_DASHBOARD_SMOKE', entityType: 'DashboardLiveSmoke', companyId: companyFilter },
  });
  await prisma.document.updateMany({ where: { companyId: companyFilter }, data: { deletedAt: now } });
  await prisma.fixedAsset.updateMany({ where: { companyId: companyFilter }, data: { deletedAt: now } });
  await prisma.contract.updateMany({ where: { companyId: companyFilter }, data: { deletedAt: now } });
  await prisma.debt.updateMany({ where: { companyId: companyFilter }, data: { deletedAt: now } });
  await prisma.loan.updateMany({ where: { companyId: companyFilter }, data: { deletedAt: now } });
  await prisma.bankAccount.updateMany({ where: { companyId: companyFilter }, data: { deletedAt: now, isActive: false } });
  await prisma.branch.updateMany({
    where: { division: { companyId: companyFilter } },
    data: { deletedAt: now, isActive: false },
  });
  await prisma.division.updateMany({
    where: { companyId: companyFilter },
    data: { deletedAt: now, isActive: false },
  });
  await prisma.user.updateMany({
    where: { id: { in: fixture.userIds } },
    data: { deletedAt: now, status: 'INACTIVE' },
  });
  await prisma.company.updateMany({
    where: { id: companyFilter },
    data: { deletedAt: now, status: 'DISSOLVED' },
  });
  console.log(JSON.stringify({ cleaned: true, suffix: fixture.suffix }));
})()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => prisma.$disconnect());
`;

  try {
    dockerExecNode(script);
    console.log('live dashboard smoke OK: fixture cleaned up');
  } catch (error) {
    console.warn(`live dashboard smoke warning: fixture cleanup failed: ${error.message}`);
  }
}

async function login(email, password) {
  const response = await apiFetch('/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  const body = await readJson(response, 'login');
  const data = unwrap(body);
  if (!data.accessToken) throw new Error('Login did not return an access token');
  return data.accessToken;
}

async function getDashboardSummary(accessToken, companyId) {
  const path = companyId
    ? `/dashboard/executive-summary?companyId=${encodeURIComponent(companyId)}`
    : '/dashboard/executive-summary';
  const response = await apiFetch(path, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  const body = await readJson(response, 'dashboard summary');
  return unwrap(body);
}

async function assertStatus(label, accessToken, path, expectedStatus) {
  const response = await apiFetch(path, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (response.status !== expectedStatus) {
    throw new Error(
      `${label} expected HTTP ${expectedStatus}, received ${response.status}: ${await response.text()}`,
    );
  }
  console.log(`live dashboard smoke OK: ${label}: HTTP ${expectedStatus}`);
}

function assertCompanyScopedSummary(summary, company, label) {
  assertEqual(`${label} company count`, summary.overview.companies, 1);
  assertEqual(`${label} division count`, summary.overview.divisions, 1);
  assertEqual(`${label} branch count`, summary.overview.branches, 1);
  assertEqual(`${label} active users`, summary.overview.activeUsers, 1);
  assertEqual(`${label} company list size`, summary.companies.length, 1);
  assertEqual(`${label} company id`, summary.companies[0].id, company.id);
  assertEqual(`${label} bank accounts`, summary.groupControl.bankAccounts.total, 1);
  assertEqual(`${label} active loans`, summary.groupControl.loans.active, 1);
  assertEqual(`${label} loan outstanding`, summary.groupControl.loans.outstanding, company.amounts.loan);
  assertEqual(`${label} debt total`, summary.groupControl.debts.totalAmount, company.amounts.debt);
  assertEqual(`${label} active contracts`, summary.groupControl.contracts.active, 1);
  assertEqual(`${label} pending contracts`, summary.groupControl.contracts.pendingApproval, 1);
  assertEqual(`${label} fixed asset value`, summary.groupControl.fixedAssets.totalValue, company.amounts.asset);
  assertEqual(`${label} documents`, summary.groupControl.documents.total, 1);
  assertEqual(`${label} critical audit`, summary.groupControl.audit.critical24h, 1);
  assertEqual(`${label} expiring contracts`, summary.alerts.expiringContracts.length, 1);
  assertEqual(`${label} loan maturities`, summary.alerts.upcomingMaturities.length, 1);
  assertEqual(`${label} expiring documents`, summary.alerts.expiringDocuments.length, 1);
  assertEqual(`${label} high risk loans`, summary.alerts.highRiskLoans.length, 1);
  console.log(`live dashboard smoke OK: ${label} exact counts verified`);
}

function assertEqual(label, actual, expected) {
  if (actual !== expected) {
    throw new Error(`${label} mismatch: expected ${expected}, received ${actual}`);
  }
}

async function apiFetch(path, options = {}, timeoutMs = 30_000) {
  return fetchWithTimeout(resolvePath(apiUrl, path), options, timeoutMs);
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

async function readJson(response, label) {
  const text = await response.text();
  if (!response.ok) {
    throw new Error(`${label} failed with HTTP ${response.status}: ${text}`);
  }
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`${label} returned non-JSON response: ${text.slice(0, 200)}`);
  }
}

function dockerExecNode(script) {
  const result = spawnSync('docker', ['exec', backendContainer, 'node', '-e', script], {
    cwd: rootDir,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  });
  if (result.error) {
    throw new Error(`Unable to run docker exec ${backendContainer}: ${result.error.message}`);
  }
  if (result.status !== 0) {
    console.error(result.stdout);
    console.error(result.stderr);
    throw new Error(`docker exec ${backendContainer} failed with exit code ${result.status}`);
  }
  return result;
}

function unwrap(body) {
  return body && body.success === true && Object.prototype.hasOwnProperty.call(body, 'data')
    ? body.data
    : body;
}

function normalizeUrl(value) {
  return String(value).replace(/\/+$/, '');
}

function resolvePath(baseUrl, path) {
  return path.startsWith('http') ? path : `${baseUrl}${path.startsWith('/') ? path : `/${path}`}`;
}

function loadEnv(file) {
  const values = {};
  for (const line of readFileSync(file, 'utf8').split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const separator = trimmed.indexOf('=');
    if (separator === -1) continue;
    const key = trimmed.slice(0, separator).trim();
    const value = trimmed
      .slice(separator + 1)
      .trim()
      .replace(/^["']|["']$/g, '');
    values[key] = value;
  }
  return values;
}

function parseArgs(argv, envValues) {
  const parsed = {
    envFile: configValue(envValues.npm_config_env_file),
    apiUrl: configValue(envValues.npm_config_api_url),
    backendContainer: configValue(envValues.npm_config_backend_container),
    keepFixture: bool(envValues.npm_config_keep_fixture),
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--env-file') {
      parsed.envFile = argv[index + 1];
      index += 1;
      continue;
    }
    if (arg.startsWith('--env-file=')) {
      parsed.envFile = arg.slice('--env-file='.length);
      continue;
    }
    if (arg === '--api-url') {
      parsed.apiUrl = argv[index + 1];
      index += 1;
      continue;
    }
    if (arg.startsWith('--api-url=')) {
      parsed.apiUrl = arg.slice('--api-url='.length);
      continue;
    }
    if (arg === '--backend-container') {
      parsed.backendContainer = argv[index + 1];
      index += 1;
      continue;
    }
    if (arg.startsWith('--backend-container=')) {
      parsed.backendContainer = arg.slice('--backend-container='.length);
      continue;
    }
    if (arg === '--keep-fixture') {
      parsed.keepFixture = true;
      continue;
    }
    if (!arg.startsWith('--') && !parsed.envFile) {
      parsed.envFile = arg;
      continue;
    }
    throw new Error(`Unknown argument: ${arg}`);
  }

  return parsed;
}

function configValue(value) {
  const normalized = String(value ?? '').trim();
  if (!normalized || ['true', 'false'].includes(normalized.toLowerCase())) return null;
  return normalized;
}

function bool(value) {
  return ['1', 'true', 'yes', 'on'].includes(
    String(value ?? '')
      .trim()
      .toLowerCase(),
  );
}
