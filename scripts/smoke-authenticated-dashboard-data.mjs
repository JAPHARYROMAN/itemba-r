#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const args = new Set(process.argv.slice(2));
const allowLocal = args.has('--allow-local');
const useStaging = args.has('--staging');
const useProduction = args.has('--production');

if (useStaging && useProduction) {
  fail('Use either --staging or --production, not both.');
}

if (!process.env.CI && !allowLocal) {
  fail(
    'Refusing to run authenticated dashboard smoke outside CI without --allow-local because deployment compose files use fixed container names and host ports.',
  );
}

const target = useStaging
  ? {
      name: 'staging',
      composeFile: 'docker-compose.staging.yml',
      postgresDb: 'itemba_r_staging_dashboard_smoke',
      postgresUser: 'itemba_staging_dashboard_smoke',
    }
  : {
      name: 'production',
      composeFile: 'docker-compose.production.yml',
      postgresDb: 'itemba_r_dashboard_smoke',
      postgresUser: 'itemba_dashboard_smoke',
    };

const sampleEnv = {
  POSTGRES_DB: target.postgresDb,
  POSTGRES_USER: target.postgresUser,
  POSTGRES_PASSWORD: 'postgres-dashboard-smoke-validation-secret-40',
  REDIS_PASSWORD: 'redis-dashboard-smoke-validation-secret-40',
  JWT_ACCESS_SECRET: 'jwt-access-dashboard-smoke-validation-secret-40',
  JWT_REFRESH_SECRET: 'jwt-refresh-dashboard-smoke-validation-secret-40',
  TWO_FACTOR_ENCRYPTION_KEY: 'two-factor-dashboard-smoke-validation-secret-40',
  REFRESH_TOKEN_PEPPER: 'refresh-pepper-dashboard-smoke-validation-secret-40',
  APP_ENCRYPTION_KEY: 'app-encryption-dashboard-smoke-validation-secret-40',
  JWT_ACCESS_EXPIRES_IN: '15m',
  JWT_REFRESH_EXPIRES_IN: '7d',
  JOB_WORKER_ENABLED: 'true',
  FRONTEND_URL: 'http://127.0.0.1:3000',
  CORS_ORIGIN: 'http://127.0.0.1:3000',
  NEXT_PUBLIC_API_URL: 'http://127.0.0.1:3001/api/v1',
  BACKEND_INTERNAL_URL: 'http://backend:3001/api/v1',
  STORAGE_DRIVER: 'local',
  STORAGE_LOCAL_PATH: '/app/storage',
  BACKUP_STORAGE_PATH: '/app/backups',
  BACKUPS_DIR: '/app/backups',
};

const tempDir = mkdtempSync(join(tmpdir(), 'itemba-dashboard-smoke-'));
const envFile = join(tempDir, `${target.name}.env`);
writeFileSync(
  envFile,
  `${Object.entries(sampleEnv)
    .map(([key, value]) => `${key}=${value}`)
    .join('\n')}\n`,
  'utf8',
);

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});

async function main() {
  let shouldPrintDiagnostics = true;
  let exitCode = 0;

  try {
    await runSmoke();
    shouldPrintDiagnostics = false;
    console.log(`smoke-authenticated-dashboard-data: OK ${target.name}`);
  } catch (error) {
    if (shouldPrintDiagnostics) {
      printDiagnostics();
    }
    console.error(error.message);
    exitCode = 1;
  } finally {
    compose(['down', '-v', '--remove-orphans'], { allowFailure: true });
    rmSync(tempDir, { recursive: true, force: true });
  }

  if (exitCode !== 0) {
    process.exit(exitCode);
  }
}

async function runSmoke() {
  console.log(`Starting ${target.name} authenticated dashboard data smoke...`);
  compose(['down', '-v', '--remove-orphans'], { allowFailure: true });
  compose(['up', '--build', '-d', 'backend']);

  await waitForBackendReady();

  const fixture = createFixture();
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
  assertCompanyScopedSummary(companySummary, fixture);

  const groupSummary = await getDashboardSummary(groupToken);
  assertGroupSummary(groupSummary, fixture);
}

