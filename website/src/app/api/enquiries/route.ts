import { randomUUID } from 'node:crypto';
import { appendFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { NextRequest, NextResponse } from 'next/server';
import { contact, enquiryIntents } from '@/lib/site';

export const runtime = 'nodejs';

type EmailStatus = 'sent' | 'failed' | 'not_configured';
type StorageStatus = 'stored' | 'skipped_ephemeral' | 'failed';

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
  emailStatus: EmailStatus;
  userAgent: string;
};

function cleanText(value: unknown, maxLength: number) {
  if (typeof value !== 'string') return '';
  return value.replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, maxLength);
}

function inferTags(intentId: string, sourcePath: string) {
  const tags = new Set(['website-lead', `intent:${intentId || 'general'}`]);

  if (intentId === 'mwanjalisi') tags.add('sector:fuel');
  if (intentId === 'westsides') tags.add('sector:trade');
  if (intentId === 'enterprises') tags.add('sector:operations');
  if (sourcePath.startsWith('/services/')) tags.add('source:service-page');
  if (sourcePath.startsWith('/companies/')) tags.add('source:company-page');
  if (sourcePath.startsWith('/locations/')) tags.add('source:location-page');
  if (sourcePath === '/partnerships') tags.add('source:partnerships');
  if (sourcePath === '/capabilities') tags.add('source:capabilities');
  if (sourcePath === '/contact') tags.add('source:contact');
  if (sourcePath === '/faq') tags.add('source:faq');
  if (sourcePath.startsWith('/insights/')) tags.add('source:insight-page');

  return Array.from(tags);
}

function getStoragePath() {
  const defaultStorageDir = path.join(process.cwd(), 'data');
  const storageDir = process.env.ENQUIRY_STORAGE_DIR?.trim() || defaultStorageDir;

  return {
    storageDir,
    filePath: path.join(storageDir, 'enquiries.jsonl'),
  };
}

function canUseFileStorage() {
  // Vercel/serverless filesystems are temporary, so file writes there are not a
  // trustworthy fallback for live enquiries. Docker/self-hosted deployments can
  // use the mounted volume described in DEPLOY.md.
  return !process.env.VERCEL;
}

async function storeLead(lead: LeadRecord) {
  const { storageDir, filePath } = getStoragePath();
  await mkdir(storageDir, { recursive: true });
  await appendFile(filePath, `${JSON.stringify(lead)}\n`, 'utf8');
}

function splitRecipients(value: string) {
  return value
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function extractReplyTo(value: string) {
  const match = value.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i);
  return match?.[0];
}

function formatLeadEmail(lead: LeadRecord) {
  return [
    `New website enquiry: ${lead.intentLabel}`,
    '',
    `Lead ID: ${lead.id}`,
    `Created: ${lead.createdAt}`,
    `Route to: ${lead.routeTo}`,
    `Source page: ${lead.sourcePath || 'Not provided'}`,
    `Tags: ${lead.tags.join(', ')}`,
    '',
    `Name: ${lead.name || 'Not provided'}`,
    `Organisation: ${lead.organization || 'Not provided'}`,
    `Preferred contact: ${lead.contactMethod}`,
    '',
    'Message:',
    lead.message,
  ].join('\n');
}

async function sendLeadEmail(lead: LeadRecord): Promise<EmailStatus> {
  const apiKey = process.env.RESEND_API_KEY?.trim();
  if (!apiKey) return 'not_configured';

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8000);

  try {
    const recipients = splitRecipients(process.env.ENQUIRY_EMAIL_TO || contact.email);
    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: process.env.ENQUIRY_EMAIL_FROM || 'Itemba Group Website <onboarding@resend.dev>',
        to: recipients.length > 0 ? recipients : [contact.email],
        subject: `Website enquiry: ${lead.subject}`,
        text: formatLeadEmail(lead),
        reply_to: extractReplyTo(lead.contactMethod),
      }),
      signal: controller.signal,
    });

    return response.ok ? 'sent' : 'failed';
  } catch {
    return 'failed';
  } finally {
    clearTimeout(timeout);
  }
}

export async function POST(request: NextRequest) {
  let payload: unknown;

  try {
    payload = await request.json();
  } catch {
    return NextResponse.json({ ok: false, error: 'Invalid JSON payload.' }, { status: 400 });
  }

  if (!payload || typeof payload !== 'object') {
    return NextResponse.json({ ok: false, error: 'Invalid enquiry payload.' }, { status: 400 });
  }

  const body = payload as Record<string, unknown>;
  if (cleanText(body.website, 120)) {
    return NextResponse.json({
      ok: true,
      id: null,
      emailStatus: 'not_configured',
      storageStatus: 'skipped_ephemeral',
    });
  }

  const intentId = cleanText(body.intentId, 80) || 'general';
  const intent = enquiryIntents.find((entry) => entry.id === intentId) ?? enquiryIntents[0];
  const contactMethod = cleanText(body.contactMethod, 220);
  const message = cleanText(body.message, 2000);

  if (!contactMethod || !message) {
    return NextResponse.json(
      { ok: false, error: 'Preferred contact and message are required.' },
      { status: 400 },
    );
  }

  const sourcePath = cleanText(body.sourcePath, 240) || '/';
  const lead: LeadRecord = {
    id: randomUUID(),
    createdAt: new Date().toISOString(),
    intentId: intent.id,
    intentLabel: intent.label,
    routeTo: intent.routeTo,
    subject: intent.subject,
    name: cleanText(body.name, 140),
    organization: cleanText(body.organization, 180),
    contactMethod,
    message,
    sourcePath,
    tags: inferTags(intent.id, sourcePath),
    emailStatus: 'not_configured',
    userAgent: cleanText(request.headers.get('user-agent'), 300),
  };

  lead.emailStatus = await sendLeadEmail(lead);

  let storageStatus: StorageStatus = 'skipped_ephemeral';
  if (canUseFileStorage()) {
    try {
      await storeLead(lead);
      storageStatus = 'stored';
    } catch {
      storageStatus = 'failed';
    }
  }

  if (lead.emailStatus !== 'sent' && storageStatus !== 'stored') {
    return NextResponse.json(
      {
        ok: false,
        error:
          'The enquiry could not be safely saved or emailed. Please use WhatsApp, email, or phone for this enquiry.',
        emailStatus: lead.emailStatus,
        storageStatus,
      },
      { status: 503 },
    );
  }

  return NextResponse.json({
    ok: true,
    id: lead.id,
    emailStatus: lead.emailStatus,
    storageStatus,
  });
}
