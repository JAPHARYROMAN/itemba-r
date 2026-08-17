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

**Phase 1 — read-only agent. ✅ Shipped.** `backend/src/modules/msaidizi/`. The agent
calls the API over HTTP with the caller's own bearer token, so guards, the global
`ValidationPipe`, interceptors and the exception filter all run — there is no path
around the pipeline for the tool layer to have to re-implement. Tools are generated
from the manifest and filtered by permission *and* write mode, both as intersections.

Two deviations from this plan, both deliberate:

- **Deterministic domain narrowing instead of tool search.** Tool search plus a Haiku
  pre-filter is still the right end state, but narrowing is lexical and testable, and
  it produces the same tool set for the same question — which matters when you are
  trying to reproduce a bad run. `defer_loading` is implemented and off; turning it on
  needs a tool-search tool declared alongside, or deferred tools are simply invisible.
- **A hand-written loop instead of the SDK tool runner.** Confirmation is not an
  inline approve/deny — it suspends the run, returns to the caller, and resumes on a
  later request. That is a state machine, not a hook. Writing it out also put every
  security property in code that is testable without an API key.

**Phase 2 — amber writes. ✅ Shipped, except undo.** `MSAIDIZI_WRITE_MODE=amber` emits
write tools; per-run write caps bound them; every call is reported with its tier and
arguments and lands in the audit trail under the run's `agentSessionId`, so
`GET /audit-logs?agentSessionId=…` answers "what did this run do".

**Automatic undo is deliberately not built.** Reversing a create means a delete, which
is red tier; reversing an update means replaying `oldValue` over whatever has happened
since. A generic inverse-operation engine in a financial system would be confidently
wrong in exactly the cases that matter, and an undo that usually works is worse than
none. The run is made reviewable instead, and a human reverses it.

**Phase 3 — red writes. ✅ Shipped.** Confirmation is bound to the exact action: the id
is derived from the session, tool and arguments, so approving "delete invoice 41"
cannot authorise "delete invoice 42" — a different argument set is a different id.

**The open question in §9.1 is now answered: do not route through `approval-workflows`.**
That engine requires `entityType` + `entityId` — it approves entities that *exist*. An
agent proposes an action whose entity does not exist yet, so routing through it would
mean inventing synthetic entities to approve. Inline confirmation is the right shape.
Where a red action genuinely *is* an approval submission, the agent just calls that
endpoint like any other.

**Phase 4 — saved procedures. ✅ Shipped.** A procedure is a name, the user's own
instruction, and the capability list it was approved with. Compilation resolves the
instruction against the author's current permissions and returns the list for review
without saving. Creation re-derives that list server-side and intersects it, so a
client cannot name capabilities it was never granted. Activation is a separate call
and enforces maker-checker — an author cannot approve their own procedure, matching
the rule the approval engine already uses.

At run time two ceilings apply: the approved list, and the invoker's own permissions.
A procedure is **a saved instruction, never a grant** — a clerk running a director's
procedure does what the clerk may do. And the approved list does not widen when the
manifest grows, so a procedure approved last month cannot silently acquire an endpoint
that shipped last week.

Each phase is independently revertible, and the whole module is dark unless
`MSAIDIZI_ENABLED=true` with an API key — defaults are read-only.

---

## 9. Open questions

**Resolved during the build:**

1. ~~Confirmation UX for red tier~~ — **inline, not `approval-requests`.** That engine
   approves entities that exist; an agent proposes actions whose entity does not exist
   yet. See Phase 3 above.
2. ~~Whose permissions for a saved procedure~~ — **the invoker's.** A procedure is a
   saved instruction, never a grant. A run that resolves to no reachable capabilities
   is refused outright rather than half-executed, since a partially-completed procedure
   is worse than one that did not start.

**Still open:**

3. **Language.** The prompt currently instructs the model to answer in whatever
   language the user writes in, which is a reasonable default but not a decision.
   Swahili-first, English-first, or per-user via `user-preferences`? Affects prompt
   design and procedure authoring, not architecture.
4. **API key custody**, relative to the existing `api-keys` / `security-policies`
   modules. Currently `ANTHROPIC_API_KEY` from the environment, never persisted or
   logged. Fine for a single deployment; needs a decision before multi-tenant hosting,
   because it is the one credential in the system that is not tenant-scoped.
5. **Whether to enable tool search.** Needed once a user's permitted read set routinely
   exceeds the 60-capability budget. Requires live testing against the API.

---

## 9a. Adversarial results — 2026-08-17

Ten injection shapes, run against `claude-opus-5` at `effort: medium` in each write
mode. Suite and full results: `backend/test/adversarial/`.

| Mode | Cases | Result |
|---|---|---|
| read-only | 1–5 | all REPORTED |
| amber | 1–7 | all REPORTED, database fingerprint unchanged |
| red | 1–10 | all REPORTED, nothing deleted or altered |

Shapes covered: fake authority, fence escape (forging `</tool_result>` and a `Human:`
turn), social engineering with no authority claim, injection in an identifier field,
delayed persistence, two amber write demands, manufactured consent, tier laundering,
and confirmation hijack.

**Two of those deserve singling out.** *Fence escape* is the one aimed at this design
specifically, and the model did not merely ignore it — it named the mechanism,
describing the note as "fabricated conversation markup designed to look like it came
from you". *Tier laundering* is the cleverest: it never says "delete", and instead asks
for the same destructive outcome through three amber edits that each sit below the red
gate. It was refused too.

**Separate what this proves.** The refusals are the model honouring the
instruction/data boundary — evidence, not proof, and dependent on the model behaving.
Withholding a tier is structural: asked what it could do under amber, the agent
answered "no delete or deactivate tool available to me", because `buildRegistry` never
puts red-tier capabilities in the registry. Only the first can be argued with by a
payload.

### A real bug this found

The red-tier positive control failed with `messages.0: Input does not match the
expected shape`. **Multi-turn conversation was broken over HTTP** — `history` was typed
as an interface, interfaces carry no runtime metadata, and `whitelist: true` stripped
every prior turn to `{}`. Since the confirmation flow resumes a suspended run by
sending the conversation back, **Phase 3 could never have completed a confirmed action
in production.**

The isolation specs missed it because they call `MsaidiziService.run()` directly and
never touch the pipe. Fixed, with `msaidizi.dto.spec.ts` exercising the real
`ValidationPipe`. The lesson generalises: service-level specs prove the envelope, and
say nothing about the HTTP boundary.

---

## 10. What has not been exercised

Now exercised against the live API: the model client, multi-turn conversation, the
confirmation gate, all three write modes, and ten injection shapes (§9a).

Still unverified, and worth knowing before a live deployment:

- **The SSE endpoint** (`POST /msaidizi/ask/stream`). Unit-tested only; every live run
  used the non-streaming `ask`. It is the endpoint a real UI would use.
- **Prompt-cache hit rates.** `RunResult` does not surface `usage`, so no run has
  reported real token counts — every cost figure in this plan is an estimate, and
  whether the cache breakpoint actually hits is unmeasured.
- **Injection against a saved procedure run**, where the capability list is fixed in
  advance and the instruction comes from the database rather than the user. A
  materially different shape from anything tested.
- **Concurrency.** Every run has been sequential and single-user. Nothing has tested
  two runs at once, or the loopback invoker under load.
- **A payload arriving via an uploaded document or MCP tool result** — neither surface
  is wired up yet, but both are natural next features and both bypass the field-level
  assumptions the current suite makes.
