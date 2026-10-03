/**
 * Contract of POST /api/enquiries and GET /api/health, exercised by calling
 * the frozen route handlers directly (no server). Every environment variable
 * the route reads is cleared before each test, storage goes to a fresh temp
 * directory, and global fetch is stubbed so no test can reach Resend.
 *
 * The route files are frozen byte-for-byte (tests/frozen-files.json); what
 * this suite guards is the behaviour they get from their imports, chiefly the
 * `@/lib/site` barrel (`contact`, `enquiryIntents`) that the content split
 * rewrites.
 */
import { randomUUID } from 'node:crypto';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { NextRequest } from 'next/server';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import * as enquiriesRoute from '@/app/api/enquiries/route';
import * as healthRoute from '@/app/api/health/route';
import { contact, enquiryIntents } from '@/lib/site';

const { POST } = enquiriesRoute;

const ENV_KEYS = ['RESEND_API_KEY', 'ENQUIRY_EMAIL_TO', 'ENQUIRY_EMAIL_FROM', 'ENQUIRY_STORAGE_DIR', 'VERCEL'] as const;
const RESEND_URL = 'https://api.resend.com/emails';
const DEFAULT_FROM = 'Itemba Group Website <onboarding@resend.dev>';
const GROUP_INBOX = 'info@itembagrouptz.com';
// Placeholder, never sent anywhere: fetch is stubbed in every test.
const TEST_KEY = 're_unit_test_placeholder';
const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

const ERR_INVALID_JSON = 'Invalid JSON payload.';
const ERR_INVALID_PAYLOAD = 'Invalid enquiry payload.';
const ERR_REQUIRED = 'Preferred contact and message are required.';
const ERR_UNSAVED =
  'The enquiry could not be safely saved or emailed. Please use WhatsApp, email, or phone for this enquiry.';

type LeadRecord = {
  id: string;
  createdAt: string;
  intentId: string;
  intentLabel: string;
  routeTo: string;
  subject: string;
  name: string;
  organization: string;
  contactMethod: string;
  message: string;
  sourcePath: string;
  tags: string[];
  emailStatus: string;
  userAgent: string;
};

type EnquiryResponse = {
  ok: boolean;
  id?: string | null;
  error?: string;
  emailStatus?: string;
  storageStatus?: string;
};

type ResendBody = { from: string; to: string[]; subject: string; text: string; reply_to?: string };

let tmpRoot: string;
let storageDir: string;
let savedEnv: Record<string, string | undefined>;
let fetchMock: Mock<typeof fetch>;

beforeAll(() => {
  tmpRoot = mkdtempSync(path.join(os.tmpdir(), 'itemba-enquiries-'));
});

afterAll(() => {
  rmSync(tmpRoot, { recursive: true, force: true });
});

