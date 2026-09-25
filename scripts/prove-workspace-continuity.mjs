import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';

// Only the disposable release fixture may be mutated by this proof.
const require = createRequire(resolve('backend/package.json'));
const { PrismaClient } = require('@prisma/client');
const env = Object.fromEntries(
  readFileSync('.release/rehearsal.env', 'utf8')
    .trim()
    .split(/\r?\n/)
    .map((line) => [line.slice(0, line.indexOf('=')), line.slice(line.indexOf('=') + 1)]),
);
const url = new URL(env.DATABASE_URL);
assert.equal(url.hostname, '127.0.0.1');
assert.equal(url.port, '5549');
assert.equal(url.pathname, '/itemba_release_proof');
const fixture = JSON.parse(readFileSync('.release/browser-fixture.json', 'utf8'));
assert.match(fixture.email, /^finance-.*@example\.invalid$/);
const db = new PrismaClient({ datasources: { db: { url: env.DATABASE_URL } } });
const base = 'http://127.0.0.1:3114/api/v1';
const stamp = randomUUID();
const checks = [];
async function request(token, method, path, body, expected = 200) {
  const response = await fetch(base + path, {
    method,
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(body && !(body instanceof FormData) ? { 'Content-Type': 'application/json' } : {}),
    },
    ...(body ? { body: body instanceof FormData ? body : JSON.stringify(body) } : {}),
    signal: AbortSignal.timeout(30000),
  });
  assert.equal(response.status, expected, `${method} ${path}: unexpected HTTP ${response.status}`);
  return response;
}
async function json(response) {
  const value = await response.json();
  return value.data ?? value;
}
async function check(name, fn) {
  await fn();
  checks.push({ name, status: 'passed' });
  console.log(`PASS ${name}`);
}
async function login(email) {
  return (
    await json(
      await request(null, 'POST', '/auth/login', {
        email,
        password: env.RELEASE_PROOF_USER_PASSWORD,
      }),
    )
  ).accessToken;
}
try {
  const source = await db.user.findUniqueOrThrow({ where: { email: fixture.email } });
  const otherCompany = await db.company.findFirstOrThrow({
    where: { id: { not: fixture.companyId }, deletedAt: null },
  });
  async function actor(kind, codes, scope = 'COMPANY') {
    for (const code of codes)
      await db.permission.upsert({
        where: { code },
        update: {},
        create: {
          code,
          module: code.split('.')[0],
          action: code.split('.')[1],
          description: 'Isolated workspace proof',
        },
      });
    const role = await db.role.create({
      data: {
        name: `workspace-${kind}-${stamp}`,
        displayName: 'Workspace proof',
        scope,
        rolePermissions: { create: codes.map((code) => ({ permission: { connect: { code } } })) },
      },
    });
    const user = await db.user.create({
      data: {
        email: `workspace-${kind}-${stamp}@example.invalid`,
        fullName: 'Synthetic workspace proof',
        passwordHash: source.passwordHash,
        status: 'ACTIVE',
        companyId: fixture.companyId,
        userRoles: { create: { roleId: role.id } },
        companyAccess: { create: { companyId: fixture.companyId, accessLevel: 'MANAGE' } },
      },
    });
    return { user, role, token: await login(user.email) };
  }
  const owner = await actor('owner', ['documents.manage', 'documents.view']);
  const other = await actor('other', ['documents.manage', 'documents.view']);
  const admin = await actor('admin', ['users.assign_roles', 'users.view'], 'GROUP');
  const sessionId = `session-${stamp}`;
  const layout = {
    version: 1,
    activeId: 'report-a',
    windows: [
      {
        id: 'report-a',
        appId: 'reports',
        href: '/reports?view=sales&from=2026-09-01',
        mode: 'left',
        bounds: { x: 0, y: 0, width: 700, height: 800 },
      },
      {
        id: 'report-b',
        appId: 'reports',
        href: '/reports?view=sales&from=2026-08-01',
        mode: 'right',
        bounds: { x: 700, y: 0, width: 700, height: 800 },
      },
    ],
  };
  const session = {
    name: 'Release proof desktop',
    deviceId: `device-${stamp}`,
    expectedRevision: 0,
    layout,
  };
  await check('Named session restores independent app locations after a new sign-in', async () => {
    await request(owner.token, 'PUT', `/workspace/sessions/${sessionId}`, session);
    const nextToken = await login(owner.user.email);
    const saved = (await json(await request(nextToken, 'GET', '/workspace/sessions'))).find(
      (row) => row.id === sessionId,
    );
    assert.deepEqual(saved.layout, layout);
  });
  await check('Session ownership and stale revisions prevent overwrites', async () => {
    await request(owner.token, 'PUT', `/workspace/sessions/${sessionId}`, session, 409);
    await request(
      other.token,
      'PUT',
      `/workspace/sessions/${sessionId}`,
      { ...session, expectedRevision: 1 },
      404,
    );
    assert.ok(
      !(await json(await request(other.token, 'GET', '/workspace/sessions'))).some(
        (row) => row.id === sessionId,
      ),
    );
  });
  const draftId = `draft-${stamp}`,
    firstLease = `first-${stamp}`,
    secondLease = `second-${stamp}`;
  const content = {
    title: 'Private synthetic letter',
    context: { kind: 'letter', companyId: fixture.companyId },
    values: { companyId: fixture.companyId, body: `private-body-${stamp}` },
    requestId: `request-${stamp}`,
  };
  const draft = (expectedRevision, leaseToken = firstLease, nextContent = content) => ({
    appId: 'documents',
    formType: 'documents:letter:v1',
    schemaVersion: 1,
    expectedRevision,
    leaseToken,
    content: nextContent,
  });
  await check('Draft inputs are encrypted at rest and recover with review required', async () => {
    await request(owner.token, 'PUT', `/workspace/drafts/${draftId}`, draft(0));
    const stored = await db.workspaceDraft.findUniqueOrThrow({ where: { id: draftId } });
    assert.match(stored.encryptedContent, /^v1:/);
    assert.ok(!stored.encryptedContent.includes(content.values.body));
    assert.notEqual(stored.leaseToken, firstLease);
    const recovered = await json(
      await request(await login(owner.user.email), 'GET', `/workspace/drafts/${draftId}`),
    );
    assert.deepEqual(recovered.values, content.values);
    assert.equal(recovered.requestId, content.requestId);
    assert.equal(recovered.needsReview, true);
  });
  await check('Another owner cannot read, list, overwrite or discard a private draft', async () => {
    await request(other.token, 'GET', `/workspace/drafts/${draftId}`, undefined, 404);
    await request(other.token, 'PUT', `/workspace/drafts/${draftId}`, draft(1), 404);
    await request(
      other.token,
      'POST',
      `/workspace/drafts/${draftId}/discard`,
      { expectedRevision: 1, leaseToken: firstLease },
      201,
    );
    assert.ok(await db.workspaceDraft.findUnique({ where: { id: draftId } }));
    assert.ok(
      !(await json(await request(other.token, 'GET', '/workspace/drafts'))).some(
        (row) => row.id === draftId,
      ),
    );
  });
  await check('Edit leases and concurrent saves allow exactly one revision winner', async () => {
    await request(
      owner.token,
      'PUT',
      `/workspace/drafts/${draftId}/lease`,
      { expectedRevision: 1, leaseToken: secondLease },
      409,
    );
    const responses = await Promise.all(
      [1, 2].map((attempt) =>
        fetch(`${base}/workspace/drafts/${draftId}`, {
          method: 'PUT',
          headers: { Authorization: `Bearer ${owner.token}`, 'Content-Type': 'application/json' },
          body: JSON.stringify(
            draft(1, firstLease, { ...content, title: `Concurrent edit ${attempt}` }),
          ),
        }),
      ),
    );
    assert.deepEqual(responses.map((response) => response.status).sort(), [200, 409]);
    assert.equal(
      (await json(await request(owner.token, 'GET', `/workspace/drafts/${draftId}`))).revision,
      2,
    );
  });
  await check(
    'Expired lease handover retains transaction identity and uncertain status',
    async () => {
      await db.workspaceDraft.update({ where: { id: draftId }, data: { leaseUntil: new Date(0) } });
      await request(owner.token, 'PUT', `/workspace/drafts/${draftId}/lease`, {
        expectedRevision: 2,
        leaseToken: secondLease,
      });
      await request(owner.token, 'PUT', `/workspace/drafts/${draftId}`, draft(2, firstLease), 409);
      await request(
        owner.token,
        'PUT',
        `/workspace/drafts/${draftId}`,
        draft(2, secondLease, { ...content, requestId: 'replacement' }),
        409,
      );
      await request(
        owner.token,
        'PUT',
        `/workspace/drafts/${draftId}`,
        draft(2, secondLease, { ...content, submission: 'uncertain' }),
      );
      await request(
        owner.token,
        'PUT',
        `/workspace/drafts/${draftId}`,
        draft(3, secondLease, { ...content, submission: null }),
      );
      const saved = await json(await request(owner.token, 'GET', `/workspace/drafts/${draftId}`));
      assert.equal(saved.submission, 'uncertain');
      assert.equal(saved.requestId, content.requestId);
    },
  );
  await check('Unsupported forms and inaccessible organisations are rejected', async () => {
    await request(
      owner.token,
      'PUT',
      `/workspace/drafts/unknown-${stamp}`,
      { ...draft(0), formType: 'documents:unknown:v1' },
      400,
    );
    await request(
      owner.token,
      'PUT',
      `/workspace/drafts/foreign-${stamp}`,
      draft(0, firstLease, {
        ...content,
        context: { ...content.context, companyId: otherCompany.id },
        values: { ...content.values, companyId: otherCompany.id },
      }),
      403,
    );
  });
  await check(
    'Role revocation immediately blocks reads, writes, leases and discard using the existing token',
    async () => {
      await request(admin.token, 'PUT', `/users/${owner.user.id}/roles`, { roleIds: [] });
      await request(owner.token, 'GET', `/workspace/drafts/${draftId}`, undefined, 403);
      await request(owner.token, 'PUT', `/workspace/drafts/${draftId}`, draft(4, secondLease), 403);
      await request(
        owner.token,
        'PUT',
        `/workspace/drafts/${draftId}/lease`,
        { expectedRevision: 4, leaseToken: secondLease },
        403,
      );
      await request(
        owner.token,
        'POST',
        `/workspace/drafts/${draftId}/discard`,
        { expectedRevision: 4, leaseToken: secondLease },
        403,
      );
      assert.ok(
        !(await json(await request(owner.token, 'GET', '/workspace/drafts'))).some(
          (row) => row.id === draftId,
        ),
      );
      await request(admin.token, 'PUT', `/users/${owner.user.id}/roles`, {
        roleIds: [owner.role.id],
      });
      assert.equal(
        (await json(await request(owner.token, 'GET', `/workspace/drafts/${draftId}`))).revision,
        4,
      );
    },
  );
  await check('Private wallpaper decoding and owner isolation', async () => {
    const image = readFileSync('frontend/public/brand/itemba-group-logo.png');
    const form = new FormData();
    form.set('file', new Blob([image], { type: 'image/png' }), 'synthetic-logo.png');
    const saved = await json(
      await request(owner.token, 'POST', '/workspace/wallpapers', form, 201),
    );
    const response = await request(owner.token, 'GET', `/workspace/wallpapers/${saved.id}/image`);
    assert.equal(response.headers.get('content-type'), 'image/webp');
    assert.equal(
      Buffer.from(await response.arrayBuffer())
        .subarray(0, 4)
        .toString(),
      'RIFF',
    );
    await request(other.token, 'GET', `/workspace/wallpapers/${saved.id}/image`, undefined, 404);
    await request(other.token, 'DELETE', `/workspace/wallpapers/${saved.id}`);
    await request(owner.token, 'GET', `/workspace/wallpapers/${saved.id}/image`);
    const invalid = new FormData();
    invalid.set('file', new Blob(['not-an-image'], { type: 'image/png' }), 'fake.png');
    await request(owner.token, 'POST', '/workspace/wallpapers', invalid, 400);
    await request(owner.token, 'DELETE', `/workspace/wallpapers/${saved.id}`);
  });
  await request(
    owner.token,
    'POST',
    `/workspace/drafts/${draftId}/discard`,
    { expectedRevision: 4, leaseToken: secondLease },
    201,
  );
  await request(owner.token, 'GET', `/workspace/drafts/${draftId}`, undefined, 404);
  await request(owner.token, 'DELETE', `/workspace/sessions/${sessionId}`);
  writeFileSync(
    '.release/workspace-continuity.json',
    JSON.stringify(
      {
        createdAt: new Date().toISOString(),
        environment: 'isolated local release API and PostgreSQL',
        checks,
        limits:
          'Synthetic accounts. Browser network interruption and cross-device UI acceptance are separate checks.',
      },
      null,
      2,
    ),
  );
  console.log(`${checks.length} workspace continuity checks passed.`);
} finally {
  await db.$disconnect();
}
