import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// Synthetic, authenticated API proof. Never accepts a working/staging database override.
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(resolve(root, 'backend/package.json'));
const { PrismaClient } = require('@prisma/client');
const argon2 = require('argon2');
const config = Object.fromEntries(
  readFileSync(resolve(root, '.release/rehearsal.env'), 'utf8')
    .trim()
    .split(/\r?\n/)
    .map((line) => [line.slice(0, line.indexOf('=')), line.slice(line.indexOf('=') + 1)]),
);
const database = new URL(config.DATABASE_URL);
assert.equal(database.hostname, '127.0.0.1');
assert.equal(database.port, '5549');
assert.equal(database.pathname, '/itemba_release_proof');
const db = new PrismaClient({ datasources: { db: { url: config.DATABASE_URL } } });
const base = 'http://127.0.0.1:3114/api/v1';
const output = resolve(root, '.release/os-design');
mkdirSync(output, { recursive: true });
const fixture = JSON.parse(readFileSync(resolve(root, '.release/browser-fixture.json'), 'utf8'));
const marker = `OSProof-${Date.now().toString(36)}`;
const checks = [];
let activeCheck = 'Fixture setup';
async function request(token, method, path, body, status = 200) {
  const response = await fetch(base + path, {
    method,
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(body && !(body instanceof FormData) ? { 'Content-Type': 'application/json' } : {}),
    },
    ...(body ? { body: body instanceof FormData ? body : JSON.stringify(body) } : {}),
    signal: AbortSignal.timeout(30000),
  });
  assert.equal(
    response.status,
    status,
    `${method} ${path}: expected ${status}, received ${response.status}`,
  );
  return response;
}
async function json(response) {
  const body = await response.json();
  return body.data ?? body;
}
async function check(name, action) {
  activeCheck = name;
  await action();
  checks.push({ name, status: 'passed' });
  console.log(`PASS ${name}`);
}
const invoicePermissions = ['invoice_desk.view'];
const filePermissions = [
  ...invoicePermissions,
  'invoice_desk.manage',
  'documents.view',
  'documents.manage',
];
async function actor(name, companyId, scope, permissions, divisionId, branchId) {
  const role = await db.role.create({
    data: {
      name: `${marker}-${name}`,
      displayName: `Search proof ${name}`,
      scope,
      rolePermissions: {
        create: permissions.map((code) => ({ permission: { connect: { code } } })),
      },
    },
  });
  const user = await db.user.create({
    data: {
      fullName: `Search proof ${name}`,
      email: `${marker}-${name}@example.invalid`.toLowerCase(),
      passwordHash: await argon2.hash(config.RELEASE_PROOF_USER_PASSWORD),
      companyId,
      status: 'ACTIVE',
      userRoles: { create: { roleId: role.id } },
      companyAccess: { create: { companyId, accessLevel: 'MANAGE' } },
      ...(divisionId ? { divisionAccess: { create: { divisionId, accessLevel: 'READ' } } } : {}),
      ...(branchId ? { branchAccess: { create: { branchId, accessLevel: 'READ' } } } : {}),
    },
  });
  const signedIn = await json(
    await request(null, 'POST', '/auth/login', {
      email: user.email,
      password: config.RELEASE_PROOF_USER_PASSWORD,
    }),
  );
  assert.ok(signedIn.accessToken);
  return signedIn.accessToken;
}
async function main() {
  await request(null, 'GET', '/health/ready');
  const a = await db.company.findUniqueOrThrow({ where: { id: fixture.companyId } });
  const b = await db.company.findFirstOrThrow({
    where: { groupId: a.groupId, id: { not: a.id }, deletedAt: null },
  });
  async function branches(companyId) {
    return db.branch.findMany({
      where: { division: { companyId } },
      include: { division: true },
      orderBy: { code: 'asc' },
    });
  }
  const aBranches = await branches(a.id),
    bBranches = await branches(b.id);
  const own = aBranches.find((branch) =>
    aBranches.some((other) => other.id !== branch.id && other.divisionId === branch.divisionId),
  );
  assert.ok(own, 'Run the business workflow rehearsal first: two sibling branches are needed.');
  const sibling = aBranches.find(
    (branch) => branch.id !== own.id && branch.divisionId === own.divisionId,
  );
  const separate = aBranches.find((branch) => branch.divisionId !== own.divisionId);
  assert.ok(sibling && separate && bBranches.length);
  for (const code of [...filePermissions, 'cash_desk.view']) {
    await db.permission.upsert({
      where: { code },
      update: {},
      create: {
        code,
        description: 'Isolated OS search proof',
        module: code.split('.')[0],
        action: code.split('.').slice(1).join('.'),
      },
    });
  }
  const company = await actor('company', a.id, 'COMPANY', filePermissions);
  const foreign = await actor('foreign', b.id, 'COMPANY', filePermissions);
  const division = await actor('division', a.id, 'DIVISION', invoicePermissions, own.divisionId);
  const branch = await actor('branch', a.id, 'BRANCH', invoicePermissions, undefined, own.id);
  const documentsOnly = await actor('documents', a.id, 'COMPANY', ['documents.view']);
  const noFiles = await actor('no-files', a.id, 'COMPANY', ['cash_desk.view']);
  const noBranch = await actor('no-branch-grant', a.id, 'BRANCH', invoicePermissions);
  const bytes = readFileSync(resolve(root, 'frontend/public/brand/itemba-group-logo.png'));
  const owners = [];
  for (const [index, place] of [own, sibling, separate, bBranches[0]].entries()) {
    const companyId = place.division.companyId,
      token = companyId === a.id ? company : foreign;
    const supplier = await json(
      await request(
        token,
        'POST',
        '/invoice-desk/suppliers',
        { companyId, name: `${marker} supplier ${index}` },
        201,
      ),
    );
    const invoice = await json(
      await request(
        token,
        'POST',
        '/invoice-desk/invoices',
        {
          companyId,
          divisionId: place.divisionId,
          branchId: place.id,
          supplierId: supplier.id,
          invoiceNumber: `${marker}-${index}`,
          description: 'Synthetic file search fixture',
          currency: 'TZS',
          invoiceDate: '2026-09-20',
          dueDate: '2026-09-30',
          totalAmount: '10.00',
        },
        201,
      ),
    );
    const form = new FormData();
    form.set('file', new Blob([bytes], { type: 'image/png' }), `${marker}-${index}.png`);
    const attachment = await json(
      await request(token, 'POST', `/invoice-desk/invoices/${invoice.id}/attachments`, form, 201),
    );
    owners.push({ invoiceId: invoice.id, attachmentId: attachment.id, companyId });
  }
  const documents = [];
  for (const [companyId, token] of [
    [a.id, company],
    [b.id, foreign],
  ]) {
    const form = new FormData();
    form.set('file', new Blob([bytes], { type: 'image/png' }), `${marker}-library.png`);
    form.set('title', `${marker} library file`);
    form.set('ownerType', 'COMPANY');
    form.set('ownerId', companyId);
    form.set('companyId', companyId);
    form.set('isConfidential', 'false');
    documents.push(await json(await request(token, 'POST', '/documents/upload', form, 201)));
  }
  const url = `/global-search?q=${encodeURIComponent(marker)}&category=files&limit=12`;
  async function search(token, suffix = '') {
    return json(await request(token, 'GET', url + suffix));
  }
  const ids = (response) =>
    response.groups.flatMap((group) => group.results.map((result) => result.id)).sort();
  const before = await db.invoiceDeskAttachment.count({
    where: { invoiceId: { in: owners.map((owner) => owner.invoiceId) } },
  });
  await check('Company file search includes its three branches and library file only', async () => {
    const found = await search(company);
    assert.deepEqual(
      ids(found),
      [...owners.slice(0, 3).map((owner) => owner.attachmentId), documents[0].id].sort(),
    );
    for (const result of found.groups.flatMap((group) => group.results)) {
      assert.equal(result.file.id, result.id);
      assert.ok(['document', 'invoice-attachment'].includes(result.file.kind));
      assert.ok(!('content' in result.file) && !('storageKey' in result.file));
      if (result.file.kind === 'invoice-attachment')
        assert.equal(result.href, `/invoice-desk?record=${result.file.invoiceId}`);
      else assert.equal(result.href, `/group-control/documents/${result.id}`);
    }
  });
  await check('Division file search includes siblings but excludes another division', async () => {
    assert.deepEqual(
      ids(await search(division)),
      owners
        .slice(0, 2)
        .map((owner) => owner.attachmentId)
        .sort(),
    );
  });
  await check('Branch file search includes only its own invoice attachment', async () => {
    assert.deepEqual(ids(await search(branch)), [owners[0].attachmentId]);
  });
  await check('A branch role without a branch grant cannot discover attachments', async () => {
    assert.equal((await search(noBranch)).total, 0);
  });
  await check('Document and invoice access remain independent', async () => {
    assert.deepEqual(ids(await search(documentsOnly)), [documents[0].id]);
    assert.equal((await search(noFiles)).total, 0);
    assert.deepEqual(ids(await search(foreign)), [owners[3].attachmentId, documents[1].id].sort());
  });
  await check('Requested company and authentication boundaries are enforced', async () => {
    await request(company, 'GET', `${url}&companyId=${b.id}`, undefined, 403);
    await request(null, 'GET', url, undefined, 401);
    await request(company, 'GET', `/global-search?q=${marker}&category=invalid`, undefined, 400);
  });
  await check('Invoice preview and original download agree with the searched file', async () => {
    const path = `/invoice-desk/invoices/${owners[0].invoiceId}/attachments/${owners[0].attachmentId}`;
    assert.equal((await json(await request(branch, 'GET', `${path}/preview`))).kind, 'image');
    const original = await request(branch, 'GET', path);
    assert.match(original.headers.get('cache-control'), /no-store/);
    assert.equal(original.headers.get('x-content-type-options'), 'nosniff');
    assert.ok(Buffer.from(await original.arrayBuffer()).equals(bytes));
    await request(noFiles, 'GET', `${path}/preview`, undefined, 403);
  });
  await check(
    'A guessed sibling attachment and another-company document remain inaccessible',
    async () => {
      const siblingPath = `/invoice-desk/invoices/${owners[1].invoiceId}/attachments/${owners[1].attachmentId}`;
      await request(branch, 'GET', `${siblingPath}/preview`, undefined, 404);
      await request(company, 'GET', `/documents/${documents[1].id}/preview`, undefined, 403);
      await request(
        branch,
        'GET',
        `/invoice-desk/invoices/${owners[0].invoiceId}/attachments/${owners[1].attachmentId}/preview`,
        undefined,
        404,
      );
    },
  );
  await check('Library preview and original download agree with the searched file', async () => {
    assert.equal(
      (await json(await request(documentsOnly, 'GET', `/documents/${documents[0].id}/preview`)))
        .kind,
      'image',
    );
    const original = await request(documentsOnly, 'GET', `/documents/${documents[0].id}/download`);
    assert.ok(Buffer.from(await original.arrayBuffer()).equals(bytes));
  });
  await check(
    'All-results search opens the invoice owner and enforces the same scope',
    async () => {
      const found = await json(await request(branch, 'GET', `/global-search?q=${marker}&limit=12`));
      assert.deepEqual(
        found.groups.map((group) => group.key),
        ['desk-invoices', 'invoice-attachments'],
      );
      assert.equal(found.groups[0].results[0].href, `/invoice-desk?record=${owners[0].invoiceId}`);
      assert.equal(found.total, 2);
    },
  );
  await check(
    'Short searches and per-source limits are applied without duplicating uploads',
    async () => {
      assert.equal(
        (await json(await request(company, 'GET', '/global-search?q=x&category=files'))).total,
        0,
      );
      const limited = await json(
        await request(company, 'GET', `/global-search?q=${marker}&category=files&limit=1`),
      );
      assert.equal(limited.total, 2);
      assert.ok(limited.groups.every((group) => group.results.length === 1));
      assert.equal(
        await db.invoiceDeskAttachment.count({
          where: { invoiceId: { in: owners.map((owner) => owner.invoiceId) } },
        }),
        before,
      );
    },
  );
}
try {
  await main();
} catch (error) {
  checks.push({ name: activeCheck, status: 'failed', error: error.message });
  console.error(`FAIL ${activeCheck}: ${error.message}`);
  process.exitCode = 1;
} finally {
  await db.$disconnect();
  writeFileSync(
    resolve(output, 'acceptance-search.json'),
    JSON.stringify(
      {
        createdAt: new Date().toISOString(),
        environment: 'isolated local rehearsal',
        marker,
        checks,
        limits:
          'Authenticated real API and database checks. Live browser interaction is not exercised.',
      },
      null,
      2,
    ) + '\n',
  );
  console.log(
    `${checks.filter((check) => check.status === 'passed').length} passed; ${checks.filter((check) => check.status === 'failed').length} failed.`,
  );
}
