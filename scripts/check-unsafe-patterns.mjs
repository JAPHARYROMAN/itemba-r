#!/usr/bin/env node
/**
 * Static-analysis guardrail for the patterns that caused the audit findings.
 *
 * Phase 4 (P2-09): some bugs only show up in code review and are easy to
 * regress accidentally. This script scans the backend source for known
 * unsafe patterns and exits non-zero when any are found, so CI can block a
 * PR before the regression lands.
 *
 * Each rule has:
 *   - id          stable identifier for waivers
 *   - description what's wrong with the pattern
 *   - regex       what we look for
 *   - paths       directories to scan
 *   - allowFiles  optional allow-list of file paths that may contain the
 *                 pattern (rare — usually for the canonical implementation
 *                 the rule is forbidding regressions of)
 *
 * Baseline:
 *   `scripts/check-unsafe-patterns.baseline.json` lists currently-known
 *   violations that are part of the open P0-01 backlog. The script treats
 *   those as known and only fails when a NEW violation appears (i.e. when
 *   somebody copies the unsafe pattern into a file that wasn't in the
 *   baseline). To regenerate the baseline after a wave of refactors, run
 *   the script with `--write-baseline`.
 *
 * Run from the repo root:
 *   node scripts/check-unsafe-patterns.mjs
 *   node scripts/check-unsafe-patterns.mjs --write-baseline
 */

