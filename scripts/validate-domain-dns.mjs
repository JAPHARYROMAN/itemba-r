#!/usr/bin/env node

import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const options = parseArgs(process.argv.slice(2), process.env);
const envFile = options.envFile ?? (options.production ? '.env.production' : '.env.staging');
const envPath = resolve(rootDir, envFile);

if (!existsSync(envPath)) {
  fail(`Domain DNS env file is missing: ${envPath}`);
}

const env = loadEnv(envPath);
const errors = [];
const warnings = [];

const frontendUrl = parseUrl('FRONTEND_URL');
const apiUrl = parseUrl('NEXT_PUBLIC_API_URL');
const emailDomain = domainFromEmail(env.SMTP_FROM) ?? options.emailDomain;

if (!emailDomain) {
  errors.push('- SMTP_FROM must be set so the mail domain can be validated');
}

await validatePublicHost('FRONTEND_URL', frontendUrl);
await validatePublicHost('NEXT_PUBLIC_API_URL', apiUrl);

if (emailDomain) {
  await validateMx(emailDomain);
  await validateSpf(emailDomain);
  await validateDmarc(emailDomain);
}

if (warnings.length > 0) {
  console.warn(['validate-domain-dns: warnings', ...warnings].join('\n'));
}

if (errors.length > 0) {
  fail([`validate-domain-dns: ${envFile} has DNS issues`, ...errors].join('\n'));
}

console.log(
  `validate-domain-dns: OK ${envFile} (${frontendUrl.hostname}, ${apiUrl.hostname}, ${emailDomain})`,
);

async function validatePublicHost(label, url) {
  if (!url) return;
  const answers = [
    ...(await dnsAnswers(url.hostname, 'A')),
    ...(await dnsAnswers(url.hostname, 'AAAA')),
    ...(await dnsAnswers(url.hostname, 'CNAME')),
  ];
  if (answers.length === 0) {
    errors.push(`- ${label} host ${url.hostname} has no A, AAAA, or CNAME record`);
  }
}

async function validateMx(domain) {
  const answers = await dnsAnswers(domain, 'MX');
  if (answers.length === 0) {
    errors.push(`- ${domain} has no MX records for inbound domain email`);
    return;
  }
  const cloudflareRouting = answers.every((answer) =>
    String(answer.data ?? '').toLowerCase().includes('.mx.cloudflare.net'),
  );
  if (cloudflareRouting) {
    warnings.push(
      `- ${domain} MX points to Cloudflare Email Routing, which is inbound forwarding only and does not provide outbound SMTP`,
    );
  }
}

async function validateSpf(domain) {
  const txt = await txtValues(domain);
  const spfRecords = txt.filter((value) => value.toLowerCase().startsWith('v=spf1'));
  if (spfRecords.length === 0) {
    errors.push(`- ${domain} has no SPF TXT record`);
    return;
  }
  if (spfRecords.length > 1) {
    errors.push(`- ${domain} has multiple SPF TXT records; merge them into one`);
  }
  if (
    spfRecords.length === 1 &&
    spfRecords[0].includes('_spf.mx.cloudflare.net') &&
    !/(include:(?!_spf\.mx\.cloudflare\.net)|ip4:|ip6:|a(?=\s)|mx(?=\s))/.test(spfRecords[0])
  ) {
    warnings.push(
      `- ${domain} SPF currently appears to cover Cloudflare Email Routing only; add your transactional mail provider's SPF include before enabling outbound SMTP`,
    );
  }
}

async function validateDmarc(domain) {
  const txt = await txtValues(`_dmarc.${domain}`);
  const dmarcRecords = txt.filter((value) => value.toLowerCase().startsWith('v=dmarc1'));
  if (dmarcRecords.length === 0) {
    errors.push(`- _dmarc.${domain} is missing; add a DMARC TXT record before production email`);
    return;
  }
  if (dmarcRecords.length > 1) {
    errors.push(`- _dmarc.${domain} has multiple DMARC records; keep exactly one`);
  }
}

async function txtValues(name) {
  return (await dnsAnswers(name, 'TXT')).map((answer) =>
    String(answer.data ?? '')
      .replace(/^"|"$/g, '')
      .replace(/"\s+"/g, ''),
  );
}

async function dnsAnswers(name, type) {
  const response = await fetch(
    `https://cloudflare-dns.com/dns-query?name=${encodeURIComponent(name)}&type=${encodeURIComponent(type)}`,
    { headers: { accept: 'application/dns-json' } },
  );
  if (!response.ok) {
    errors.push(`- DNS lookup failed for ${name} ${type}: HTTP ${response.status}`);
    return [];
  }
  const body = await response.json();
  if (body.Status !== 0) return [];
  return Array.isArray(body.Answer) ? body.Answer : [];
}

function parseUrl(key) {
  if (!env[key]) {
    errors.push(`- ${key} is required`);
    return null;
  }
  try {
    return new URL(env[key]);
  } catch {
    errors.push(`- ${key} must be a valid URL`);
    return null;
  }
}

function domainFromEmail(value) {
  const match = /^[^@\s]+@([^@\s]+)$/.exec(String(value ?? '').trim());
  return match?.[1]?.toLowerCase() ?? null;
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
  const target = String(
    envValues.npm_config_target || envValues.npm_config_environment || envValues.npm_config_env || '',
  ).toLowerCase();
  const parsed = {
    envFile: configValue(envValues.npm_config_env_file),
    emailDomain: configValue(envValues.npm_config_email_domain),
    production: target === 'production' || target === 'prod' || bool(envValues.npm_config_production),
  };

  if (target === 'staging' || target === 'stage' || bool(envValues.npm_config_staging)) {
    parsed.production = false;
  }

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--staging') {
      parsed.production = false;
      continue;
    }
    if (arg === '--production') {
      parsed.production = true;
      continue;
    }
    if (arg === '--env-file') {
      parsed.envFile = argv[index + 1];
      index += 1;
      continue;
    }
    if (arg.startsWith('--env-file=')) {
      parsed.envFile = arg.slice('--env-file='.length);
      continue;
    }
    if (arg === '--email-domain') {
      parsed.emailDomain = argv[index + 1];
      index += 1;
      continue;
    }
    if (arg.startsWith('--email-domain=')) {
      parsed.emailDomain = arg.slice('--email-domain='.length);
      continue;
    }
    if (!arg.startsWith('--')) {
      const normalized = arg.trim().toLowerCase();
      if (normalized === 'production' || normalized === 'prod') {
        parsed.production = true;
        continue;
      }
      if (normalized === 'staging' || normalized === 'stage') {
        parsed.production = false;
        continue;
      }
      if (!parsed.envFile) {
        parsed.envFile = arg;
        continue;
      }
    }
    fail(`Unknown argument: ${arg}`);
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

function fail(message) {
  console.error(message);
  process.exit(1);
}
