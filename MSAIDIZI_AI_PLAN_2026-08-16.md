# Msaidizi — Agentic AI Layer Plan (2026-08-16)

**Shape:** the user states what they want in plain language; Msaidizi does it, using
the app's own endpoints, bounded by the user's own permissions.
**First user:** owner / manager.
**Name:** `Msaidizi` (Swahili: *helper / assistant*), matching Kaunta, Stoo, Hesabu,
Manunuzi, Usiku, Funga Siku.

> Supersedes the read-only inline-narration draft. Those features survive as
> *surfaces* of this agent (§6), not as a separate system.

---

## 1. What the codebase already gives us

The hard part of "AI access scoped to user roles" is normally building the
capability map. It already exists here:

Figures below are produced by the capability manifest (§2.4), not by grep — it
reads Nest's own route metadata, so it resolves class-level decorators and cannot
disagree with what the router serves.

| | |
|---|---|
| Routed endpoints | **1,206** across 196 controller classes |
| Permission-gated | **1,166** — 1,142 `@RequirePermissions` + 24 `@RequireAnyPermissions` |
| Distinct permission codes | **499** |
| Reads / writes | 554 GET / 652 POST·PATCH·PUT·DELETE |
| Other guards | 23 JWT-only, 6 API-key scoped, 6 public (all `AuthController`), 5 role-gated |

**The permission decorator is the tool registry.** A tool-generation pass over the
controllers yields a capability per endpoint, each carrying the permission string that
gates it — so the tool set for a given user is a filter, not a bespoke build. The
`@nestjs/swagger` decorators supply the input schemas.

Also already present and directly reusable:
- `approval-workflows` / `approval-requests` / `approval-steps` — a built, audited
  human-approval path for writes.
- `audit-logs` — captures `action`, `entityType`, `userId`, `ipAddress`, `userAgent`,
  with severity derivation and sensitive-field redaction
  (`audit-logs.redaction.spec.ts`).
- `automation-rules` / `automation-runs` — a rules engine for deterministic triggers.
- `CompanyScopeService` in `src/common/services` — the tenant-scoping helper every
  service already routes through.

---

## 2. What Phase 0 addresses

### 2.1 The envelope is sound — the gap is that it isn't uniformly readable

An earlier draft of this plan claimed eight write endpoints were unguarded. That
was wrong: it counted only `@RequirePermissions` and missed `@RequireAnyPermissions`
and `@RequireApiScope`. The corrected picture is that **no write endpoint is
unguarded**. The writes outside the permission system are:

| Controller | Writes | Actual guard |
|---|---|---|
| `AuthController` | 13 | Necessarily permissionless — login, register, refresh, 2FA and password reset all run *before* the user has permissions |
| `IntegrationApiController` | 3 | `x-api-key` + `@RequireApiScope('payments.write'…)` — machine-to-machine, a separate auth axis |
| `GroupsController` | 3 | `@Roles('GROUP_SUPER_ADMIN','GROUP_DIRECTOR')` |
| `ReportsEnterpriseController` | 2 | JWT + self-attributed run/export telemetry |
| `UserPreferencesController` | 2 | JWT + `me`-scoped self-service |
| `GeneratedDocumentsController` | 1 | JWT; stateless render of caller-supplied content |

So there is no security hole to close. The real prerequisite is that the capability
surface be **uniformly machine-readable**: an agent's envelope has to be expressible
as data, and three of those six guard mechanisms cannot be expressed as permission
codes. The manifest models all of them explicitly and admits none of them to the
agent — see §2.4.

### 2.2 No channel attribution in the audit trail

`audit-logs` records *who*, never *through what*. Every AI-initiated action needs to
be attributable as "user X **via Msaidizi**, session Y, from prompt Z" — not merely
as user X. This matters for three separate reasons: trust (a manager reviewing the
log can tell what they did from what they asked for), debugging (a bad action traces
back to the instruction that caused it), and reversal (an agent run can be undone as
a unit).

Adding a `channel` / `agentSessionId` field costs almost nothing now and is
expensive to retrofit once there is history to backfill.

**Shipped.** `AuditChannel` is `WEB | API | AGENT | SYSTEM`, defaulting to `WEB`;
`agentSessionId` correlates one agent run. `userId` continues to record *whose
authority* was used and `channel` records *what exercised it* — an agent run carries
both. A session id is dropped unless the channel is `AGENT`, so the trail cannot
assert a correlation that does not exist, and an `AGENT` entry arriving without one
logs a warning rather than silently losing the grouping. Both are filterable on
`GET /audit-logs`, which is what makes "show me everything the agent did" answerable.

Note the honest limitation recorded in the schema and migration: rows written before
this migration take the `WEB` default and are **not** evidence of channel. Treat
pre-migration history as unattributed.

### 2.3 No reversibility classification

`deriveSeverity()` already tiers actions CRITICAL / HIGH / MEDIUM — but it classifies
**audit interest, not reversibility**. `LOGIN` is HIGH and harmless; `DOCUMENT_DOWNLOAD`
is CRITICAL because it is sensitive access, not because it destroys anything. Useful
input, wrong axis. §4 defines the axis we actually need.

