// Temp generator: builds AUDIT_FINDINGS.md + AUDIT_FIX_SUGGESTIONS.md from the
// verified workflow findings. Deleted before commit.
import fs from 'node:fs';

const SRC =
  'C:/Users/user/AppData/Local/Temp/claude/c--projects-Actual-Projects-itemba-r/f2976bae-17cc-433b-8600-4c02e0793829/tasks/w0exahiws.output';

const raw = fs.readFileSync(SRC, 'utf8');
const j = JSON.parse(raw);
const findings = (j.result && j.result.findings) || j.findings || [];

const SEV_ORDER = ['critical', 'high', 'medium', 'low', 'info'];
const sevRank = (s) => {
  const i = SEV_ORDER.indexOf((s || '').toLowerCase());
  return i === -1 ? 99 : i;
};

// Stable sort: by severity, then confidence (high first), then file
const confRank = (c) => ({ high: 0, medium: 1, low: 2 }[(c || '').toLowerCase()] ?? 3);
findings.sort(
  (a, b) =>
    sevRank(a.severity) - sevRank(b.severity) ||
    confRank(a.confidence) - confRank(b.confidence) ||
    String(a.file || '').localeCompare(String(b.file || '')),
);

findings.forEach((f, i) => {
  f._id = 'ITMB-' + String(i + 1).padStart(3, '0');
});

const counts = {};
for (const s of SEV_ORDER) counts[s] = findings.filter((f) => (f.severity || '').toLowerCase() === s).length;
const total = findings.length;

const catCounts = {};
for (const f of findings) {
  const k = (f.category || 'uncategorized').toLowerCase();
  catCounts[k] = (catCounts[k] || 0) + 1;
}

const DATE = '2026-05-30';
const esc = (s) => String(s ?? '').trim();
const fileRef = (f) => (f.line ? `${f.file}:${f.line}` : `${f.file}`);

// ---------- AUDIT_FINDINGS.md ----------
let out = '';
out += `# ITEMBA-R — Deep Codebase Audit: Findings\n\n`;
out += `**System:** ITEMBA-R — Group Digital Governance & Enterprise Management System (live at app.itembagrouptz.com)\n`;
out += `**Scope:** Full codebase — NestJS 11 + Prisma 5 backend (267 modules, ~103K LOC) and Next.js 14 frontend (~102K LOC)\n`;
out += `**Date:** ${DATE}\n`;
out += `**Method:** Multi-agent static audit — 24 specialized finder agents across security, multi-tenant isolation, financial/accounting correctness, payroll/tax, inventory/sales concurrency, frontend, Prisma schema and API contracts — each finding independently re-verified against the source by an adversarial verifier agent. Only verified, evidence-backed findings are listed.\n\n`;

out += `> Companion document: **AUDIT_FIX_SUGGESTIONS.md** — concrete, minimal, production-safe remediation for every finding below.\n\n`;

out += `## Severity summary\n\n`;
out += `| Severity | Count |\n|---|---|\n`;
for (const s of SEV_ORDER) out += `| ${s[0].toUpperCase() + s.slice(1)} | ${counts[s]} |\n`;
out += `| **Total** | **${total}** |\n\n`;

out += `## Executive summary\n\n`;
out += `The ITEMBA-R **security foundation is mature**: argon2 password hashing with constant-time verification to defeat enumeration timing oracles, refresh-token family rotation with reuse detection, session-bound JWTs with per-request revocation checks, strict production env validation (rejects default secrets, forces distinct key material and HTTPS origins), a hardened global \`ValidationPipe\` (whitelist + forbidNonWhitelisted), CORS that rejects wildcards, Helmet, a global Throttler, a global soft-delete Prisma layer, and an error filter that scrubs secrets and never leaks stack traces to clients.\n\n`;
out += `The risk is **not in the foundation but in its uneven application across 267 feature modules**. The dominant, systemic finding is that tenant isolation is enforced *per-service* (the global \`PermissionsGuard\` deliberately does no per-record company check — see ITMB finding for \`permissions.guard.ts\`), and a meaningful number of services apply \`CompanyScopeService\`/\`applyCompanyScopeWhere\` on their **list** endpoints but **omit it on \`findOne\` and id-based mutations** — producing cross-company **IDOR** on single records (read, edit, state transitions, and in several cases **direct posting of journal entries into another company's general ledger**). A second systemic theme is **mass-assignment of server-controlled financial/approval fields** (totals, \`paymentStatus\`, \`approvedById\`, \`createdById\`, \`companyId\`) accepted verbatim from the client because they are declared DTO members (so whitelist does not strip them) or because the controller uses an untyped \`@Body() dto: any\` (bypassing validation entirely). The remaining findings cluster around **token longevity** (access tokens minted with no \`exp\`; persistent refresh tokens never rotated), **financial arithmetic/atomicity** (multi-write operations not wrapped in transactions; balance read-modify-write races; document-number generation races), and assorted **reliability/contract** issues.\n\n`;
out += `**Top risks to the live multi-company financial system:**\n\n`;
out += `1. **Cross-tenant ledger corruption** — intercompany-transactions, depreciation, and loan-repayment posting paths write POSTED journal entries into arbitrary companies' GLs with no access check.\n`;
out += `2. **Cross-tenant disclosure** of financial documents (trial balances, financial-statement runs, rent/fuel/credit records) via unscoped \`findOne\`.\n`;
out += `3. **Privilege escalation** via role create/update (a delegated role admin can mint a GROUP-scoped role or attach arbitrary permissions).\n`;
out += `4. **Financial-state forgery** via mass-assignment (orders marked PAID with no payment; self-approved contracts/pricing).\n`;
out += `5. **Token theft persistence** — non-expiring access tokens + non-rotating refresh tokens disable both layers of token-theft mitigation by default.\n\n`;