function createFixture() {
  const suffix = Date.now().toString();
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
      name: 'Dashboard Smoke Division ' + marker,
      code: 'DSD' + marker + suffix.slice(-6),
      type: 'OTHER',
    },
  });
  await prisma.branch.create({
    data: {
      divisionId: division.id,
      name: 'Dashboard Smoke Branch ' + marker,
      code: 'DSB' + marker + suffix.slice(-6),
      type: 'BRANCH',
    },
  });
  await prisma.bankAccount.create({
    data: {
      companyId: company.id,
      bankName: 'Dashboard Smoke Bank ' + marker,
      accountName: 'Dashboard Smoke Account ' + marker,
      accountNumber: 'DASH' + marker + suffix,
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
      lenderName: 'Dashboard Smoke Lender ' + marker,
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
      creditorName: 'Dashboard Smoke Creditor ' + marker,
      amount: String(amounts.debt),
      description: 'Dashboard smoke debt ' + marker,
      status: 'OUTSTANDING',
      riskLevel: 'MEDIUM',
    },
  });
  await prisma.contract.create({
    data: {
      companyId: company.id,
      owningLevel: 'COMPANY',
      title: 'Dashboard Smoke Active Contract ' + marker,
      contractType: 'SERVICE',
      counterpartyName: 'Dashboard Smoke Counterparty ' + marker,
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
      title: 'Dashboard Smoke Pending Contract ' + marker,
      contractType: 'SERVICE',
      counterpartyName: 'Dashboard Smoke Approval ' + marker,
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
      assetCode: 'DSA-' + marker + '-' + suffix.slice(-8),
      name: 'Dashboard Smoke Asset ' + marker,
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
      title: 'Dashboard Smoke Document ' + marker,
      category: 'OTHER',
      ownerType: 'COMPANY',
      ownerId: company.id,
      fileName: 'dashboard-smoke-' + marker + '.txt',
      storageKey: 'dashboard-smoke/' + suffix + '/' + marker + '.txt',
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
      action: 'DASHBOARD_SMOKE',
      entityType: 'DashboardSmoke',
      entityId: company.id,
      companyId: company.id,
      severity: 'CRITICAL',
      metadata: { marker },
    },
  });
  return { id: company.id, divisionId: division.id };
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
      code: 'DASHG' + suffix.slice(-8),
      name: 'Dashboard Smoke Group ' + suffix,
    },
  });
  const companyA = await prisma.company.create({
    data: {
      groupId: group.id,
      code: 'DASHA' + suffix.slice(-8),
      name: 'Dashboard Smoke Company A ' + suffix,
    },
  });
  const companyB = await prisma.company.create({
    data: {
      groupId: group.id,
      code: 'DASHB' + suffix.slice(-8),
      name: 'Dashboard Smoke Company B ' + suffix,
    },
  });

  const companyRole = await prisma.role.create({
    data: {
      name: 'dashboard_smoke_company_' + suffix,
      displayName: 'Dashboard Smoke Company',
      scope: 'COMPANY',
      rolePermissions: { create: [{ permissionId: permission.id }] },
    },
  });
  const groupRole = await prisma.role.create({
    data: {
      name: 'dashboard_smoke_group_' + suffix,
      displayName: 'Dashboard Smoke Group',
      scope: 'GROUP',
      rolePermissions: { create: [{ permissionId: permission.id }] },
    },
  });
  const noPermissionRole = await prisma.role.create({
    data: {
      name: 'dashboard_smoke_no_permission_' + suffix,
      displayName: 'Dashboard Smoke No Permission',
      scope: 'COMPANY',
    },
  });

  const companyUser = await createUser(
    'dashboard-company-user',
    'Dashboard Smoke Company User',
    companyRole.id,
    companyA.id,
  );
  const groupUser = await createUser(
    'dashboard-group-user',
    'Dashboard Smoke Group User',
    groupRole.id,
    null,
  );
  const noPermissionUser = await createUser(
    'dashboard-no-permission-user',
    'Dashboard Smoke No Permission User',
    noPermissionRole.id,
    companyB.id,
  );

  await seedCompany(companyA, 'A', { loan: 111, debt: 222, asset: 333 });
  await seedCompany(companyB, 'B', { loan: 444, debt: 555, asset: 666 });

  console.log(JSON.stringify({
    password,
    companyA: { id: companyA.id },
    companyB: { id: companyB.id },
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
  const result = compose(['exec', '-T', 'backend', 'node', '-e', script], { capture: true });
  const output = result.stdout.trim().split(/\r?\n/).at(-1);
  if (!output) throw new Error('Fixture creation returned no output');
  return JSON.parse(output);
}

async function login(email, password) {
  const response = await fetchWithTimeout(
    'http://127.0.0.1:3001/api/v1/auth/login',
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
    },
    30_000,
  );
  const body = await readJson(response, 'login');
  const data = body.data ?? body;
  if (!data.accessToken) throw new Error('Login did not return an access token');
  return data.accessToken;
}

async function getDashboardSummary(accessToken) {
  const response = await fetchWithTimeout(
    'http://127.0.0.1:3001/api/v1/dashboard/executive-summary',
    {
      headers: { Authorization: `Bearer ${accessToken}` },
    },
    30_000,
  );
  const body = await readJson(response, 'dashboard summary');
  return body.data ?? body;
}

async function assertStatus(label, accessToken, path, expectedStatus) {
  const response = await fetchWithTimeout(`http://127.0.0.1:3001/api/v1${path}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (response.status !== expectedStatus) {
    throw new Error(
      `${label} expected HTTP ${expectedStatus}, received ${response.status}: ${await response.text()}`,
    );
  }
  console.log(`${label}: HTTP ${expectedStatus}`);
}

function assertCompanyScopedSummary(summary, fixture) {
  assertEqual('company summary company count', summary.overview.companies, 1);
  assertEqual('company summary division count', summary.overview.divisions, 1);
  assertEqual('company summary branch count', summary.overview.branches, 1);
  assertEqual('company summary active users', summary.overview.activeUsers, 1);
  assertEqual('company summary company list size', summary.companies.length, 1);
  assertEqual('company summary company id', summary.companies[0].id, fixture.companyA.id);
  assertEqual('company summary bank accounts', summary.groupControl.bankAccounts.total, 1);
  assertEqual('company summary active loans', summary.groupControl.loans.active, 1);
  assertEqual('company summary loan outstanding', summary.groupControl.loans.outstanding, 111);
  assertEqual('company summary debt total', summary.groupControl.debts.totalAmount, 222);
  assertEqual('company summary active contracts', summary.groupControl.contracts.active, 1);
  assertEqual(
    'company summary pending contracts',
    summary.groupControl.contracts.pendingApproval,
    1,
  );
  assertEqual(
    'company summary fixed asset value',
    summary.groupControl.fixedAssets.totalValue,
    333,
  );
  assertEqual('company summary documents', summary.groupControl.documents.total, 1);
  assertEqual('company summary critical audit', summary.groupControl.audit.critical24h, 1);
  assertEqual('company summary expiring contracts', summary.alerts.expiringContracts.length, 1);
  assertEqual('company summary loan maturities', summary.alerts.upcomingMaturities.length, 1);
  assertEqual('company summary expiring documents', summary.alerts.expiringDocuments.length, 1);
  assertEqual('company summary high risk loans', summary.alerts.highRiskLoans.length, 1);
  console.log('company-scoped dashboard counts verified');
}

function assertGroupSummary(summary) {
  assertEqual('group summary company count', summary.overview.companies, 2);
  assertEqual('group summary division count', summary.overview.divisions, 2);
  assertEqual('group summary branch count', summary.overview.branches, 2);
  assertEqual('group summary bank accounts', summary.groupControl.bankAccounts.total, 2);
  assertEqual('group summary active loans', summary.groupControl.loans.active, 2);
  assertEqual('group summary loan outstanding', summary.groupControl.loans.outstanding, 555);
  assertEqual('group summary debt total', summary.groupControl.debts.totalAmount, 777);
  assertEqual('group summary fixed asset value', summary.groupControl.fixedAssets.totalValue, 999);
  assertEqual('group summary documents', summary.groupControl.documents.total, 2);
  assertEqual('group summary critical audit', summary.groupControl.audit.critical24h, 2);
  assertEqual('group summary companies listed', summary.companies.length, 2);
  console.log('group-wide dashboard counts verified');
}

function assertEqual(label, actual, expected) {
  if (actual !== expected) {
    throw new Error(`${label} mismatch: expected ${expected}, received ${actual}`);
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

async function waitForBackendReady() {
  await waitForHttp(
    'backend readiness',
    'http://127.0.0.1:3001/api/v1/health/ready',
    240_000,
    async (response) => {
      if (!response.ok) return false;
      const body = await response.json().catch(() => null);
      const health = body?.data ?? body;
      return health?.database === 'up' && health?.status !== 'critical';
    },
  );
}

async function fetchWithTimeout(url, options = {}, timeoutMs = 5_000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

function compose(composeArgs, options = {}) {
  return runDocker(
    ['compose', '--env-file', envFile, '-f', resolve(rootDir, target.composeFile), ...composeArgs],
    options,
  );
}

function runDocker(dockerArgs, { allowFailure = false, capture = false } = {}) {
  const result = spawnSync('docker', dockerArgs, {
    cwd: rootDir,
    encoding: 'utf8',
    stdio: capture ? ['ignore', 'pipe', 'pipe'] : 'inherit',
    windowsHide: true,
  });

  if (result.error) {
    if (allowFailure) {
      console.error(`Unable to run docker ${dockerArgs.join(' ')}: ${result.error.message}`);
      return result;
    }
    throw new Error(`Unable to run docker ${dockerArgs.join(' ')}: ${result.error.message}`);
  }

  if (result.status !== 0 && !allowFailure) {
    if (capture) {
      console.error(result.stdout);
      console.error(result.stderr);
    }
    throw new Error(`docker ${dockerArgs.join(' ')} failed with exit code ${result.status}`);
  }

  return result;
}

async function waitForHttp(label, url, timeoutMs, predicate) {
  const startedAt = Date.now();
  let lastError = 'not attempted';

  while (Date.now() - startedAt < timeoutMs) {
    try {
      const response = await fetchWithTimeout(url);
      if (await predicate(response)) {
        console.log(`${label} is ready`);
        return;
      }
      lastError = `HTTP ${response.status}`;
    } catch (error) {
      lastError = error.message;
    }

    await sleep(3_000);
  }

  throw new Error(
    `${label} did not become ready within ${timeoutMs / 1000}s; last result: ${lastError}`,
  );
}

function sleep(ms) {
  return new Promise((resolveSleep) => setTimeout(resolveSleep, ms));
}

function printDiagnostics() {
  console.error(`\n${target.name} authenticated dashboard diagnostics:`);
  compose(['ps'], { allowFailure: true });
  compose(
    ['logs', '--no-color', '--tail', '220', 'backend-migrate', 'backend', 'postgres', 'redis'],
    {
      allowFailure: true,
    },
  );
}

function fail(message) {
  console.error(message);
  process.exit(1);
}
