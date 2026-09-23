import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';

const root = process.cwd();
const require = createRequire(resolve(root, 'backend/package.json'));
const { PrismaClient } = require('@prisma/client');
const env = Object.fromEntries(readFileSync(resolve(root, '.release/rehearsal.env'), 'utf8').trim().split(/\r?\n/).map((line) => [line.slice(0, line.indexOf('=')), line.slice(line.indexOf('=') + 1)]));
const url = new URL(env.DATABASE_URL);
assert.equal(url.hostname, '127.0.0.1');
assert.equal(url.port, '5549');
assert.equal(url.pathname, '/itemba_release_proof');
const fixture = JSON.parse(readFileSync(resolve(root, '.release/browser-fixture.json'), 'utf8'));
assert.match(fixture.email, /^finance-.*@example\.invalid$/);
const db = new PrismaClient({ datasources: { db: { url: env.DATABASE_URL } } });
try {
  const source = await db.user.findUniqueOrThrow({ where: { email: fixture.email }, include: { userRoles: true } });
  const email = `os-review-${source.id}@example.invalid`;
  const codes = ['notifications.view', 'documents.view', 'documents.manage', 'inventory.view', 'fuel_grid.access'];
  for (const code of codes) await db.permission.upsert({ where: { code }, update: {}, create: { code, description: 'Isolated OS design proof', module: code.split('.')[0], action: code.split('.').slice(1).join('.') } });
  const role = await db.role.upsert({ where: { name: 'os-design-proof' }, update: {}, create: { name: 'os-design-proof', displayName: 'OS design proof', scope: 'COMPANY', rolePermissions: { create: codes.map((code) => ({ permission: { connect: { code } } })) } } });
  const reviewer = await db.user.upsert({ where: { email }, update: {}, create: {
    email, fullName: 'Workspace reviewer', passwordHash: source.passwordHash, companyId: source.companyId,
    userRoles: { create: [...source.userRoles.map(({ roleId }) => ({ roleId })), { roleId: role.id }] },
    companyAccess: { create: { companyId: source.companyId, accessLevel: 'MANAGE' } },
  } });
  await db.notification.upsert({ where: { notificationNumber: `OS-REVIEW-${reviewer.id}` }, update: {}, create: {
    notificationNumber: `OS-REVIEW-${reviewer.id}`, recipientUserId: reviewer.id, companyId: source.companyId,
    title: 'Purchase ready for review', message: 'Synthetic verification: open Invoice Desk to review the purchase and its supplier balance.',
    actionUrl: '/invoice-desk', priority: 'NORMAL',
  } });
  mkdirSync(resolve(root, '.release/os-design'), { recursive: true });
  writeFileSync(resolve(root, '.release/os-design/browser-fixture.json'), JSON.stringify({ email, companyId: source.companyId }, null, 2));
  console.log('Prepared the synthetic OS reviewer and inbox on the isolated rehearsal database.');
} finally { await db.$disconnect(); }