### 2.4 The capability manifest — shipped

`backend/src/common/capabilities/` reads Nest's route metadata and emits one
`Capability` per endpoint: verb, path, permission codes, roles, API scopes, guard
kind, and reversibility tier. `capabilitiesFor(manifest, userPermissions)` is the
function the tool registry will call — it admits permission-gated routes only, so
role-gated, API-key, public and JWT-only routes can never become agent tools no
matter how broadly a user is granted.

Current classification: **554 green, 398 amber, 254 red**.

`capability-manifest.spec.ts` is the drift guard. It fails when a route lands with
no permission code (outside a named, reasoned exemption list), when a route escapes
tier classification, when a DELETE is anything but red, when an API-key route has no
scope, or when a write is genuinely unauthenticated. That last check is what keeps
the §2.1 table true rather than a snapshot of one afternoon's audit.

---

## 3. The governing constraint

Unchanged from the read-only draft, and now load-bearing rather than merely prudent:

**Every tool executes through an existing service, under the caller's own `AuthUser`.**
No raw Prisma, no SQL, no service-account context. Tools are constructed per request
and close over the caller:

```ts
// tool-registry.ts — auth is closed over, never a model-supplied argument
buildTools(user: AuthUser, companyId?: string) {
  return ENDPOINT_CAPABILITIES
    .filter((cap) => this.permissions.can(user, cap.permission))
    .map((cap) => betaZodTool({
      name: cap.toolName,
      description: cap.description,
      inputSchema: cap.schema,            // generated from the Swagger DTO
      defer_loading: true,                // see §5 — 1,206 tools cannot all be resident
      run: (input) => cap.invoke(user, companyId, input),
    }));
}
```

Two properties fall out. The model cannot name a tenant it should not reach, because
no tool schema has a tenant parameter. And an unpermitted capability is *invisible*
rather than refused — it never enters the tool list, so there is nothing to argue with.

Mirror the existing `*.isolation.spec.ts` suites (`procurement-statements`,
`reports-exports`) for the tool layer.

---

## 4. Permission is the ceiling; reversibility is the policy

This is the one place where "the AI has the user's access" needs qualifying, and it
is worth being precise about why.

A role grants the ability to do a thing. It was designed assuming a human at the
controls — someone who does it once, deliberately, looking at a screen that shows
what is about to happen. The same role handed to an agent permits doing it fifty
times in a loop, or doing a semantically valid but wrong version of it. Nothing about
the permission check distinguishes those cases. So: **permission decides *whether*,
a second axis decides *how*.**

| Tier | Count | What | Behaviour |
|---|---|---|---|
| **Green** | 554 | Reads | Runs freely within the user's permissions. No confirmation. |
| **Amber** | 398 | Reversible writes — create a draft, update a description, acknowledge an alert | Executes, reports what it did, offers undo. |
| **Red** | 254 | Irreversible, financial, or security-relevant | Confirm before execution, showing the exact payload. Where an approval workflow already exists, route through it instead of inventing a second gate. |

Implemented in `reversibility.ts` as ordered rules, first match wins, each naming
itself on the capability so a tier can be explained rather than just asserted:

| Rule | Hits | Meaning |
|---|---|---|
| `read-verb` | 554 | GET / HEAD / OPTIONS |
| `write-verb` | 398 | POST / PATCH / PUT with nothing red about them |
| `delete-verb` | 118 | Any DELETE |
| `red-action` | 75 | Permission code ending in `post`, `pay`, `reverse`, `void`, `cancel`, `approve`, `settle`, `dispose`, `revoke`, `assign_roles`, … |
| `red-module` | 61 | Any write under `permissions`, `roles`, `journal_entries`, `period_close`, `accounting_locks`, `payments`, `loans`, `backups`, … |

An endpoint that matches no rule falls through to **red**, not amber — an
unclassified capability is exactly the one an agent should not invoke unattended.
The drift spec fails on those, so the fallback is a safety net rather than a
resting state.

**Red tier is also the injection backstop.** See §7.

---

## 5. Scale: 1,206 tools will not fit

Loading every capability's schema would exhaust the context window before the user's
question arrives. Two mechanisms, used together:

**Tool search.** Declare capabilities with `defer_loading: true` and add
`tool_search_tool_regex_20251119` (or the BM25 variant). The model searches the
capability set and loads only the handful it needs. Schemas are *appended* rather
than swapped, so the prompt cache survives — which matters at this tool count.

**Domain pre-filtering.** Route the opening turn through a cheap classifier
(`claude-haiku-4-5`) that narrows to a sector — procurement, receivables, inventory,
HR, compliance — before tool search runs inside it. Cuts the search space by roughly
an order of magnitude for the price of one Haiku call.

At least one tool must remain non-deferred, or the API rejects the request.

---

## 6. Saved procedures — the second half of the ask

"Give it explicit instructions on how to work something" is worth treating as its own
feature rather than a property of free-text chat.