beforeEach(() => {
  savedEnv = Object.fromEntries(ENV_KEYS.map((key) => [key, process.env[key]]));
  for (const key of ENV_KEYS) delete process.env[key];
  storageDir = path.join(tmpRoot, randomUUID());
  process.env.ENQUIRY_STORAGE_DIR = storageDir;
  fetchMock = vi.fn<typeof fetch>(async () => {
    throw new Error('Unexpected network call; stub fetch in the test that needs it');
  });
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  for (const key of ENV_KEYS) {
    const value = savedEnv[key];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

// --- helpers ---------------------------------------------------------------

const validEnquiry = (overrides: Record<string, unknown> = {}) => ({
  intentId: 'mwanjalisi',
  name: 'Asha Mwakyusa',
  organization: 'Songwe Haulage Ltd',
  contactMethod: 'asha@example.co.tz',
  message: 'We need 20,000 litres of diesel a month for our trucks.',
  sourcePath: '/services/fuel-and-lubricants',
  website: '',
  ...overrides,
});

type RequestOptions = { raw?: string; userAgent?: string | null };

function enquiryRequest(body: unknown, { raw, userAgent = 'vitest-contract' }: RequestOptions = {}) {
  const headers = new Headers({ 'content-type': 'application/json' });
  if (userAgent !== null) headers.set('user-agent', userAgent);
  return new NextRequest('http://localhost:3001/api/enquiries', {
    method: 'POST',
    headers,
    body: raw ?? JSON.stringify(body),
  });
}

async function send(body: unknown, options?: RequestOptions) {
  const res = await POST(enquiryRequest(body, options));
  return { status: res.status, headers: res.headers, json: (await res.json()) as EnquiryResponse };
}

function logFile(dir = storageDir) {
  return path.join(dir, 'enquiries.jsonl');
}

function storedLeads(dir = storageDir): LeadRecord[] {
  if (!existsSync(logFile(dir))) return [];
  return readFileSync(logFile(dir), 'utf8')
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line) as LeadRecord);
}

function onlyLead(dir = storageDir): LeadRecord {
  const leads = storedLeads(dir);
  expect(leads).toHaveLength(1);
  return leads[0]!;
}

function intent(id: string) {
  const match = enquiryIntents.find((entry) => entry.id === id);
  if (!match) throw new Error(`No enquiry intent "${id}"`);
  return match;
}

function resendCall(index = 0): { url: string; init: RequestInit; body: ResendBody } {
  const call = fetchMock.mock.calls[index];
  if (!call) throw new Error(`fetch call #${index} was not made`);
  const [url, init] = call;
  return { url: String(url), init: init!, body: JSON.parse(String(init!.body)) as ResendBody };
}

const resendAccepts = () => fetchMock.mockImplementation(async () => new Response('{"id":"email_1"}', { status: 200 }));

/** A storage directory that cannot be created: one of its parents is a file. */
function storageUnderAFile() {
  const file = path.join(tmpRoot, `${randomUUID()}.txt`);
  writeFileSync(file, 'not a directory');
  return path.join(file, 'enquiries');
}

/** A storage directory whose log path is taken by a directory. */
function storageWithBlockedLog() {
  const dir = path.join(tmpRoot, randomUUID());
  mkdirSync(logFile(dir), { recursive: true });
  return dir;
}

/** A read-only directory (POSIX only; root ignores permission bits). */
function readOnlyStorage() {
  const dir = path.join(tmpRoot, randomUUID());
  mkdirSync(dir);
  chmodSync(dir, 0o500);
  return dir;
}

const canUsePermissionBits = process.platform !== 'win32' && process.getuid?.() !== 0;

const UNWRITABLE_STORAGE: [string, () => string][] = [
  ['a parent path is a file', storageUnderAFile],
  ['the log path is a directory', storageWithBlockedLog],
  ...(canUsePermissionBits ? ([['the directory is read-only', readOnlyStorage]] as [string, () => string][]) : []),
];

// --- POST /api/enquiries -----------------------------------------------------

describe('POST /api/enquiries: surface', () => {
  it('exports only POST on the Node.js runtime, so other methods get 405', () => {
    expect(Object.keys(enquiriesRoute).sort()).toEqual(['POST', 'runtime']);
    expect(enquiriesRoute.runtime).toBe('nodejs');
  });

  it('routes to the four intents, with general first as the fallback', () => {
    expect(enquiryIntents.map(({ id, subject, routeTo }) => ({ id, subject, routeTo }))).toEqual([
      { id: 'general', subject: 'General business enquiry', routeTo: 'Itemba Group office' },
      { id: 'mwanjalisi', subject: 'Mwanjalisi Oil fuel supply enquiry', routeTo: 'Mwanjalisi Oil Co Ltd' },
      { id: 'westsides', subject: 'Westsides Company trade supply enquiry', routeTo: 'Westsides Company Ltd' },
      { id: 'enterprises', subject: 'Itemba Enterprises operations enquiry', routeTo: 'Itemba Enterprises Co Ltd' },
    ]);
    for (const entry of enquiryIntents) expect(entry.label.trim()).not.toBe('');
  });

  it('falls back to the group inbox for email', () => {
    expect(contact.email).toBe(GROUP_INBOX);
  });
});

describe('POST /api/enquiries: 400 responses', () => {
  it.each(['', 'not json', '{"intentId":', "{'message':'single quotes'}"])('invalid JSON %j', async (raw) => {
    const { status, json, headers } = await send(undefined, { raw });
    expect(status).toBe(400);
    expect(json).toEqual({ ok: false, error: ERR_INVALID_JSON });
    expect(headers.get('content-type')).toContain('application/json');
  });

  it.each(['null', 'false', '0', '42', 'true', '"a string"'])('non-object payload %s', async (raw) => {
    const { status, json } = await send(undefined, { raw });
    expect(status).toBe(400);
    expect(json).toEqual({ ok: false, error: ERR_INVALID_PAYLOAD });
  });

  it.each<[string, Record<string, unknown>]>([
    ['contactMethod missing', { contactMethod: undefined }],
    ['message missing', { message: undefined }],
    ['both missing', { contactMethod: undefined, message: undefined }],
    ['contactMethod blank', { contactMethod: '   ' }],
    ['message blank', { message: '\n\t  ' }],
    ['message only control characters', { message: '\u0000\u0007\u001f\u007f' }],
    ['contactMethod not a string', { contactMethod: 255700000000 }],
    ['message not a string', { message: ['hello'] }],
  ])('%s', async (_case, overrides) => {
    const { status, json } = await send(validEnquiry(overrides));
    expect(status).toBe(400);
    expect(json).toEqual({ ok: false, error: ERR_REQUIRED });
  });

  it('treats an array body as an object with no fields', async () => {
    const { status, json } = await send([]);
    expect(status).toBe(400);
    expect(json).toEqual({ ok: false, error: ERR_REQUIRED });
  });

  it('never emails or stores a rejected enquiry', async () => {
    process.env.RESEND_API_KEY = TEST_KEY;
    resendAccepts();
    await send(undefined, { raw: 'not json' });
    await send(undefined, { raw: 'null' });
    await send(validEnquiry({ message: '' }));
    expect(fetchMock).not.toHaveBeenCalled();
    expect(existsSync(storageDir)).toBe(false);
  });
});

describe('POST /api/enquiries: honeypot', () => {
  const SILENT = { ok: true, id: null, emailStatus: 'not_configured', storageStatus: 'skipped_ephemeral' };

  it('answers a filled honeypot with a silent 200 and does nothing', async () => {
    process.env.RESEND_API_KEY = TEST_KEY;
    resendAccepts();
    const { status, json } = await send(validEnquiry({ website: 'https://spam.example' }));
    expect(status).toBe(200);
    expect(json).toEqual(SILENT);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(existsSync(storageDir)).toBe(false);
  });

  it('checks the honeypot before validating the other fields', async () => {
    for (const body of [{ website: 'bot' }, validEnquiry({ website: 'bot', message: '' }), validEnquiry({ website: 'x'.repeat(500) })]) {
      const { status, json } = await send(body);
      expect(status).toBe(200);
      expect(json).toEqual(SILENT);
    }
    expect(existsSync(storageDir)).toBe(false);
  });

  it.each<[string, unknown]>([
    ['blank', '   '],
    ['control characters only', '\u0000\u001f'],
    ['a number', 42],
    ['null', null],
    ['absent', undefined],
  ])('a %s honeypot is not a bot signal', async (_case, website) => {
    const { status, json } = await send(validEnquiry({ website }));
    expect(status).toBe(200);
    expect(json).toMatchObject({ ok: true, storageStatus: 'stored' });
    expect(json.id).toMatch(UUID_V4);
    onlyLead();
  });
});

describe('POST /api/enquiries: lead record and storage', () => {
  it('stores the complete lead and returns its id', async () => {
    const before = Date.now();
    const { status, json, headers } = await send(validEnquiry());
    const after = Date.now();

    expect(status).toBe(200);
    expect(headers.get('content-type')).toContain('application/json');
    const lead = onlyLead();
    expect(json).toEqual({ ok: true, id: lead.id, emailStatus: 'not_configured', storageStatus: 'stored' });
    expect(lead).toEqual({
      id: expect.stringMatching(UUID_V4),
      createdAt: expect.any(String),
      intentId: 'mwanjalisi',
      intentLabel: intent('mwanjalisi').label,
      routeTo: 'Mwanjalisi Oil Co Ltd',
      subject: 'Mwanjalisi Oil fuel supply enquiry',
      name: 'Asha Mwakyusa',
      organization: 'Songwe Haulage Ltd',
      contactMethod: 'asha@example.co.tz',
      message: 'We need 20,000 litres of diesel a month for our trucks.',
      sourcePath: '/services/fuel-and-lubricants',
      tags: ['website-lead', 'intent:mwanjalisi', 'sector:fuel', 'source:service-page'],
      emailStatus: 'not_configured',
      userAgent: 'vitest-contract',
    });
    expect(new Date(lead.createdAt).toISOString()).toBe(lead.createdAt);
    expect(Date.parse(lead.createdAt)).toBeGreaterThanOrEqual(before);
    expect(Date.parse(lead.createdAt)).toBeLessThanOrEqual(after);
  });

  it('appends one newline-terminated JSON line per enquiry', async () => {
    const first = await send(validEnquiry());
    const second = await send(validEnquiry({ intentId: 'westsides' }));
    const raw = readFileSync(logFile(), 'utf8');
    expect(raw.endsWith('\n')).toBe(true);
    expect(raw.split('\n')).toHaveLength(3);
    const leads = storedLeads();
    expect(leads.map((lead) => lead.id)).toEqual([first.json.id, second.json.id]);
    expect(first.json.id).not.toBe(second.json.id);
  });

  it('creates missing storage directories', async () => {
    const nested = path.join(storageDir, 'a', 'b');
    process.env.ENQUIRY_STORAGE_DIR = nested;
    const { json } = await send(validEnquiry());
    expect(json.storageStatus).toBe('stored');
    onlyLead(nested);
  });

  it('trims ENQUIRY_STORAGE_DIR', async () => {
    process.env.ENQUIRY_STORAGE_DIR = `  ${storageDir}  `;
    await send(validEnquiry());
    onlyLead();
  });

  it.each<[string, string | undefined]>([
    ['unset', undefined],
    ['blank', '   '],
  ])('defaults to <cwd>/data when ENQUIRY_STORAGE_DIR is %s', async (_case, value) => {
    const cwd = path.join(tmpRoot, randomUUID());
    vi.spyOn(process, 'cwd').mockReturnValue(cwd);
    if (value === undefined) delete process.env.ENQUIRY_STORAGE_DIR;
    else process.env.ENQUIRY_STORAGE_DIR = value;
    const { json } = await send(validEnquiry());
    expect(json.storageStatus).toBe('stored');
    onlyLead(path.join(cwd, 'data'));
  });
});

describe('POST /api/enquiries: intent resolution', () => {
  it.each<[unknown, string]>([
    [undefined, 'general'],
    ['', 'general'],
    ['   ', 'general'],
    ['unknown', 'general'],
    ['WESTSIDES', 'general'],
    [42, 'general'],
    ['general', 'general'],
    ['mwanjalisi', 'mwanjalisi'],
    ['  westsides  ', 'westsides'],
    ['enterprises', 'enterprises'],
  ])('intentId %j resolves to %s', async (intentId, expected) => {
    await send(validEnquiry({ intentId }));
    const lead = onlyLead();
    const { id, label, routeTo, subject } = intent(expected);
    expect(lead).toMatchObject({ intentId: id, intentLabel: label, routeTo, subject });
    expect(lead.tags).toContain(`intent:${id}`);
  });
});

describe('POST /api/enquiries: cleaning and length caps', () => {
  it.each<[string, number]>([
    ['name', 140],
    ['organization', 180],
    ['contactMethod', 220],
    ['message', 2000],
    ['sourcePath', 240],
  ])('%s is trimmed, then capped at %i characters', async (field, cap) => {
    await send(validEnquiry({ [field]: `  ${'a'.repeat(cap + 25)}  ` }));
    expect(onlyLead()[field as keyof LeadRecord]).toBe('a'.repeat(cap));
  });

  it.each<[string, number]>([
    ['name', 140],
    ['organization', 180],
    ['contactMethod', 220],
    ['message', 2000],
    ['sourcePath', 240],
  ])('%s keeps a value of exactly %i characters', async (field, cap) => {
    await send(validEnquiry({ [field]: 'b'.repeat(cap) }));
    expect(onlyLead()[field as keyof LeadRecord]).toBe('b'.repeat(cap));
  });

  it('caps the user agent at 300 characters and records a missing one as empty', async () => {
    await send(validEnquiry(), { userAgent: 'u'.repeat(400) });
    await send(validEnquiry(), { userAgent: null });
    expect(storedLeads().map((lead) => lead.userAgent)).toEqual(['u'.repeat(300), '']);
  });

  it('replaces control characters (including newlines) with spaces', async () => {
    await send(validEnquiry({ message: '\u0000Line one\nLine two\r\n\tIndented\u007f', name: 'Asha\u0008 M' }));
    const lead = onlyLead();
    expect(lead.message).toBe('Line one Line two   Indented');
    expect(lead.name).toBe('Asha  M');
  });

  it('records optional fields that are missing or not strings as empty', async () => {
    await send(validEnquiry({ name: undefined, organization: { nested: true } }));
    expect(onlyLead()).toMatchObject({ name: '', organization: '' });
  });

  it.each<[string, unknown]>([
    ['missing', undefined],
    ['blank', '  '],
    ['not a string', 7],
  ])('a %s sourcePath is recorded as /', async (_case, sourcePath) => {
    await send(validEnquiry({ sourcePath }));
    expect(onlyLead().sourcePath).toBe('/');
  });
});

describe('POST /api/enquiries: routing tags', () => {
  it.each<[string, string, string[]]>([
    ['general', '/', []],
    ['general', '/contact', ['source:contact']],
    ['general', '/faq', ['source:faq']],
    ['general', '/partnerships', ['source:partnerships']],
    ['general', '/capabilities', ['source:capabilities']],
    ['general', '/insights/tunduma-corridor-fuel-trade-logistics', ['source:insight-page']],
    ['general', '/insights', []],
    ['general', '/contact/', []],
    ['general', '/company-profile', []],
    ['mwanjalisi', '/services/fuel-and-lubricants', ['sector:fuel', 'source:service-page']],
    ['mwanjalisi', '/companies/mwanjalisi-oil', ['sector:fuel', 'source:company-page']],
    ['westsides', '/companies/westsides-company', ['sector:trade', 'source:company-page']],
    ['westsides', '/services/trade-and-distribution', ['sector:trade', 'source:service-page']],
    ['enterprises', '/locations/songwe-tunduma', ['sector:operations', 'source:location-page']],
    ['enterprises', '/services', ['sector:operations']],
    ['not-an-intent', '/services/logistics-and-cross-border-transit', ['source:service-page']],
  ])('%s from %s', async (intentId, sourcePath, extraTags) => {
    await send(validEnquiry({ intentId, sourcePath }));
    const resolved = intentId === 'not-an-intent' ? 'general' : intentId;
    expect(onlyLead().tags).toEqual(['website-lead', `intent:${resolved}`, ...extraTags]);
  });
});

describe('POST /api/enquiries: Resend email', () => {
  it('is not attempted without RESEND_API_KEY', async () => {
    const { json } = await send(validEnquiry());
    expect(fetchMock).not.toHaveBeenCalled();
    expect(json.emailStatus).toBe('not_configured');
  });

  it('is not attempted with a blank RESEND_API_KEY', async () => {
    process.env.RESEND_API_KEY = '   ';
    const { json } = await send(validEnquiry());
    expect(fetchMock).not.toHaveBeenCalled();
    expect(json.emailStatus).toBe('not_configured');
  });

  it('posts the lead to Resend with the documented payload', async () => {
    process.env.RESEND_API_KEY = TEST_KEY;
    resendAccepts();
    const { status, json } = await send(validEnquiry());

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const { url, init, body } = resendCall();
    expect(url).toBe(RESEND_URL);
    expect(init.method).toBe('POST');
    expect(init.headers).toEqual({ Authorization: `Bearer ${TEST_KEY}`, 'Content-Type': 'application/json' });
    expect(init.signal).toBeInstanceOf(AbortSignal);
    expect(init.signal!.aborted).toBe(false);

    const lead = onlyLead();
    expect(Object.keys(body)).toEqual(['from', 'to', 'subject', 'text', 'reply_to']);
    expect(body).toEqual({
      from: DEFAULT_FROM,
      to: [GROUP_INBOX],
      subject: 'Website enquiry: Mwanjalisi Oil fuel supply enquiry',
      text: [
        `New website enquiry: ${intent('mwanjalisi').label}`,
        '',
        `Lead ID: ${lead.id}`,
        `Created: ${lead.createdAt}`,
        'Route to: Mwanjalisi Oil Co Ltd',
        'Source page: /services/fuel-and-lubricants',
        'Tags: website-lead, intent:mwanjalisi, sector:fuel, source:service-page',
        '',
        'Name: Asha Mwakyusa',
        'Organisation: Songwe Haulage Ltd',
        'Preferred contact: asha@example.co.tz',
        '',
        'Message:',
        'We need 20,000 litres of diesel a month for our trucks.',
      ].join('\n'),
      reply_to: 'asha@example.co.tz',
    });

    expect(status).toBe(200);
    expect(json).toEqual({ ok: true, id: lead.id, emailStatus: 'sent', storageStatus: 'stored' });
    expect(lead.emailStatus).toBe('sent');
  });

  it('writes "Not provided" for a missing name and organisation', async () => {
    process.env.RESEND_API_KEY = TEST_KEY;
    resendAccepts();
    await send(validEnquiry({ intentId: 'general', name: '', organization: undefined, sourcePath: undefined }));
    const { body } = resendCall();
    const lead = onlyLead();
    expect(body.subject).toBe('Website enquiry: General business enquiry');
    expect(body.text).toBe(
      [
        `New website enquiry: ${intent('general').label}`,
        '',
        `Lead ID: ${lead.id}`,
        `Created: ${lead.createdAt}`,
        'Route to: Itemba Group office',
        'Source page: /',
        'Tags: website-lead, intent:general',
        '',
        'Name: Not provided',
        'Organisation: Not provided',
        'Preferred contact: asha@example.co.tz',
        '',
        'Message:',
        'We need 20,000 litres of diesel a month for our trucks.',
      ].join('\n'),
    );
  });

  it('trims the API key', async () => {
    process.env.RESEND_API_KEY = `  ${TEST_KEY}  `;
    resendAccepts();
    await send(validEnquiry());
    expect(resendCall().init.headers).toMatchObject({ Authorization: `Bearer ${TEST_KEY}` });
  });

  it.each<[string, string[]]>([
    [' ops@example.com, ,sales@example.com ,', ['ops@example.com', 'sales@example.com']],
    ['single@example.com', ['single@example.com']],
    [' , ', [GROUP_INBOX]],
    ['', [GROUP_INBOX]],
  ])('ENQUIRY_EMAIL_TO %j sends to %j', async (value, to) => {
    process.env.RESEND_API_KEY = TEST_KEY;
    process.env.ENQUIRY_EMAIL_TO = value;
    resendAccepts();
    await send(validEnquiry());
    expect(resendCall().body.to).toEqual(to);
  });

  it('uses ENQUIRY_EMAIL_FROM as the sender', async () => {
    process.env.RESEND_API_KEY = TEST_KEY;
    process.env.ENQUIRY_EMAIL_FROM = 'Itemba Leads <leads@example.com>';
    resendAccepts();
    await send(validEnquiry());
    expect(resendCall().body.from).toBe('Itemba Leads <leads@example.com>');
  });

  it.each<[string, string | undefined]>([
    ['asha@example.co.tz', 'asha@example.co.tz'],
    ['Call +255 700 000 000 or email Jane.Doe+sales@Example.CO.TZ after 5pm', 'Jane.Doe+sales@Example.CO.TZ'],
    ['first@example.com or second@example.com', 'first@example.com'],
    ['+255 700 000 000', undefined],
    ['WhatsApp me', undefined],
  ])('contact %j gives reply_to %j', async (contactMethod, replyTo) => {
    process.env.RESEND_API_KEY = TEST_KEY;
    resendAccepts();
    await send(validEnquiry({ contactMethod }));
    const { body } = resendCall();
    if (replyTo === undefined) expect('reply_to' in body).toBe(false);
    else expect(body.reply_to).toBe(replyTo);
  });

  it.each([400, 422, 500, 503])('a %i from Resend counts as failed; the stored lead still succeeds', async (code) => {
    process.env.RESEND_API_KEY = TEST_KEY;
    fetchMock.mockImplementation(async () => new Response('{"message":"nope"}', { status: code }));
    const { status, json } = await send(validEnquiry());
    const lead = onlyLead();
    expect(status).toBe(200);
    expect(json).toEqual({ ok: true, id: lead.id, emailStatus: 'failed', storageStatus: 'stored' });
    expect(lead.emailStatus).toBe('failed');
  });

  it('a network error counts as failed', async () => {
    process.env.RESEND_API_KEY = TEST_KEY;
    fetchMock.mockImplementation(async () => {
      throw new TypeError('fetch failed');
    });
    const { json } = await send(validEnquiry());
    expect(json).toMatchObject({ ok: true, emailStatus: 'failed', storageStatus: 'stored' });
  });

  it('aborts the Resend request after 8 seconds', async () => {
    process.env.RESEND_API_KEY = TEST_KEY;
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    let signal: AbortSignal | undefined;
    let fetchStarted!: () => void;
    const started = new Promise<void>((resolve) => {
      fetchStarted = resolve;
    });
    fetchMock.mockImplementation((_url, init) => {
      signal = init!.signal!;
      fetchStarted();
      return new Promise<Response>((_resolve, reject) => {
        signal!.addEventListener('abort', () => reject(signal!.reason), { once: true });
      });
    });

    const pending = POST(enquiryRequest(validEnquiry()));
    await started;
    expect(signal!.aborted).toBe(false);
    await vi.advanceTimersByTimeAsync(7_999);
    expect(signal!.aborted).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(signal!.aborted).toBe(true);

    const res = await pending;
    const lead = onlyLead();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, id: lead.id, emailStatus: 'failed', storageStatus: 'stored' });
    expect(lead.emailStatus).toBe('failed');
  });

  it('clears the abort timer once Resend answers', async () => {
    process.env.RESEND_API_KEY = TEST_KEY;
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    resendAccepts();
    const { json } = await send(validEnquiry());
    expect(json.emailStatus).toBe('sent');
    expect(vi.getTimerCount()).toBe(0);
  });
});

