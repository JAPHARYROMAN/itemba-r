import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';

// This proof deliberately refuses the working or production database.
const root = process.cwd();
const require = createRequire(resolve(root, 'backend/package.json'));
const { PrismaClient } = require('@prisma/client');
const argon2 = require('argon2');
const mammoth = require('mammoth');
const ExcelJS = require('exceljs');
const env = Object.fromEntries(readFileSync('.release/rehearsal.env', 'utf8').trim().split(/\r?\n/).map(line => [line.slice(0, line.indexOf('=')), line.slice(line.indexOf('=') + 1)]));
const url = new URL(env.DATABASE_URL);
assert.equal(url.hostname, '127.0.0.1'); assert.equal(url.port, '5549'); assert.equal(url.pathname, '/itemba_release_proof');
const db = new PrismaClient({ datasources: { db: { url: env.DATABASE_URL } } });
const fixture = JSON.parse(readFileSync('.release/browser-fixture.json', 'utf8'));
const base = 'http://127.0.0.1:3114/api/v1';
const output = resolve('.release/document-proof'); mkdirSync(output, { recursive: true });
const results = [];
async function request(token, method, path, body, status = 200) {
  const response = await fetch(base + path, { method, headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(body && !(body instanceof FormData) ? { 'Content-Type': 'application/json' } : {}) }, ...(body ? { body: body instanceof FormData ? body : JSON.stringify(body) } : {}) });
  assert.equal(response.status, status, `${method} ${path}: ${response.status === status ? '' : await response.text()}`);
  return response;
}
async function json(response) { const value = await response.json(); return value.data ?? value; }
async function check(name, action) { await action(); results.push({ name, status: 'passed' }); console.log(`PASS ${name}`); }
try {
  for (let attempt = 0; ; attempt++) {
    try { await request(null, 'GET', '/health'); break; }
    catch (error) { if (attempt >= 19) throw error; await new Promise(resolve => setTimeout(resolve, 1000)); }
  }
  const stamp = Date.now().toString(36);
  async function actor(suffix, codes) {
    for (const code of codes) await db.permission.upsert({ where: { code }, update: {}, create: { code, description: 'Document proof', module: code.split('.')[0], action: code.split('.')[1] } });
    const role = await db.role.create({ data: { name: `docs-${suffix}-${stamp}`, displayName: 'Document proof', scope: 'COMPANY', rolePermissions: { create: codes.map(code => ({ permission: { connect: { code } } })) } } });
    const user = await db.user.create({ data: { fullName: `Document proof ${suffix}`, email: `docs-${suffix}-${stamp}@example.invalid`, passwordHash: await argon2.hash(env.RELEASE_PROOF_USER_PASSWORD), status: 'ACTIVE', companyId: fixture.companyId, userRoles: { create: { roleId: role.id } }, companyAccess: { create: { companyId: fixture.companyId, accessLevel: 'MANAGE' } } } });
    const login = await json(await request(null, 'POST', '/auth/login', { email: user.email, password: env.RELEASE_PROOF_USER_PASSWORD }, 200));
    return { email: user.email, token: login.accessToken };
  }
  const manager = await actor('manager', ['documents.view', 'documents.manage']);
  const reader = await actor('reader', ['documents.view']);
  const other = await db.company.findFirst({ where: { id: { not: fixture.companyId }, deletedAt: null }, select: { id: true } });
  const company = await db.company.findUnique({ where: { id: fixture.companyId }, include: { profile: true } });
  await check('Company letterhead uses registered legal identity', async () => {
    const org = await json(await request(manager.token, 'GET', `/generated-documents/letterhead?companyId=${fixture.companyId}`));
    assert.equal(org.name, company.profile.registeredName); assert.equal(org.tin, company.profile.tin); assert.equal(org.vrn, null);
  });
  await check('Company picker only lists accessible companies', async () => {
    const options = await json(await request(manager.token, 'GET', '/generated-documents/letterhead-companies'));
    assert.deepEqual(options.map(row => row.id), [fixture.companyId]);
  });
  const letter = { companyId: fixture.companyId, title: 'Payment confirmation', reference: 'DOC-PROOF-001', recipient: 'Example Supplier Ltd\nAccounts department', body: 'Dear Accounts Team,\n\nPlease find confirmation of the agreed payment of TZS 125,000.50.\n\nThis is a synthetic verification document, not a real payment instruction.\n\nThank you for your cooperation.', signatory: 'Finance Manager' };
  const files = [];
  for (const format of ['pdf', 'docx', 'txt']) await check(`Branded letter exports as ${format}`, async () => {
    const response = await request(manager.token, 'POST', '/generated-documents/letter', { ...letter, format }, 201);
    const buffer = Buffer.from(await response.arrayBuffer());
    assert.ok(response.headers.get('content-disposition').includes(`.${format}`));
    if (format === 'pdf') assert.equal(buffer.subarray(0, 5).toString(), '%PDF-');
    if (format === 'docx') assert.ok((await mammoth.extractRawText({ buffer })).value.includes('125,000.50'));
    if (format === 'txt') assert.ok(buffer.toString().includes(company.profile.registeredName));
    writeFileSync(resolve(output, `letter.${format}`), buffer);
    files.push({ fileName: `letter.${format}`, buffer, mime: response.headers.get('content-type').split(';')[0], kind: format === 'pdf' ? 'pdf' : 'text' });
  });
  for (const format of ['xlsx', 'csv', 'docx', 'pdf']) await check(`Report exports as ${format} without losing values`, async () => {
    const response = await request(manager.token, 'POST', '/generated-documents/table-export', { companyId: fixture.companyId, title: 'Supplier balances', columns: ['Supplier', 'Outstanding'], rows: [['Example supplier', '125000.50'], ['=HYPERLINK("unsafe")', '12.25']], numericColumns: [1], format }, 201);
    const buffer = Buffer.from(await response.arrayBuffer());
    if (format === 'xlsx') {
      const book = new ExcelJS.Workbook(); await book.xlsx.load(buffer);
      let found = false; book.worksheets[0].eachRow(row => { if (row.getCell(1).value === 'Example supplier') { assert.equal(row.getCell(2).value, 125000.5); found = true; } }); assert.ok(found);
    }
    if (format === 'csv') assert.ok(buffer.toString().includes("'=HYPERLINK"));
    writeFileSync(resolve(output, `report.${format}`), buffer);
    if (['xlsx', 'csv'].includes(format)) files.push({ fileName: `report.${format}`, buffer, mime: response.headers.get('content-type').split(';')[0], kind: 'table' });
  });
  const image = readFileSync('frontend/public/brand/itemba-group-logo.png');
  files.push({ fileName: 'logo.png', buffer: image, mime: 'image/png', kind: 'image' });
  const uploaded = [];
  for (const file of files) await check(`Upload, preview and original download agree: ${file.fileName}`, async () => {
    const form = new FormData();
    form.set('file', new Blob([file.buffer], { type: file.mime }), file.fileName);
    form.set('title', `Document proof ${file.fileName}`); form.set('ownerType', 'COMPANY'); form.set('ownerId', fixture.companyId); form.set('companyId', fixture.companyId); form.set('isConfidential', 'false');
    const saved = await json(await request(manager.token, 'POST', '/documents/upload', form, 201));
    assert.equal(saved.isConfidential, false, 'Unchecked confidential flag stays false');
    const preview = await json(await request(manager.token, 'GET', `/documents/${saved.id}/preview`));
    assert.equal(preview.kind, file.kind);
    const original = Buffer.from(await (await request(manager.token, 'GET', `/documents/${saved.id}/download`)).arrayBuffer());
    assert.ok(original.equals(file.buffer)); uploaded.push({ id: saved.id, fileName: file.fileName });
  });
  await check('Read-only users cannot generate correspondence', async () => { await request(reader.token, 'POST', '/generated-documents/letter', { ...letter, format: 'docx' }, 403); });
  await check('Existing payslip exports use the same editable document path', async () => {
    const entry = await db.payrollEntry.findFirst({ where: { payrollRunId: fixture.payrollRunId } });
    assert.ok(entry);
    const response = await request(manager.token, 'POST', '/generated-documents/export', { entityType: 'PAYSLIP', entityId: entry.id, format: 'docx' }, 201);
    const text = (await mammoth.extractRawText({ buffer: Buffer.from(await response.arrayBuffer()) })).value;
    assert.ok(text.includes('Synthetic Employee'));
    await request(reader.token, 'POST', '/generated-documents/export', { entityType: 'PAYSLIP', entityId: entry.id, format: 'docx' }, 403);
  });
  await check('A document in another company cannot be previewed', async () => {
    const original = await db.document.findUnique({ where: { id: uploaded[0].id } });
    const foreign = await db.document.create({ data: { title: 'Foreign document proof', ownerType: 'COMPANY', ownerId: other.id, companyId: other.id, storageKey: `unread-foreign-${stamp}.pdf`, fileName: original.fileName, mimeType: original.mimeType, uploadedById: original.uploadedById } });
    await request(manager.token, 'GET', `/documents/${foreign.id}/preview`, undefined, 403);
  });
  await check('Cross-company letterhead and letter exports are denied', async () => {
    await request(manager.token, 'GET', `/generated-documents/letterhead?companyId=${other.id}`, undefined, 403);
    await request(manager.token, 'POST', '/generated-documents/letter', { ...letter, companyId: other.id, format: 'docx' }, 403);
  });
  await check('Unknown export formats and oversized tables are rejected', async () => {
    await request(manager.token, 'POST', '/generated-documents/letter', { ...letter, format: 'exe' }, 400);
    await request(manager.token, 'POST', '/generated-documents/table-export', { title: 'Too many rows', columns: ['Value'], rows: Array.from({ length: 5001 }, () => ['1']), format: 'xlsx' }, 400);
  });
  writeFileSync(resolve(output, 'browser-fixture.json'), JSON.stringify({ email: manager.email, companyId: fixture.companyId, uploaded }, null, 2));
  writeFileSync(resolve(output, 'results.json'), JSON.stringify({ at: new Date().toISOString(), checks: results }, null, 2));
  console.log(`${results.length} document workflow checks passed. Synthetic artifacts saved under .release/document-proof.`);
} finally { await db.$disconnect(); }