out += `## Findings by category\n\n`;
out += `| Category | Count |\n|---|---|\n`;
for (const k of Object.keys(catCounts).sort((a, b) => catCounts[b] - catCounts[a]))
  out += `| ${k} | ${catCounts[k]} |\n`;
out += `\n`;

out += `## Detailed findings\n\n`;
let lastSev = '';
for (const f of findings) {
  const sev = (f.severity || '').toLowerCase();
  if (sev !== lastSev) {
    out += `\n### ${sev.toUpperCase()} severity\n\n`;
    lastSev = sev;
  }
  out += `#### ${f._id} — ${esc(f.title)}\n\n`;
  out += `- **Severity:** ${sev}  •  **Confidence:** ${esc(f.confidence) || 'n/a'}  •  **Category:** ${esc(f.category)}\n`;
  out += `- **Location:** \`${fileRef(f)}\`\n\n`;
  out += `**What & why:** ${esc(f.description)}\n\n`;
  if (esc(f.evidence)) out += `**Evidence:** ${esc(f.evidence)}\n\n`;
  out += `**Impact:** ${esc(f.impact)}\n\n`;
  out += `**Fix (summary):** ${esc(f.fix)}\n\n`;
  out += `---\n\n`;
}

fs.writeFileSync('AUDIT_FINDINGS.md', out, 'utf8');

// ---------- AUDIT_FIX_SUGGESTIONS.md ----------
let fix = '';
fix += `# ITEMBA-R — Audit Fix Suggestions\n\n`;
fix += `**Companion to:** AUDIT_FINDINGS.md\n**Date:** ${DATE}\n\n`;
fix += `Every fix below is designed to be **minimal and production-safe** (narrowing/additive — they add missing access checks, validation, transactions, or token expiry rather than changing established behaviour). IDs match AUDIT_FINDINGS.md.\n\n`;

fix += `## Remediation strategy & roll-out order\n\n`;
fix += `1. **Critical & high IDOR / cross-tenant write (do first).** Add \`CompanyScopeService\` to every flagged service: thread the authenticated \`AuthUser\` from the controller into \`findOne\` and all id-based mutations, and call \`assertCanAccessCompany(user, record.companyId[, WRITE])\` after loading. These are *narrowing-only*: legitimate same-company access is unchanged; only cross-company access (which should never have worked) starts being rejected.\n`;
fix += `2. **Privilege-escalation & mass-assignment.** Add authority checks to role create/update; remove server-controlled fields (\`approvedById\`, \`createdById\`, \`companyId\`, monetary totals, \`paymentStatus\`, \`status\`) from create DTOs and derive them server-side; replace untyped \`@Body() dto: any\` with validated DTOs.\n`;
fix += `3. **Token longevity.** Give access tokens an explicit short TTL; rotate refresh tokens even for long-lived sessions.\n`;
fix += `4. **Atomicity & arithmetic.** Wrap multi-write business operations in \`prisma.$transaction\`; use atomic \`{ increment }\`/unique constraints for counters and balances; recompute monetary totals server-side.\n`;
fix += `5. **Reliability / contracts / schema.** Apply the targeted fixes per finding.\n\n`;

fix += `## A reusable pattern for the IDOR fixes\n\n`;
fix += `Most isolation findings share one remedy. The canonical shape (already used correctly in \`customer-statements.service.ts\`):\n\n`;
fix += '```ts\n';
fix += `// service\nconstructor(private readonly companyScope: CompanyScopeService, /* ... */) {}\n\n`;
fix += `async findOne(id: string, user: AuthUser) {\n  const item = await this.prisma.<model>.findFirst({ where: { id, deletedAt: null } });\n  if (!item) throw new NotFoundException();\n  await this.companyScope.assertCanAccessCompany(user, item.companyId); // WRITE for mutations\n  return item;\n}\n\n`;
fix += `// every id-based mutation calls findOne(id, user) BEFORE mutating\n// controller passes @CurrentUser() user into findOne and each mutation handler\n`;
fix += '```\n\n';

fix += `## Fixes by finding\n\n`;
lastSev = '';
for (const f of findings) {
  const sev = (f.severity || '').toLowerCase();
  if (sev !== lastSev) {
    fix += `\n### ${sev.toUpperCase()} severity\n\n`;
    lastSev = sev;
  }
  fix += `#### ${f._id} — ${esc(f.title)}\n\n`;
  fix += `- **Location:** \`${fileRef(f)}\`  •  **Severity:** ${sev}  •  **Confidence:** ${esc(f.confidence) || 'n/a'}\n\n`;
  fix += `${esc(f.fix)}\n\n`;
  fix += `---\n\n`;
}

fs.writeFileSync('AUDIT_FIX_SUGGESTIONS.md', fix, 'utf8');

// ---------- console manifest ----------
console.log('Total findings:', total);
console.log('By severity:', JSON.stringify(counts));
console.log('Wrote AUDIT_FINDINGS.md and AUDIT_FIX_SUGGESTIONS.md');
console.log('\nID\tSEV\tCONF\tFILE\tTITLE');
for (const f of findings) {
  console.log(
    `${f._id}\t${(f.severity || '').toUpperCase()}\t${f.confidence || ''}\t${fileRef(f)}\t${esc(f.title).slice(0, 80)}`,
  );
}