describe('POST /api/enquiries: storage outcomes and 503', () => {
  it('skips file storage on Vercel and returns 503 when email is not configured', async () => {
    process.env.VERCEL = '1';
    const { status, json } = await send(validEnquiry());
    expect(status).toBe(503);
    expect(json).toEqual({
      ok: false,
      error: ERR_UNSAVED,
      emailStatus: 'not_configured',
      storageStatus: 'skipped_ephemeral',
    });
    expect(existsSync(storageDir)).toBe(false);
  });

  it('on Vercel, a sent email alone is a success', async () => {
    process.env.VERCEL = '1';
    process.env.RESEND_API_KEY = TEST_KEY;
    resendAccepts();
    const { status, json } = await send(validEnquiry());
    expect(status).toBe(200);
    expect(json).toEqual({ ok: true, id: expect.stringMatching(UUID_V4), emailStatus: 'sent', storageStatus: 'skipped_ephemeral' });
    expect(existsSync(storageDir)).toBe(false);
  });

  it('on Vercel, a failed email is a 503', async () => {
    process.env.VERCEL = '1';
    process.env.RESEND_API_KEY = TEST_KEY;
    fetchMock.mockImplementation(async () => new Response('', { status: 500 }));
    const { status, json } = await send(validEnquiry());
    expect(status).toBe(503);
    expect(json).toEqual({ ok: false, error: ERR_UNSAVED, emailStatus: 'failed', storageStatus: 'skipped_ephemeral' });
  });

  it('only a non-empty VERCEL disables file storage', async () => {
    process.env.VERCEL = '';
    const { status, json } = await send(validEnquiry());
    expect(status).toBe(200);
    expect(json.storageStatus).toBe('stored');
    onlyLead();
  });

  it.each(UNWRITABLE_STORAGE)('503 when email is not configured and storage fails (%s)', async (_case, makeDir) => {
    process.env.ENQUIRY_STORAGE_DIR = makeDir();
    const { status, json } = await send(validEnquiry());
    expect(status).toBe(503);
    expect(json).toEqual({ ok: false, error: ERR_UNSAVED, emailStatus: 'not_configured', storageStatus: 'failed' });
  });

  it('503 when the email fails and storage fails', async () => {
    process.env.ENQUIRY_STORAGE_DIR = storageUnderAFile();
    process.env.RESEND_API_KEY = TEST_KEY;
    fetchMock.mockImplementation(async () => new Response('', { status: 500 }));
    const { status, json } = await send(validEnquiry());
    expect(status).toBe(503);
    expect(json).toEqual({ ok: false, error: ERR_UNSAVED, emailStatus: 'failed', storageStatus: 'failed' });
  });

  it('a sent email succeeds even when storage fails', async () => {
    process.env.ENQUIRY_STORAGE_DIR = storageUnderAFile();
    process.env.RESEND_API_KEY = TEST_KEY;
    resendAccepts();
    const { status, json } = await send(validEnquiry());
    expect(status).toBe(200);
    expect(json).toEqual({ ok: true, id: expect.stringMatching(UUID_V4), emailStatus: 'sent', storageStatus: 'failed' });
  });
});

// --- GET /api/health ---------------------------------------------------------

describe('GET /api/health', () => {
  it('exports only GET', () => {
    expect(Object.keys(healthRoute)).toEqual(['GET']);
  });

  it('reports status, service and an ISO timestamp', async () => {
    const before = Date.now();
    const res = healthRoute.GET();
    const after = Date.now();
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('application/json');
    const body = (await res.json()) as Record<string, unknown>;
    expect(Object.keys(body).sort()).toEqual(['service', 'status', 'timestamp']);
    expect(body).toMatchObject({ status: 'ok', service: 'itemba-group-website' });
    const timestamp = String(body.timestamp);
    expect(new Date(timestamp).toISOString()).toBe(timestamp);
    expect(Date.parse(timestamp)).toBeGreaterThanOrEqual(before);
    expect(Date.parse(timestamp)).toBeLessThanOrEqual(after);
  });
});