When a user explains a procedure — *"to close out a supplier: check open GRNs, match
against invoices, flag variances over 2%, then draft the payment"* — **save it** rather
than re-deriving it from prose every time. A saved procedure is reviewable before
first use, testable, cheap to re-run, attributable in the audit log, and does not
re-roll the dice on each execution. Free-text re-interpretation is the opposite on
all five counts.

This maps onto `automation-rules` / `automation-runs`, which already exist. A
procedure is authored in plain language, compiled to a reviewable step list, approved
once, then invoked by name. The inline features from the earlier draft — executive
summary narration, the Manunuzi purchase draft, receivables triage, the report finder
over the 67 catalog entries — become *pre-authored procedures pinned to a view*,
rather than a separate subsystem.

---

## 7. Risks

The risk profile is materially different from a read-only assistant, and one item
dominates.

| Risk | Mitigation |
|---|---|
| **Prompt injection → actions** | With reads only, injection yields bad narration. With 652 write endpoints reachable, it yields *writes*. Supplier names, product descriptions, customer notes, communication logs and uploaded document text are all attacker-influenceable and all flow into context. Tool results are fenced as data and never as instructions; **no red-tier action may be triggered by content originating in a tool result without human confirmation.** This is the primary justification for the red tier existing. |
| **Envelope holes** | §2.1 — close the eight undecorated writes first. |
| **Unattributable actions** | §2.2 — `channel` + `agentSessionId` on every audit entry. |
| **Loop / volume damage** | Per-session caps on write-tier calls; rate-limit red tier to one confirmed action at a time. A role that permits an action does not permit it fifty times. |
| **Fabricated numbers** | The model narrates, it does not compute. Figures come from tool results; any number in output must trace to one. |
| **Silent failure** | The features/UI review found swallowed errors to be the top defect class. An agent that silently no-ops reads as success. Every tool failure surfaces explicitly, and a failed step halts the run rather than continuing on stale assumptions. |
| **Cost** | Domain pre-filter on Haiku; tool search rather than resident schemas; prompt caching on the stable system prefix (keep volatile scope/date payloads *after* the breakpoint). |
| **POS coupling** | Msaidizi does not touch the Kaunta path. `offline-sync` and `mobile-sessions` exist because connectivity is not assumed; a terminal blocking on a model round-trip is a regression. |

---

## 8. Phasing

**Phase 0 — envelope and attribution. ✅ Shipped on `msaidizi-phase-0`.**
No AI code at all — entirely about making the security properties true and testable
*before* anything depends on them.

| Delivered | Where |
|---|---|
| Capability manifest + permission-filtered envelope | `backend/src/common/capabilities/capability-manifest.ts` |
| Reversibility tiers (554 green / 398 amber / 254 red) | `backend/src/common/capabilities/reversibility.ts` |
| Controller discovery | `backend/src/common/capabilities/load-controllers.ts` |
| Drift guard — 15 tests | `backend/src/common/capabilities/capability-manifest.spec.ts` |
| `AuditChannel` enum + `channel` / `agentSessionId` | `database/prisma/schema.prisma`, migration `20260816120000_audit_channel_attribution` |
| Channel plumbed through write + query + filter | `backend/src/modules/audit-logs/` (service, controller, 8 tests) |

The envelope audit (§2.1) turned out to need no code change — nothing was unguarded.
What it produced instead is the exemption list in the drift spec: six controllers,
each with a written reason for why it sits outside the permission system. That list
is now enforced rather than remembered.

**Phase 1 — read-only agent.** Capability generation over the 554 GETs, tool search,
domain pre-filter, auth closure, isolation specs. The user can ask anything about
their data and get a grounded answer. No writes exist yet, so injection is still
cosmetic — which makes this the right phase to harden the pattern.

**Phase 2 — amber writes.** Reversible actions with undo. Ships the confirmation UX
and the per-session write caps.

**Phase 3 — red writes.** Confirmation-before-execution, and routing through
`approval-workflows` wherever one already exists.

**Phase 4 — saved procedures.** Plain-language authoring, compiled to reviewable step
lists, invoked by name. The inline surfaces (§6) ship as the first pre-authored set.

Each phase is independently shippable and revertible, dark behind a flag until its
isolation specs and degraded-state handling are green — the same discipline the POS
reform used.

---

## 9. Open questions

1. **Confirmation UX for red tier.** Modal in-app, or route everything through
   `approval-requests` so it lands in the existing inbox? The latter is less to build
   and more consistent, but heavier for a manager acting on their own authority.
2. **Language.** Swahili, English, or per-user via `user-preferences`? Affects prompt
   design and the saved-procedure authoring surface, not architecture.
3. **Whose permissions at execution time** for a saved procedure — the author's, or
   the invoker's? Invoker's is safer and almost certainly correct, but it means a
   procedure can partially fail for a less-privileged user; the compiled step list
   should surface that at authoring time.
4. **API key custody**, relative to the existing `api-keys` / `security-policies`
   modules. Needed before Phase 1.