import { readFileSync, statSync, writeFileSync, existsSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { readdir } from 'node:fs/promises';

const ROOT = process.cwd();
const BACKEND_SRC = join(ROOT, 'backend', 'src');
const FRONTEND_SRC = join(ROOT, 'frontend', 'src');
const BASELINE_FILE = join(ROOT, 'scripts', 'check-unsafe-patterns.baseline.json');

const RULES = [
  {
    id: 'COMPANY_ID_QUERY_OVERRIDE',
    description:
      'Re-introduced "blind override" pattern: `if (companyId) where.companyId = companyId` ' +
      'overwrites the safe filter set from the user. Use CompanyScopeService.companyWhereFor instead.',
    regex:
      /if\s*\(\s*companyId\s*\)\s*\n?\s*where\.companyId\s*=\s*companyId/m,
    paths: [BACKEND_SRC],
    allowFiles: [],
  },
  {
    id: 'JWT_SECRET_FALLBACK',
    description:
      'EncryptionService used to fall back from APP_SECRET to JWT_ACCESS_SECRET to a literal default. ' +
      'Sharing key material across security domains breaks rotation. Read the dedicated APP_ENCRYPTION_KEY.',
    regex: /APP_SECRET\s*\|\|\s*.*JWT_ACCESS_SECRET\s*\|\|/,
    paths: [BACKEND_SRC],
    allowFiles: [],
  },
  {
    id: 'AES_CBC_TOTP',
    description:
      'TOTP / sensitive-secret encryption was hardened from AES-CBC to AES-GCM with AAD. ' +
      'Re-introducing aes-256-cbc createCipheriv for sensitive secrets is a regression.',
    regex: /createCipheriv\(\s*['"]aes-256-cbc['"]/,
    paths: [BACKEND_SRC],
    allowFiles: [],
  },
  {
    id: 'PASSWITHNOTESTS',
    description:
      'CI must not silently accept "no tests ran". Drop `--passWithNoTests` so missing tests fail the build.',
    regex: /--passWithNoTests/,
    paths: [join(ROOT, '.github', 'workflows')],
    allowFiles: [],
  },
  {
    id: 'PRISMA_USER_HARD_DELETE',
    description:
      'Phase 3 made Users a soft-delete model. `prisma.user.delete` is not allowed in services — use the soft-delete path in UsersService.remove().',
    regex: /prisma\.user\.delete\(/,
    paths: [BACKEND_SRC],
    allowFiles: [],
  },
  {
    id: 'PUBLIC_REGISTER_DEFAULT_ON',
    description:
      'Register endpoint must remain disabled by default. ALLOW_PUBLIC_REGISTRATION default flips back to "true" should never land.',
    regex: /ALLOW_PUBLIC_REGISTRATION:\s*string\s*=\s*['"]true['"]/,
    paths: [BACKEND_SRC],
    allowFiles: [],
  },
  {
    // Phase 6 hotfix guardrail. SalesOrderStatus is
    //   { DRAFT, CONFIRMED, PARTIALLY_PAID, PAID, CANCELLED, VOIDED }.
    // "CLOSED" was a stale literal carried over from an earlier draft of
    // the enum and caused Prisma to reject the whole `status: { in: [...] }`
    // clause at runtime ("Invalid value for argument `in`. Expected
    // SalesOrderStatus."). The fix is to reference the enum constants
    // (SalesOrderStatus.PAID, etc.) instead of magic strings. This rule
    // catches any reintroduction of the literal in code.
    id: 'SALES_ORDER_STATUS_CLOSED_LITERAL',
    description:
      "SalesOrderStatus has no `CLOSED` value. Use SalesOrderStatus enum constants " +
      "(CONFIRMED, PARTIALLY_PAID, PAID) instead of magic strings — Prisma will " +
      "reject `status: { in: [...'CLOSED'] }` at runtime.",
    regex: /'CONFIRMED',\s*'PARTIALLY_PAID',\s*'PAID',\s*'CLOSED'/,
    paths: [BACKEND_SRC],
    allowFiles: [],
  },
  {
    // Phase 6 GL posting funnel guardrail. The intent is that all journal
    // entries are produced via the canonical journal-entries / accounting-engine
    // services. Direct prisma.journalEntry.create calls outside those modules
    // bypass the period-close lock check and the audit-action standardization.
    id: 'GL_DIRECT_POSTING_OUTSIDE_ENGINE',
    description:
      'Direct prisma.journalEntry.create / journalEntryLine.create outside the canonical journal-entries / accounting-engine services bypasses period-close locks. Use AccountingControlService + the journal-entries posting path.',
    regex:
      /\b(?:prisma|tx|db)\.(?:journalEntry|journalEntryLine)\.(?:create|createMany)\s*\(/,
    paths: [BACKEND_SRC],
    allowFiles: [
      // Canonical posting paths — these are the only services allowed to
      // emit GL rows directly.
      'backend/src/modules/journal-entries/journal-entries.service.ts',
      'backend/src/modules/accounting-engine/posting-engine.service.ts',
      'backend/src/modules/accounting-engine/accounting-engine.service.ts',
      'backend/src/modules/posting-runs/posting-runs.service.ts',
      'backend/src/modules/period-close/period-close.service.ts',
      'backend/src/modules/audit-adjustments/audit-adjustments.service.ts',
      'backend/src/modules/depreciation/depreciation.service.ts',
      // Postings services that fan out from a single domain (HR payroll) are
      // also allowed since the audit-trail integrity is asserted there.
      'backend/src/modules/hr/payroll-postings/payroll-postings.service.ts',
    ],
  },
];

async function* walk(dir) {
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch (err) {
    if (err.code === 'ENOENT') return;
    throw err;
  }
  for (const entry of entries) {
    if (entry.name === 'node_modules' || entry.name === 'dist' || entry.name === '.next') continue;
    const fullPath = join(dir, entry.name);
    if (entry.isDirectory()) {
      yield* walk(fullPath);
    } else if (
      entry.isFile() &&
      (entry.name.endsWith('.ts') ||
        entry.name.endsWith('.tsx') ||
        entry.name.endsWith('.yml') ||
        entry.name.endsWith('.yaml') ||
        entry.name.endsWith('.mjs'))
    ) {
      yield fullPath;
    }
  }
}

function isAllowed(filePath, rule) {
  const rel = relative(ROOT, filePath).split(sep).join('/');
  return rule.allowFiles.some((p) => rel === p || rel.endsWith('/' + p));
}

function isTestOrSelfFile(filePath) {
  const rel = relative(ROOT, filePath).toLowerCase();
  return (
    rel.includes('.spec.') ||
    rel.includes('.test.') ||
    rel.includes('check-unsafe-patterns')
  );
}

function normalize(p) {
  return relative(ROOT, p).split(sep).join('/');
}

function loadBaseline() {
  if (!existsSync(BASELINE_FILE)) return { perRule: {} };
  try {
    return JSON.parse(readFileSync(BASELINE_FILE, 'utf8'));
  } catch (err) {
    console.error(`Could not parse baseline file: ${err.message}`);
    process.exit(2);
  }
}

function writeBaseline(violationsByRule) {
  const perRule = {};
  for (const [ruleId, files] of Object.entries(violationsByRule)) {
    perRule[ruleId] = files.sort();
  }
  const out = {
    generatedAt: new Date().toISOString(),
    note:
      'Files with a known unsafe pattern that is part of an open backlog item. ' +
      'Files NOT in this list will fail check-unsafe-patterns if they match a rule. ' +
      'Regenerate with: node scripts/check-unsafe-patterns.mjs --write-baseline.',
    perRule,
  };
  writeFileSync(BASELINE_FILE, JSON.stringify(out, null, 2) + '\n', 'utf8');
}

async function scan() {
  const violationsByRule = {};
  for (const rule of RULES) {
    violationsByRule[rule.id] = [];
    for (const root of rule.paths) {
      try {
        statSync(root);
      } catch {
        continue;
      }
      for await (const file of walk(root)) {
        if (isTestOrSelfFile(file)) continue;
        if (isAllowed(file, rule)) continue;
        const contents = readFileSync(file, 'utf8');
        if (rule.regex.test(contents)) {
          violationsByRule[rule.id].push(normalize(file));
        }
      }
    }
  }
  return violationsByRule;
}

async function main() {
  const writeMode = process.argv.includes('--write-baseline');
  const violationsByRule = await scan();

  if (writeMode) {
    writeBaseline(violationsByRule);
    let total = 0;
    for (const files of Object.values(violationsByRule)) total += files.length;
    console.log(`Wrote baseline with ${total} known violation(s) to ${relative(ROOT, BASELINE_FILE)}`);
    return;
  }

  const baseline = loadBaseline();
  const newViolations = [];
  let totalKnown = 0;
  for (const rule of RULES) {
    const known = new Set(baseline.perRule?.[rule.id] ?? []);
    const found = violationsByRule[rule.id] ?? [];
    for (const file of found) {
      if (known.has(file)) {
        totalKnown++;
      } else {
        newViolations.push({ rule, file });
      }
    }
  }

  if (newViolations.length === 0) {
    console.log(
      `check-unsafe-patterns: OK (${totalKnown} known baseline violation(s); 0 new).`,
    );
    process.exit(0);
  }

  console.error(
    `check-unsafe-patterns: ${newViolations.length} NEW violation(s) found (${totalKnown} known baseline).`,
  );
  console.error('');
  for (const v of newViolations) {
    console.error(`  [${v.rule.id}] ${v.file}`);
    console.error(`    ${v.rule.description}`);
    console.error('');
  }
  console.error(
    'These are not in the baseline. If the match is a deliberate exception, ' +
      'either add the file to the rule\'s allowFiles list (preferred) or, after ' +
      'fixing other code, regenerate the baseline with --write-baseline.',
  );
  process.exit(1);
}

main().catch((err) => {
  console.error('check-unsafe-patterns crashed:', err);
  process.exit(2);
});
