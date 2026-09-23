# Benchmarks — measured, not argued

Not part of `npm test`. These call the live Anthropic API: they cost money, they
are non-deterministic, and none of that belongs in a gate that runs on every
commit. Run them when a decision needs a number instead of an argument.

The **scorer** is deterministic and runs in CI with
`npm run test:msaidizi-benchmark-score`. A hit requires a successful HTTP run,
`end_turn`, a non-empty answer, and a successful result paired with the expected
tool's dispatch. Merely attempting a tool, receiving an error, or exhausting a
budget does not pass. This measures successful retrieval, not answer accuracy.

Provider-side tool searches are counted separately from ERP dispatches using
the preserved provider transcript. Spending requires **zero searches**, the
exact live `ExpensesController.findAll` capability first, and at most two ERP
dispatches. To require the no-search path for **all seven** live cases, set
`MSAIDIZI_BENCHMARK_REQUIRE_FAST_PATH=true`. Reports include HTTP status,
completion, successful tools, search count, fast-path result, latency and tokens.

The live runner checks backend readiness before login, then requires capabilities
to report `enabled: true` and `writeMode: read-only` before sending any prompt.
Remote targets require HTTPS and explicitly supplied fixture credentials;
localhost retains the development defaults. Redirects are rejected so login
credentials cannot follow a redirected POST. Readiness/login/capability requests
have 15-second deadlines; each model request has a 180-second deadline. Requests
are never automatically retried: a client timeout does not establish that backend
work stopped. Transport/HTTP failures stop the run with a nonzero exit; no final
report is written for an interrupted run. Do not treat an older report at the
same path as evidence for that attempt.

The same CI command runs client/preflight controls as well as scoring tests:
**13 tests pass**, including a loopback HTTP test proving unhealthy, redirected
and write-enabled targets cannot reach `/msaidizi/ask`. Its spending response is
scripted; this is harness verification, not live model evidence.

## Deterministic chat-to-business proof

`test/msaidizi-chat-workflow.e2e-spec.ts` scripts only the model. It uses the real
manifest, login, HTTP loopback, permission/company guards, PostgreSQL conversation
and approval stores, expense service, posting engine and audit service. It covers
the seven resident endpoints and an expense draft → confirmed submission →
confirmed approval → balanced journal/open payable, including used-grant replay,
read-only mode, missing permission and cross-company denial. Scripted routing is
not evidence of live model selection, answer quality, latency or model cost.

Run against a **dedicated local disposable database** named
`msaidizi_chat_proof` (or `msaidizi_chat_proof_<suffix>`), never an existing shop
database. Apply all Prisma migrations first; then set `DATABASE_URL` to that
database and `MSAIDIZI_CHAT_DISPOSABLE_DB=1`, and run:

```sh
npm run test:msaidizi-chat-workflow
```

The fixture leaves its records and append-only audit rows in that disposable
database for inspection. Dispose of the dedicated database after inspection.
CI provisions it separately from the ordinary smoke-test database. No production
mode or autonomy setting is changed by this test.

## Durable dispatcher persistence proof

Against the same guarded disposable database, run
`npm run test:msaidizi-task-persistence`. This exercises the real dispatcher
transactions and PostgreSQL row locks; it seeds task states directly and does
not start a model, ERP invoker, device channel or background worker timer.
It covers unattempted read/mutation pause-resume after reconnect, independent
dispatcher contention, a claimed worker finishing its pause no-op, cancellation
winning over late completion, and exactly-once dead-mutation reconciliation to
`NEEDS_ATTENTION`/`UNKNOWN`. Prior step/job attempts and completed effects cannot
be requeued, and a task cannot claim another task's step.

This found a real resume defect: the stable step job key survived pause, but its
upsert left the job cancelled while the step became leased. Resumption now
requeues durably unattempted work, preserving the job ID, attempt history
and mutation retry ceiling. Pause also waits for claimed step jobs to settle
before permitting resume. These tests prove database persistence and dispatcher
transitions—not task HTTP authorization, OS-process crashes, host execution,
network recovery or full workstation acceptance. Fixture records/events remain
in the disposable database for inspection.

Local verification on 2026-09-04: **32 PostgreSQL regressions passed**, plus
**116 unit tests** across task runtime, task service, job-worker behavior and
background-job service. These counts do not establish the complete restart or
pause/resume acceptance matrix.

The pending-read-retry gap was also reproduced with two failing PostgreSQL
cases: cancelling a `RETRYING` job or receiving a completed worker pause no-op
left its step `RUNNING` and its task stuck in `PAUSING`. The dispatcher now parks
settled transient idempotent ERP reads under the task mutex and revalidates the
same durable evidence on resume. Step/job counters, the first step start time,
task consumption and the attempt ledger are preserved. This uses only remaining
individual-step retries; it does not retry a whole task. Eight negative controls
reject unknown/running/successful outcomes, permanent errors, missing attempt
rows, exhausted retries, mutations and completed effects. This is direct-state
database evidence, not a live worker crash/restart drill.

A third failing regression exposed stale pause cleanup cancelling a resumed
job. Cleanup now checks `PAUSING`, cancels queued jobs, parks eligible reads,
resets unattempted leases and publishes `PAUSED` in one transaction under the
task mutex. An injected durable-event failure proves all of those changes roll
back together, then a fresh dispatcher can complete the pause. ESLint and
`git diff --check` also pass. Direct fixture transitions do not substitute for
the separate process-level evidence below.

## Routine claim race checkpoint — 2026-09-04

The persistence suite also reproduces an ACTIVE -> PAUSED -> edited -> ACTIVE
schedule whose `nextRunAt` does not change. Previously, a worker holding the old
snapshot could advance that cursor and queue the superseded template. The claim
now binds the schedule version and `updatedAt` as well as its occurrence cursor.
The PostgreSQL regression first failed with an actual stale-template dispatch;
after the fix it rejects that claim without a task, audit or cursor change, then
queues the newly reviewed template exactly once. This is a direct dispatcher /
database proof; it does not activate a deployed routine or execute its ERP step.

The dispatcher also rechecks its enable/kill gates for each occurrence and after
waiting for the transaction connection. Unit regressions prove that closing the
gate after the first batch occurrence, or before the transaction callback starts,
prevents later claims. These checks stop new claims; they do not pretend to undo
an occurrence already committed before a kill request.

At this checkpoint **57 persistence tests and 23 schedule/control-plane tests
passed**. Production Autopilot remains disabled. Existing CI commands include
these regressions; no remote CI execution is claimed.

The adjacent mandate race was then reproduced against PostgreSQL: a stale
snapshot could still queue after a mandate budget edit or revocation. Dispatch
now locks the principal and mandate, in the same order as schedule activation,
before claiming the schedule. The persisted mandate version/timestamp must match
the snapshot used to validate the template and resolve budgets; status, date
validity and kill gates are checked again after lock acquisition. A stale claim
does not consume the occurrence. A fresh valid read uses the revised budget;
a fresh revoked read is rejected. These locks serialize the claim with authority
changes, not with an already-dispatched ERP or host operation.

Authority checkpoint (2026-09-04): **59 persistence and 30 schedule/control-plane
tests passed**. Unit cases cover disabled principals, missing/revoked/changed
mandates, expiry while waiting, and a kill switch changing during lock acquisition.
The database cases exercise committed changes between discovery and claim; they
are not a multi-host kill-switch or production Autopilot drill.

Scheduled-task provenance now persists `creationAuthority` in `task.created`
and the matching strict dispatch audit. The versioned, policy-content-free
record identifies the principal/company and exact schedule/mandate versions,
with the observed row timestamps. Those version numbers refer to immutable
control-plane history; the timestamps describe the observed current rows (a
schedule cursor update can change its timestamp without a configuration revision).
Skip/recovery evidence instead uses `observedAuthority`, so recovery under a
newer policy cannot falsely reattribute an existing task's creation. Older events
are not backfilled or assigned guessed versions.

Provenance checkpoint (2026-09-04): **59 persistence and 31 schedule/control-plane
tests passed**. PostgreSQL assertions match creation event/audit authority and
verify it remains unchanged after later schedule edits and mandate revocation.
The recovery unit case proves that no new creation event or creation-authority
claim is emitted for an existing task.

### Routine input-binding checkpoint — 2026-09-04

Routine templates previously accepted typed bindings but omitted them when
creating task-step rows, silently leaving `inputBindings=[]`. The database
regression reproduced that loss. Dispatch now persists validated definitions
and preserves reviewed null placeholders; the immutable plan digest includes
the definitions. Template validation applies the interactive plan's binding
shape, source, type, dependency and reviewed-reference authority checks.
Malformed bindings are rejected before a routine can be persisted/activated.

**59 persistence and 56 schedule/binding/control-plane tests passed.** The
PostgreSQL case checks stored definitions and resolves a plan-input binding with
the real runtime resolver, including its value-free provenance and
`instructionAuthority=false`. It uses a synthetic attempt record and does not
dispatch an ERP or host tool. Unit cases also cover declared dependencies and
rejection of unreviewed fixed-artifact selectors. Existing credential screening,
runtime source-scope checks and deployment gates remain in force; this is not
host/secret-reference acceptance or a live scheduled Autopilot execution proof.

### Canonical routine reference storage — 2026-09-04

Schedule API sanitization and the final Prisma boundary (including immutable
schedule versions) now share binding-aware template sanitization. Full binding
shape/authority validation runs before restoring only reviewed null placeholders
and canonical opaque reference definitions. The ordinary detector still scans
all non-exempt content; registered ephemeral secrets in the canonical definition
cause rejection rather than rewriting. Templates without bindings retain their
existing generic sanitization behavior.

Scope comparison now treats an optional DTO field with `undefined` the same as
an omitted JSON field; actual different company scopes remain different. This
fixes false reference-authority rejection after class transformation without
widening the reviewed scope.

**60 PostgreSQL tests and 119 targeted unit tests passed.** The database case
stores a synthetic UUID handle and null placeholder in a DRAFT routine and its
immutable version, and rejects a raw value without changing that record. Unit
cases reject bad handles/digests, missing authority, changed company scope and
declared secrets in handles/schema content. No real credential, enrolled device,
browser session, host invocation or production Autopilot activation is involved.

## Owned worker-process restart proof

Run `npm run typecheck:msaidizi-worker-restart`, then
`npm run test:msaidizi-worker-restart` against the guarded local disposable
database. CI runs both commands after the persistence proof. On 2026-09-04,
**14 process/network/database-connection regressions passed**; the
fixture typecheck passed, and worker ESLint reported no errors (three existing
`any` warnings outside the changed query).

The suite starts real child processes with `JobWorkerService`, the complete
`MsaidiziTaskStepHandler`, `CapabilityInvoker`, Prisma and `AuditLogsService`.
It does not start AppModule, polling loops, cloud models or host/device channels.
Manifest, CRUD admission and token ports are explicitly synthetic test inputs;
the HTTP receiver accepts only a test credential on its owned loopback port.
Its mutation creates a real row in the disposable database, then can withhold
the response. This is execution/recovery evidence, not Itemba HTTP permission,
JWT issuance, provider-contract, controller CRUD, or workstation evidence.

The positive controls execute both a read and a write, persist attributed audit
rows, complete the task and refuse duplicate dispatch from a new process. The
crash case verifies a competing process cannot steal the live lease, kills only
the suite's exact child handle after the receiver commits its row, then waits
for the persisted heartbeat deadline without rewriting timestamps. A fresh
worker recovers the dead lease; the dispatcher records `UNKNOWN` /
`NEEDS_ATTENTION`. Another restart still produces no second write or successor
job. Separate cases prove cancellation during a live write prevents its
successor, and a transient read can pause and resume in a new process with
`FAILED` then `SUCCEEDED` attempts and unchanged spent retry counts.

This also reproduced an early-dispatch defect: a job ten minutes in the future
was leased in an `Africa/Nairobi` database session. The due-job SQL now compares
Prisma's UTC timestamp column to `NOW() AT TIME ZONE 'UTC'`. Each child pins one
connection and that session timezone, so this regression remains effective on
UTC-configured CI hosts. No shared database timezone setting is changed.

Connection-loss follow-up on 2026-09-04: the receiver commits a write and closes
its actual TCP response either before headers or partway through a declared
body. Both cases persist one `UNKNOWN` attempt, one mutation and no successor,
and another process does not replay the write. The partial-body case initially
failed: 32,780 received bytes were incorrectly refunded to zero. The bounded
reader now returns only the observed byte count, prefix SHA-256 and explicit
`responseIncomplete` marker; incomplete text is withheld and retained buffers
are cleared. Task/step IO counters, attempt summaries and audit projections
preserve that evidence. A separate interrupted-read case confirms its bytes
remain charged through a successful retry and neither attempt nor audit rows
contain the partial content. **158 unit regressions passed** across the invoker,
task runtime, human write/approval path and job worker; fixture typechecking,
ESLint and formatting checks also passed. These counts overlap earlier checks.

Database-connection follow-up on 2026-09-04: an owned loopback TCP proxy forwards
only the child worker's disposable PostgreSQL connection and never inspects or
logs wire contents. The suite cuts established sockets and refuses reconnects
after attempt reservation/before dispatch, and separately after the receiver
commits a write. The worker cannot persist its settlement during the outage.
After restoring connectivity and observing the actual heartbeat deadline, a
fresh process recovers the lease to `DEAD_LETTER`, preserves the single spent
attempt and records `UNKNOWN` / `NEEDS_ATTENTION`. It dispatches neither a replay
nor a successor. Receiver rows remain zero before dispatch and one after commit.
No database server, shared service, firewall or unrelated connection is stopped.
The full 11-case suite, fixture typecheck and formatting pass. Rechecked resident
registry/measured-path suites: **61 passed**; scorer/client harness: **13 passed**.
No live model latency or cost claim follows from those regression results.

Read-recovery follow-up: a real connection-loss/retry case initially completed
the task while leaving its first attempt `RUNNING`. The worker now supplies its
lease owner to the handler, which reconciles only idempotent ERP reads under
task and job row locks, binding the stable job key, owner and retry generation.
Abandoned `REQUESTED`/`RUNNING` attempts become `FAILED` with an atomic event and
attributed audit row before budget checks; consumed counters, first-start clocks
and unknown IO reservations are not reset. Three live cases cover pre-dispatch
loss, post-dispatch loss with room to retry, and exhaustion that stops without
another call. The dispatcher no longer mistakes an unresolved, fully allocated
ERP response reservation for invalid accounting; negative or invalid accounting
still stops work, and worker-side caps remain unchanged.

Nine direct-database controls cover current/stale/missing owners, a stale retry
generation, cancellation, mutations, non-idempotent reads, an unrecovered job,
and audit failure. A failing audit rolls back attempt/event changes; repeated
reconciliation does not append duplicate evidence. Synthetic ownership fixtures
use separate queues. Run the persistence and worker suites sequentially when
sharing a database: the generic stale-lease sweep intentionally sees all queues.
The read-recovery checkpoint passed **32 persistence tests, 14 process tests and 91 runtime,
worker and step-control unit tests**, with typechecking and no ESLint errors.

Cancellation follow-up: the connection-loss case reproduced a task reported
`CANCELLED` while its abandoned read attempt remained `RUNNING`. Cancellation now
holds the task and queue-row locks while cancelling queued retries, reconciling
eligible ERP read attempts, appending strict attributed audit evidence, and
settling steps/task. It requires the stable job binding and a cancelled lease;
live leases (including a still-`LEASED` step) remain protected. Unsettled attempts
cannot be hidden by bulk step cancellation. Lost reads become `FAILED` with
`READ_CANCELLED_AFTER_LEASE_LOSS`; no successful result is invented, charged IO
is retained, and neither the read nor its successor is dispatched again.

Two child-process cases combine database-connection loss and cancellation before
and after HTTP dispatch. Eight direct-database controls cover positive/repeated
settlement, stale cancellation, live running/leased steps, mutations, a mismatched
job key, audit failure and missing audit service. Failed auditing rolls back the
queue cancellation, attempt, event and task transition together. The executor
and cancellation dispatcher share the same strict ERP audit writer. Fresh test
tasks initialize their first-start timestamps using database UTC time, avoiding
Windows JavaScript/database clock precision skew without rewriting spent clocks.
The process harness also waits for IPC-send completion and child stream closure:
one positive-control child exited with code 0 before its result reached the
runner, although PostgreSQL showed both its task and job successfully completed.
Error messages are sent before disconnecting as well; an absent result still
fails the test rather than being inferred as success from the exit code.

Cancellation checkpoint (2026-09-04): **40 persistence tests, 16 process tests,
91 runtime/worker/control tests, 156 registry/fast-path/isolation/write-approval
tests and 13 benchmark-harness tests passed**. Backend and recovery-test
typechecking, targeted ESLint and formatting checks pass. These are local
results, not a remote CI run or live-model latency/cost evidence.

Dead-read/claimed-retry follow-up: two real connection-loss cases reproduced
separate failures: a read with its one-attempt ceiling exhausted left an open
attempt beneath a failed task, and a retry claimed before cancellation left the
task stuck `CANCELLING`. Dead ERP reads now revalidate the terminal stable job
and its cleared lease under task/job locks, settle pending attempts as `FAILED`
with `READ_JOB_TERMINATED`, and append strict audit evidence atomically. Already
failed steps with an open attempt can be reconciled when encountered, without
overwriting recorded success, touching host-owned work, or refunding unknown IO.

Cancellation also recognizes the exact worker result `{ skipped: true, reason:
'task is CANCELLING' }` after a reclaimed retry finishes its no-op. Different
reasons or additional effect/result fields cannot authorize reconciliation.
Three new database cases cover these completion results; eleven cover dead-read
ownership, task/job/payload binding, cancelled tasks, prior step failure, audit
rollback and mutation/success exclusions. The process fixture pauses a real
leased retry before its handler, then verifies cancellation, one failed audit
record, unchanged charged bytes and no second HTTP call or successor dispatch.
This checkpoint passed **54 PostgreSQL persistence regressions, 18 process/
interruption regressions and 91 runtime/worker/control tests**, plus backend and
recovery-test typechecks, targeted ESLint, formatting and `git diff --check`.
The one-attempt read fixture is explicitly non-retryable; no job counters or
lease timestamps are rewritten to manufacture exhaustion or recovery.

### Opt-in PostgreSQL process crash/restart

The worker suite has two additional opt-in cases: a real PostgreSQL immediate
shutdown before ERP HTTP dispatch and after the loopback receiver's committed
database mutation. They restart that same cluster, verify a changed postmaster
start time, inspect persisted task/attempt/business state and require no replay,
no successor dispatch and one final attributed `MSAIDIZI_ERP_ACTION_UNKNOWN`
audit record. The first run found that recovery marked attempts unknown without
that final audit row. ERP mutation reconciliation now appends it in the same
transaction; missing/failing audit service rolls back step, attempt, task and
egress-accounting changes. Host action auditing is not relabelled as ERP.

Set `MSAIDIZI_RESTART_PGDATA` and `MSAIDIZI_RESTART_PGCTL` explicitly in addition
to the guarded proof `DATABASE_URL`, then run `npm run test:msaidizi-worker-restart`.
Only a resolved system-temp `msaidizi-chat-proof-<32 hex>/data` directory is
accepted. The helper matches the actual server data directory, loopback address,
port and database and refuses a cluster containing any non-template database
other than `postgres` and the specified proof database. It rechecks before
stopping, restores only its own interruption and refuses ambiguous status.
Do not run another database suite concurrently. Records and restart logs remain
in the temporary cluster for inspection; no shared service/container is stopped.

`npm run test:msaidizi-restart-guards` exercises ten safety cases without creating
subprocesses. CI runs those guards, but the real crash cases remain skipped
unless the explicit cluster opt-in is configured. This is local database/worker
recovery evidence, not production ERP HTTP authorization, a power-loss drill,
full backend restart, device recovery or rollout approval.

Local crash/restart checkpoint (2026-09-04): **56 persistence regressions,
20 process/interruption cases (including both actual PostgreSQL crashes),
10 restart-safety guards and 91 runtime/worker/control tests passed**. Backend
and recovery-test typechecks, targeted ESLint, formatting and diff checks passed.
The disposable cluster was restored after each crash; no mutation or successor
was replayed, and both recovered attempts received exactly one `UNKNOWN` audit.

Fixture rows and ledgers remain available for inspection. Remaining acceptance
includes additional server-crash/read/cancellation combinations, interruption
before ERP commit or response receipt, kill-switch/outage recovery, broader network partitions,
companion/workstation restarts and signed Windows VM/ring drills.
No activation switch or production deployment is changed by this suite.

### Authenticated task API and backend restart proof

Run `npm run test:msaidizi-task-api-restart` against a separately migrated database
named `msaidizi_chat_proof_api` (or that name plus an alphanumeric suffix), using
the exact loopback host `127.0.0.1` in `DATABASE_URL`. Do not run concurrent suites
against that database. The fixture seeds uniquely named actors, permissions,
companies and expenses; rows and audit records are retained. CI provisions this
separate database and runs the suite after the worker proof.

Each case authenticates its seeded actors through the real login endpoint before
starting. The owned backend issues finite five-minute access tokens, asserted by
the fixture, independently of a developer `.env`. The same token is retained
through every backend restart within that case. There is no automatic action
retry or mid-case refresh on 401; a permission/authentication failure remains a
failure. This keeps a long complete suite from depending on one suite-wide login
without disabling expiry or changing production authentication.

The fixture boots the real `AppModule` in an owned child process, signs in through
the actual authentication endpoint, and plans/queues/pauses/resumes tasks over
HTTP. Execution uses the real dispatcher, worker, task JWT issuer, permission
guards, expense controller, Prisma storage and strict action audit. It kills and
restarts only that owned backend child, not an existing server. Cases cover:

- Persisted pause and immutable plan versions across restart, followed by one
  successful company-scoped expense read and one correctly attributed action
  audit. A second restart preserves results, first-start time and monotonic event
  cursors; another dispatch does not execute the completed step again.
- Missing authentication, another owner's detail/event/cancel requests,
  inaccessible company context, and missing plan-time expense permission.
- Expense permission revoked after queueing and before restarted execution,
  without returning the protected expense data.
- Cancellation before dispatch surviving restart, rejecting resume/requeue,
  and producing no job or tool attempt.
- A real authenticated draft-expense create positive control, followed by a
  second create whose successful HTTP response is held in memory before task
  settlement. After confirming the committed expense, the test requests
  cancellation and kills the backend. Restart and natural lease expiration must
  produce `NEEDS_ATTENTION` / `UNKNOWN`, preserve the attempt and counters, and
  retain exactly one expense and correctly attributed ERP/recovery audits. The
  successor is cancelled without execution. Another restart must not replay it.
- A read-only routine created and explicitly activated over the authenticated
  API, including oversight denial and another owner's read denial. Backend
  restarts before scheduling and before execution preserve its immutable input
  binding, reviewed mandate/schedule versions, company scope, budgets and audit
  attribution. Repeated dispatch must leave exactly one task and one attempt.
  The fixture pauses the routine and revokes its mandate afterward, retaining
  its evidence.
- Two result-dependent routine controls: a successful expense-list read feeds
  one verified expense ID into the already-reviewed detail step after restart.
  With the mandate still active, the detail read must complete. With authority
  revoked through the real API between steps, its attempt must be rejected
  without a second ERP invocation; the completed first result remains intact.
  Both retain value-free dependency provenance, source-attempt/digest links,
  `UNTRUSTED` data classification and `instructionAuthority: false`.
- Scripted adaptive continuation and adversarial-replan cases run through the
  real reasoning checkpoint worker, parser, critic and outcome evaluator.
  Checkpoint IDs exist before generation and their jobs have `maxAttempts: 1`.
  Restarts retain decisions, token/cache usage and charged cost without replay.
  An unreviewed step key is rejected by the critic without creating a new plan
  or dispatching the pending ERP step. This is deterministic boundary evidence,
  not evidence of live-model intelligence or real provider billing.
- A positive adaptive replan narrows three reviewed read steps to one remaining
  step, retaining its `PLAN_INPUT` binding in immutable plan version 2. Backend
  restarts before reasoning, before executing that version, and after completion
  retain arguments, source-plan inputs, provenance and usage. Exactly two ERP
  calls execute; the completed source and skipped fallback never replay.

**Evidence boundary:** the test substitutes CRUD release admission, rejects all
cloud-provider requests, and bypasses rate limiting using the existing E2E helper.
It is not signed CRUD release evidence, exhaustive ERP CRUD coverage, a live-model
benchmark, or a production rollout approval. Task admission and manual worker
ticks are enabled only in the child process's in-memory configuration. The
interruption case explicitly enables amber expense-create permission there;
other cases retain the read-only ceiling. A two-second test-only stale-lease
window permits natural lease expiration during backend restart; persisted
lease timestamps are not rewritten to force recovery.
Host execution, device channels and automatic dispatch remain off. The routine
case explicitly enables Autopilot only inside the owned disposable child;
combining that fixture mode with write permission is rejected. Only the scripted
adaptive cases enable reasoning; all provider network calls remain forbidden.
Other cases leave adaptive
reasoning disabled.
The test-only invoker wrapper calls the real invoker before withholding its
successful result; it never fabricates HTTP success or an ERP mutation. This
proves the post-response/pre-settlement backend interruption window, not every
point during an ERP transaction, response loss, or device/workstation recovery.
The separate worker/database crash suite covers some other interruptions with
its explicitly narrower fixture boundaries.

Local checkpoint (2026-09-04): **all five authenticated task-API restart cases
passed**, including the post-commit interruption and second recovery restart,
against PostgreSQL 17 with all 144 migrations applied. Recovery-fixture type
checking, targeted ESLint, formatting and diff checks passed; the benchmark
client/scorer's **13 regressions passed** too. CI YAML parsing was verified when
the existing task-API step was added; that step automatically includes this case.
The CI step is wired but has not been executed remotely as part of this checkpoint.

The routine proof exposed an actual ERP action-digest mismatch: immutable
numeric query inputs were signed as JSON numbers, but the exact-action guard
correctly compared the HTTP strings. Static and bound ERP inputs now use the
existing HTTP-envelope digest for task JWT scope. Arguments and their provenance
remain typed; host action digests and the v1 egress adapter receipt contract are
unchanged. Regression controls cover changed page values, typed JSON bodies,
malformed ERP envelopes, host payloads and typed egress receipt inputs. No
permission check or incoming-action digest comparison was relaxed.

Routine API checkpoint (2026-09-04): **all six authenticated restart cases
passed** against the isolated PostgreSQL 17 API database, including the real
routine execution and existing uncertain-mutation recovery. **109 targeted
binding/runtime/token/guard/host-boundary unit tests passed**; the subsequent
invoker/egress/runtime pass had **76 passing tests** (overlapping runtime tests,
not additive). This remains local integration evidence with synthetic release
admission, not live-model, signed-release, workstation or remote-CI evidence.

The dependent-read positive control exposed another persistence defect:
`DEPENDENCY_OUTPUT` rehashed the original JSON encoding after PostgreSQL JSONB
had reordered its object keys. New bounded observations retain their original
`sourceSha256` byte evidence and additionally store a versioned canonical JSON
value digest. Dependency resolution verifies that canonical digest and records
its algorithm in provenance. Array order, scalar types and all values remain
significant. Redacted observations, malformed/unknown digest protocols and
changed values still fail closed. Large observations keep their existing
encrypted-artifact byte-digest path. Legacy observations retain the exact-byte
check; no historical rows are backfilled or newly attested. This correction
applies to both ERP and host observation producers, without enabling host work.

That same positive control then exposed a task-finalization boundary bug:
both reads succeeded, but using exactly two of two allowed calls produced
`TOOL_BUDGET_EXHAUSTED`. The dispatcher now lets the final reserved call settle
and lets an all-successful plan at the exact ceiling pass its existing adaptive
outcome gate before completion. It does not dispatch another step at the
ceiling, accept counters above it, or bypass a blocked outcome evaluation.

Dependent-routine checkpoint (2026-09-04): **all eight authenticated API restart
cases passed** together against PostgreSQL 17 after both fixes. The canonical
value change passed **101 binding/observation/runtime/host-boundary unit tests**
and **26 adaptive-reasoning/media/memory tests**. After the budget-boundary fix,
the runtime suite passed **59 tests**, including seven new ceiling controls
(overlapping the earlier runtime count). Type checking, targeted lint,
formatting and diff checks passed. All fixture evidence remains in the isolated
database; its owned PostgreSQL process was stopped afterward. No production,
cloud-model, host or remote-CI execution is established by this checkpoint.

The adaptive positive control exposed the equivalent model-budget boundary:
two successful, persisted `CONTINUE` turns at a two-turn ceiling could not
complete. The adaptive gate now accepts a fully successful plan whose every
step has a durable successful continuation at the exact turn/cost limit, and
waits for an already-running final turn. Missing evaluations, pending work,
unapproved decisions and actual overages still block. Provider reservation
limits are unchanged. The scripted usage includes cache input, and the test
reconciles task totals against the persisted per-turn costs after restart.

Adaptive API checkpoint (2026-09-04): **all ten authenticated API restart cases
passed** together with the final restart/usage assertions. **97 adaptive,
critic, media and task-runtime unit tests passed**, including ten model-turn
and cost-ceiling controls. Type checking, formatting and diff checks passed;
targeted lint had no errors (the adaptive unit fixture retains its existing
`any` warnings). The generation-persistence review informed the pre-call ID,
durable retrieval, usage and replay checks; it did not change storage providers
or relax the prohibition on persisting raw credentials. The owned local
PostgreSQL process was stopped with all test records and audit evidence retained.
Scripted usage is not real provider cost evidence or production approval.

### Replan binding preservation — 2026-09-04

Adaptive replanning previously copied pending steps without their input
bindings. New versions now retain those definitions in the persisted rows and
plan digest. The critic validates the retained graph against immutable plan
inputs before accepting it, using the same strict persisted-binding parser as
execution. Model-supplied read fills cannot overwrite a bound placeholder;
malformed definitions cannot become new reviewed authority. Pending-to-pending
dependencies retained in the new version remain valid.

At this checkpoint completed prior-plan dependency sources were rejected with
`REPLAN_PRIOR_PLAN_BINDING_REQUIRES_LINEAGE`, instead of losing their bindings.
The following cross-plan checkpoint supersedes that temporary limitation for
verified dependency results; it does not imply complete autonomous replanning.

Replan checkpoint (2026-09-04): **all 11 authenticated API restart cases passed
together** against the isolated PostgreSQL 17 database (302 seconds). **223
targeted unit tests across seven suites and 13 benchmark client/scorer checks
passed**, including all seven resident benchmark routes, spending dispatch
limits, permission isolation, runtime budgets, and binding preservation and
rejection controls. Worker/API fixture type checking, targeted lint, formatting
and diff checks passed; the adaptive unit fixture retains 11 existing `any`
warnings. Generation-persistence guidance informed the restart/no-recharge
assertions, without changing UUID/PostgreSQL storage or credential restrictions.
The owned database was stopped after verification, retaining records and audits.
No live-model, provider-cost, remote-CI, host or production rollout evidence is
claimed.

### Cross-plan dependency lineage — 2026-09-04

Migration `20260904110000_msaidizi_dependency_lineage` adds server-owned
`dependencyLineage` metadata to immutable step definitions. Public plan DTOs do
not accept it. A database trigger refuses rewrites, including clearing the pins;
no historical rows are backfilled beyond the empty compatibility default.

Adaptive replans pin completed dependencies to their original task, plan, step,
attempt, argument digest and typed-canonical digest of the full persisted result.
Pins are included in the new plan digest, preserved and checked during later
replans, and verified again during input resolution. Wrong-task, current/future
plan, failed/uncertain/replaced attempt, changed data class and changed result or
argument digests fail closed. A known model response remains accounted for if
lineage capture rejects the plan. The model cannot choose arbitrary historical
attempts or replace binding definitions.

The authenticated cross-plan positive control carries the expense ID from a
successful list read in plan 1 into the reviewed detail read in plan 2, across
backend restarts. Source/target plan IDs and exact source attempt remain in
value-free `UNTRUSTED` provenance with no instruction authority. The original
read and skipped fallback never replay. Both replan controls also exercise the
real PostgreSQL lineage immutability trigger.

Evidence remains local and read-only for this flow, with synthetic release
admission and scripted model decisions. At this checkpoint host artifact content
materialization still required a same-plan source. The next checkpoint extends
that independent artifact-service boundary. No host/provider/production rollout
gate is enabled here.

Lineage checkpoint (2026-09-04): **all 12 authenticated API restart cases passed
together** (356 seconds), against PostgreSQL 17 with **145 applied migrations**.
**263 targeted unit tests across nine suites passed**, including 15 new lineage
capture/verification/resolution controls and known-usage rejection accounting.
Public API rejection of supplied lineage and database-trigger rejection of
rewrites passed through the real integration fixture. Type checking, formatting,
diff checks and targeted lint passed; the adaptive fixture retains 11 existing
`any` warnings. Generation-persistence guidance informed the durable decision,
usage and no-replay checks, not a change of storage provider. The owned database
was stopped after verification; records and append-only audit evidence remain.
The other disposable proof database has not yet received migration 145. Run
the normal migration command against that isolated target before its next suite.

### Cross-plan host artifact preparation — 2026-09-04

The artifact service now permits a historical source only through the receiving
HOST step's immutable lineage and exact reviewed `DEPENDENCY_ARTIFACT` binding.
The request cannot choose a historical plan ID. The service rechecks the pinned
source attempt/result, data class, active Autopilot task and step, target device,
artifact identity/provenance and encrypted content digest. Explicit artifact
selection and an unambiguous single-artifact source are supported; an omitted
pin retains the same-plan query restriction. Task/step I/O budgets are reserved
before decryption. The companion envelope and its target-plan scope are unchanged.

The local fixture uses real AES-GCM-encrypted files and exercises input resolution
through artifact reauthorization/decryption into the governed host-action
envelope, retaining source/target plan provenance without persisting content in
that provenance. Database queries and budget CAS responses are mocked here.
Cases cover same-plan compatibility, both cross-plan selection forms, absent
lineage, wrong device/attempt/data class/artifact, ambiguous selection, removed
bindings, uncertain/changed source results and prohibited host-file artifacts.
This is backend preparation evidence, not a real device/channel, email/upload,
Windows process recovery or production rollout test.

Host-preparation checkpoint (2026-09-04): **163 targeted tests across seven
suites passed** with the final HOST-only target query, including the composed
resolver/decryption controls. Worker/API type checking, targeted ESLint,
formatting and diff checks passed. Temporary encrypted fixture files were
cleaned up; no database, companion, device channel or external delivery was
started for this checkpoint. Actual database/device integration and Windows
recovery acceptance remain separate rollout requirements.

### Artifact PostgreSQL/process proof — 2026-09-04

`npm run test:msaidizi-artifact-restart` runs against the dedicated loopback
`msaidizi_chat_proof_api` database (all migrations applied, with the same
`DATABASE_URL` guard as the task-API proof). Its artifact-only child process
loads the real Prisma service, binding resolver and artifact service. It does
not start AppModule, HTTP, a model, a worker timer or a device channel.

Source task/plan/attempt/artifact states are directly seeded; encrypted fixture
files are real. The proof covers cross-plan resolution after killing and
restarting the child, exact task/step byte charges retained after reconnect,
and two independent processes competing for a one-read budget. Only one may
decrypt successfully. Cancellation, wrong attempt/task and non-HOST targets
must return no content and charge no bytes. A zero step budget must roll back
the task reservation in the same real PostgreSQL transaction. No host action
or delivery is created, and the original attempt is not executed again.

**All seven integration cases passed** together (39 seconds) against PostgreSQL
17 with 145 migrations. Fixture type checking, targeted lint, formatting, diff
checks and CI YAML parsing passed. CI now runs this suite after the task-API
proof, but remote CI was not executed here. Temporary encrypted files and keys
are cleaned up; database fixture records remain. The owned PostgreSQL process
was stopped afterward. This proves the artifact preparation/storage boundary,
not HTTP authorization, actual source capture, whole-task ledger completion,
companion execution, external delivery or workstation recovery.

### Executor-aware reasoning context — 2026-09-04

Runtime checkpoints now describe executor-managed input targets separately from
missing model-supplied read arguments. This value-free projection identifies
the locked target, expected type, transform and source kind; completed sources
pinned to a prior plan are explicitly distinguished from current dependencies.
It does not copy source values/paths, schema constants, secret-reference handles,
artifact handles, historical attempt IDs or result digests into this projection.
Malformed metadata blocks new checkpoint dispatch before a model reservation.
The existing execution-time binding, provenance and permission checks remain
authoritative; these model-facing hints do not grant additional authority.

A positive regression reproduced `REPLAN_FILL_SCHEMA_MISMATCH` when a legal
unbound read parameter was filled beside a reviewed null binding. The critic
now validates the resolved shape using the existing bound-capability validator
on a clone. Persisted placeholders and bindings remain unchanged, while wrong
types, undeclared fields, changed bound targets and missing authority still fail.
Both current and completed dependency sources retain their binding authority.

The new `binding-fill` API/restart case uses real authentication, PostgreSQL,
ERP execution and audit attribution with a scripted model. It combines a bound
page with a planner-added limit, creates an immutable narrowed plan, restarts
the backend and requires exactly two tool calls/two model turns, no fallback
execution and no replay. The focused integration case passed. **155 targeted
runtime/binding tests, 118 registry/fast-path/write-approval tests and 13 benchmark
harness tests passed**. This is deterministic execution evidence, not live-model
selection, answer quality, latency, provider billing or Windows rollout evidence.
No provider integration, privilege ceiling or activation setting was changed.

The full API/restart suite subsequently passed **all 13 cases together**
(436 seconds), including live permission revocation, persisted cancellation,
committed-expense recovery and both cross-plan binding variants. Worker/API
type checking, targeted ESLint (11 existing adaptive-fixture warnings),
formatting and diff checks passed. The owned disposable PostgreSQL process was
stopped after verification, retaining fixture records and audit evidence. Remote
CI and live-provider benchmarks were not run.

### Interrupted reasoning recovery — 2026-09-04

A new ownership regression reproduced a dead job naming another task's turn:
recovery updated that foreign turn using its ID alone. Dead-turn reconciliation
now validates the protocol and task payload, locks the owning task, requires the
active task/plan/checkpoint relation, and revalidates the exact stable dead job
under the task-to-job lock order. A live lease owner, changed payload, wrong job
key, stale plan or mismatched checkpoint cannot settle the turn. The final CAS
also binds task, plan and checkpoint; cost and token reservations are not refunded.

The API fixture's `model-crash` case enters the scripted ModelClient after the
real database reservation, then kills that exact AppModule child before any
result or usage is supplied. After restart the same turn becomes `FAILED`, the
task becomes `NEEDS_ATTENTION`, and its reserved cost remains charged. A further
restart must retain one reasoning turn, one completed ERP read, no successor
attempt and one lease-loss event. The focused process case passed (73 seconds).
This proves backend reservation/recovery behavior, not an actual provider call,
provider cancellation, billing reconciliation or Windows recovery.

Eleven real PostgreSQL controls cover concurrent one-time settlement, cancelled
task preservation, foreign references, stable keys, protocol, live owners, stale
plans, checkpoint mismatch, settled turns and atomic rollback on notification
failure. **All 71 persistence cases and 142 runtime/worker/critic unit tests
passed**, with type checking, targeted lint (11 pre-existing fixture warnings),
formatting and diff checks. These cases run in the existing CI suites; remote CI
was not run. The full 14-case API suite was not rerun at this checkpoint; the
preceding 13-case result above remains a separate historical run. The owned
PostgreSQL process was stopped, retaining fixture records and append-only logs.
No model provider, deployment setting, privilege boundary or ring was activated.

### Cancellation of in-flight reasoning — 2026-09-04

The `model-cancel-crash` process regression first reproduced a cancelled task
with its reserved reasoning turn still `RUNNING`. Cancellation now settles the
exact task/plan/checkpoint-bound turn and ends its owned queue lease in the same
transaction as remaining-step cancellation. The worker heartbeat then aborts a
live model request. Unknown usage retains its reservation; no response, actual
usage or provider refund is invented. An unmatched open reasoning turn prevents
the dispatcher from reporting clean task cancellation. Foreign payloads, wrong
stable keys, successful turns and non-cancelling tasks remain protected.

Ten new PostgreSQL controls cover queued/running/dead/cancelled jobs, missing or
mismatched authority, completed turns, concurrent cancellation and transaction
rollback. **All 81 persistence tests and 125 runtime/adaptive/worker tests passed**.
The API suite's four `restart: model-` cases passed together (231 seconds): an
ordinary model-call crash, cancellation before a crash, cancellation delivered
to a live call, and a scripted response arriving only after its abort signal.
Each retains one model turn and one completed ERP read, with no successor or
replay after restart. The three cancelled cases preserve terminal cancellation;
the non-cancelled crash remains `NEEDS_ATTENTION`. The full 17-case API suite was
not run at this checkpoint. Type checking, targeted lint, formatting and diff
checks passed; remote CI, real-provider abort and billing reconciliation were
not exercised. Late-response handling retains the conservative reservation.

Keep direct-state persistence fixtures in a different database from the API
suite: their deliberately inconsistent jobs can be found by AppModule's global
dispatcher. The first rerun hit such an unrelated fixture. A fresh dedicated
`msaidizi_chat_proof_api_cancel` database with all 145 migrations isolated the
API proof; earlier records and audit ledgers were retained, not rewritten. The
owned PostgreSQL process was stopped after verification. No live activation or
Windows rollout is implied.

### Idempotent response accounting — 2026-09-04

A PostgreSQL regression reproduced duplicate usage reconciliation: two calls
for one cancelled turn doubled its token counters and subtracted the same
reservation twice. Reconciliation now uses the existing append-only
`reasoning.model_call_accounted` event as its receipt under the owning task row
lock. It validates the persisted turn/reservation, refuses conflicting receipts
or unexplained existing counters, and returns without another adjustment on an
identical replay. Zero-usage receipts are distinguishable from unaccounted turns.

Valid provider usage is now persisted before response parsing or an aborted
checkpoint can discard a late reply. Cancelled tasks/turns are not revived, and
malformed late replies cannot overwrite cancelled turns as failures. Only known
usage reconciles the original reservation; genuinely missing usage still keeps
the conservative charge. Reported cost uses the existing configured server
rates, not a newly verified provider invoice. No response text is copied into
the accounting receipt.

All **90 persistence cases** passed, including nine receipt controls for replay,
zero usage, foreign ownership, reservation mismatch, absent reservation,
conflicting/missing receipts, transaction rollback and overflowing token totals.
All **143 runtime/adaptive/worker/critic tests** passed. The focused late-response
API/restart case passed with exactly one receipt, known token counts and cost,
unchanged cancellation, and no subsequent tool execution. Type checking,
targeted lint (11 existing fixture warnings), formatting and diff checks passed.
These are local scripted-provider proofs, not live billing or rollout evidence.

The full API/restart suite then passed **all 17 cases together** (563 seconds),
including ordinary adaptive/replan paths and the four model-interruption cases.
The disposable API and direct-state persistence databases remained separate.
The owned PostgreSQL process was stopped afterward, retaining records and audit
events. No schema migration, provider contract, activation flag or Windows
boundary was changed. Queued reasoning checkpoint pause/resume was the next
dedicated acceptance gap at that checkpoint; the following proof addresses it.

### Unstarted reasoning pause/resume — 2026-09-04

The new authenticated `queued-pause` case first reproduced a stranded task:
pause cancelled its job, but its reasoning turn remained `QUEUED` indefinitely
after resume. Pause now persists an explicit no-call marker and waits for claimed
reasoning workers before publishing `PAUSED`. A worker observing pause before
reservation returns a matching no-call result without cancelling its turn.

On explicit resume, the adaptive gate locks the task and canonical job, verifies
task/plan/checkpoint ownership, and requires an unstarted queued turn, zero
reservation and usage, no call receipts, zero job attempts, no lease owner,
`maxAttempts: 1`, and exact pause evidence. Only that original job is requeued;
turn/job identity, input digest and budgets are preserved. Invalid evidence
becomes `NEEDS_ATTENTION`; reserved or uncertain model invocations are never
retried by this path. The resume event and job transition commit atomically.

The HTTP restart regression passed with exactly two ERP reads and two scripted
reasoning calls across pause/resume and process restarts. The original completed
read was unchanged. All **105 persistence tests** passed, including 15 new cases
covering queued and claimed no-ops, concurrent resume, stale plans, foreign
ownership, reservations/receipts, mismatched jobs, active leases, attempted work,
non-pause completion/cancellation and transaction rollback. All **146
runtime/adaptive/worker/critic tests** passed, including pause winning the
reservation lock. Direct-state fixtures and real API fixtures use separate
disposable databases.

The combined targeted HTTP/restart run passed **5 cases** (308 seconds): queued
pause plus model crash, cancel-after-crash, live cancellation, and late response.
The other 13 API cases were not rerun in this checkpoint. Fast-path/conversation
tests passed **105 cases**, and registry/isolation tests passed **72 cases**,
including the seven benchmark prompt mappings and spending call-limit controls.
Type checking, targeted lint (11 existing fixture warnings), formatting and
diff checks passed. The owned PostgreSQL process was stopped after verification;
both disposable databases and their audit histories were retained.

This is an unstarted-checkpoint proof, not a claim that pausing an already-running
model call is complete. That was the next dedicated acceptance case. The
existing database-backed worker architecture is retained; no Workflow SDK,
provider change, schema migration, live model call, host activation or Windows
rollout was introduced.

### Active reasoning pause settlement — 2026-09-04

An already-reserved reasoning call can now settle while its task is `PAUSING`.
CONTINUE records the checkpoint; REPLAN commits the immutable narrowed DAG
without restoring `RUNNING` or leasing its steps. A terminal STOP can finish the
current task and skip remaining work. The task lock, current plan, current
principal/mandate authority and global kill switch are checked before applying
a decision. A late decision cannot rewrite an already-cancelled turn.

Known malformed output and unknown provider failures now surface as
`NEEDS_ATTENTION` during pause instead of being hidden behind `PAUSED`. Pause
cleanup also reconciles dead reasoning jobs before publishing `PAUSED`, since
it bypasses the ordinary adaptive gate. Unknown usage keeps its reservation;
this path never retries the model call.

The real HTTP/restart `model-pause-live` and `model-pause-replan` cases passed
together (212 seconds). Each holds the scripted provider after the real durable
reservation, requests pause, checks that the worker remains in flight, then
allows its response. After restart, the task remains paused with one model call
and one ERP read; explicit resume completes with exactly two of each. Replan
also retains the original dependency lineage and immutable plan history.

All **107 persistence cases** passed, including paused dead-call recovery and
atomic rollback when its notification/ledger transaction fails. All **155
runtime/adaptive/worker/critic tests** passed. New unit cases cover continue,
replan, stop, malformed output, provider failure, revoked authority, kill,
cancellation and an already-paused task. STOP and provider-error pause outcomes
are unit evidence here, not additional HTTP acceptance cases.

The subsequent targeted HTTP run passed **6 cases** (343 seconds): queued
pause, pause-plus-model-crash, model crash, cancellation after crash, live
cancellation and late response. The new pause/crash case reaches
`NEEDS_ATTENTION` with the original reserved charge, one model turn, no later
ERP read and no replay across another restart. Together with the two positive
active-pause cases, **8 distinct HTTP cases** were verified this checkpoint;
the other 13 API cases were not rerun. Type checking, targeted lint (11 existing
fixture warnings), formatting and diff checks passed. The owned PostgreSQL
process was stopped, retaining both separate proof databases and audit records.

These remain local scripted-provider proofs, not live cloud, workstation or
rollout evidence. No dependency, migration, provider setting or activation flag
was changed. The next durability checkpoint was a crash after the reasoning
decision commits but before its worker job settles, verified below.

### Decision committed before worker settlement — 2026-09-04

Three new real API/process-restart cases passed together (214 seconds):
`decision-commit-crash`, `decision-commit-replan`, and `decision-commit-pause`.
The fixture wraps the registered reasoning handler and holds only after the
real handler returns its committed successful decision, before the worker's
job-completion CAS. The parent verifies a succeeded reasoning turn, exactly one
usage receipt/completion event, and the still-running original worker job, then
kills only its owned backend child.

Restart preserves the exact turn and existing cursor-addressed audit events.
The abandoned worker lease becomes `DEAD_LETTER`; the already-committed model
decision is not relabelled as an unknown call and no model retry is scheduled.
Each task finishes with exactly two model calls and two ERP reads. The replan
case preserves immutable plan/dependency lineage; the pause case remains paused
with one model call and one ERP read until explicit resume. These assertions
prove the committed decision survives the job-settlement gap, not that a worker
whose process died successfully completed its own queue bookkeeping.

No runtime change was required for these three cases. Type checking, targeted
lint, formatting and diff checks passed after correcting the new test's event
lookup to use its real cursor key. The other 21 API cases were not rerun in this
checkpoint. The disposable API database remains distinct from direct-state
fixtures; both databases and their audit records are retained after stopping
the owned PostgreSQL process. No provider call, signing or activation occurred.

A separate read-only inventory of the current extracted manifest found positive
fixture registrations for every discovery-eligible operation. It supplied no
execution artifact and therefore proved no release qualification. The next
larger delivery gap is running the complete real CRUD matrix against this source,
keeping unsigned diagnostic results distinct from accepted signed release
evidence and leaving the parking/activation gates unchanged.

### Complete API restart and client regression checkpoint — 2026-09-04

All 24 authenticated API/process-restart cases passed together without Jest cache
in 1,020.029 seconds against a fresh, separate PostgreSQL 17 database with all
145 migrations. This combined run covers the original ownership/permission and
uncertain-write controls alongside dependent routines, replan lineage, executor
bindings, queued/active pause, abandoned model calls, committed decisions before
worker settlement, and crash/live/late-response cancellation. It replaces the
previous separate-group results only for this local integration scope; it does
not establish device, provider or signed-release acceptance.

The first combined attempt passed 18 cases, then failed six with HTTP 401 after
its suite-wide login reached the local 15-minute access-token lifetime. The
fixture now logs in per case and asserts a five-minute lifetime. The successful
17-minute rerun therefore outlived multiple token lifetimes while preserving one
session across each case's restarts. No production auth code, expiry setting,
permission rule, task retry policy or execution gate was changed.

Recovery-fixture type checking, targeted ESLint, formatting and diff checks
passed. All 364 Msaidizi frontend tests across 22 files also passed, covering
client/component behavior including task controls, reconnectable events and
multimodal capture boundaries; these are not live browser, microphone or device
tests. The successful API database retained 25 tasks in their expected states
and 19 paused routines, with no active test clients after teardown. Both the
initial diagnostic database and the successful rerun database, including audit
records, were retained after stopping the owned PostgreSQL process. No provider
request, production signing, deployment or Windows activation occurred.

### Complete unsigned CRUD diagnostic checkpoint — 2026-09-04

The new `npm run diagnostic:crud` runner completed the full no-cache loopback
matrix against an isolated schema in a dedicated local PostgreSQL 17 database.
All 145 migrations applied. The Jest suite passed in 991.66 seconds; all 1,091
recorded cases passed: 1,084 positive operation controls, three permission
denials, one company-isolation control, one audit-attribution control, and both
service-principal task-scope lanes. The suite also checked exact equality between
positive fixture capabilities and every discovery-eligible operation, and
required a machine-readable reason for every ineligible operation.

This is a historical local diagnostic checkpoint, not current release coverage.
Its run ID is `crud_evidence_d8517068-dbc4-498c-a21f-e79ef9780dbd`, generated at
`2026-09-04T13:41:10.169Z`. The parent confirmed unchanged execution inputs and
Prisma migrations and independently validated the unsigned payload. The owned
schema was removed and a separate database query confirmed no evidence schema
remained; logs and the unsigned payload were retained outside the checkout.
Subsequent documentation/package-script edits change the execution-bundle digest;
release evidence must be regenerated against the final reviewed source.

No runtime admission was relaxed to obtain this result. The first runner launch
failed during migration because its generated schema name exceeded PostgreSQL's
identifier limit; shortening the diagnostic-only prefix and adding a regression
resolved that setup error. The successful run used one fresh schema throughout.
No production signing key, live provider, Windows device, deployment or Autopilot
activation was used. See `../CRUD_EVIDENCE.md` for diagnostic usage and the
separate protected signed-release procedure.

Follow-up verification passed: 16 evidence/diagnostic runner tests and 156 tests
across measured fast paths, the registry, human write approvals and isolation.
These include all seven resident benchmark mappings and the scripted spending
dispatch checks: expenses first, no unrelated parallel read, and at most two
attempts even when the model requests a third. This does not replace the live
provider benchmark or establish current model latency/cost. Formatting and diff
checks passed. The owned PostgreSQL process was stopped; its databases and the
external diagnostic files remain available, but the temporary fixture schema
and its test rows were deleted as intended.

### Checkpoint — 2026-09-04

- Existing registry, measured-path, isolation and write-path suites: **156 passed**.
- Conversation retention/approval and write-path suites after the fix: **135 passed**
  (the write-path suite overlaps the preceding count).
- New real HTTP/PostgreSQL suite: **12 passed**; benchmark scorer: **6 passed**.
- The workflow found a real approval failure under `Africa/Nairobi`: the raw SQL
  sweep compared UTC `timestamp` expiry columns to `timestamptz now()`, deleting
  an unexpired 30-minute grant before its confirmation request. All retention
  comparisons now use the database clock expressed in UTC. Real database tests
  cover valid/expired grants, resume state, retention and deletion grace under
  Nairobi, UTC and Los Angeles timezones.
- The expense positive control creates TZS 12,500, confirms submission and
  approval, verifies exactly one posted two-line journal and one open payable,
  checks the initiating user/company/session on all three expense audit rows,
  refuses reused approval dispatch, and retrieves the created expense with one
  measured read. Permission and company-denial controls leave expenses unchanged.
- **Live model benchmark not rerun.** This checkout lacks the signed provider
  contract paths/identity configuration required by the current model client.
  An API key alone is insufficient. No current live latency, answer-accuracy or
  monetary-cost claim follows from the scripted suite.

The next delivery gate is the seven-case live benchmark, with
`MSAIDIZI_BENCHMARK_REQUIRE_FAST_PATH=true`, against an approved test deployment
with valid provider-contract evidence. Review the answers against its fixture
records as well as the trace metrics before proposing chat write-mode activation.
Windows autonomy remains parked under the September 2 decision.

Staging now has an explicit read-only chat overlay with required provider inputs
and fixed execution ceilings. Follow the **Staging chat benchmark** section in
`MSAIDIZI_PROVIDER_CONTRACT_RUNBOOK.md`. The base staging/production configuration
is unchanged; Compose validation is not a live-model benchmark or deployment.

## tool-search-compare.mjs

Answers one question: **does tool search actually find the right tool?**

Seven questions, each with an expected tool. Two are controls with direct
vocabulary matches — if those regress, search is worse rather than differently
wrong. The rest are cases lexical overlap structurally cannot solve, because the
user's words share no token with the schema: "who owes us money" against
`receivables`, "what do we owe our suppliers" against `payables`.

Expectations resolve against the live capability list rather than hardcoded
names. A stale name would otherwise make every case look like a search failure
when it is really a broken test, and that mistake is invisible in the output.

The spending case is also a path-quality gate: `Expenses_findAll` must be the
first dispatched tool and the run may dispatch at most two tools. The original
search run eventually found expenses but used eight tools across four turns;
"eventually correct" is not enough for this common question.

```bash
docker compose up -d postgres redis
# MSAIDIZI_TOOL_SEARCH=false, restart backend
node backend/test/benchmarks/tool-search-compare.mjs baseline.json
# MSAIDIZI_TOOL_SEARCH=true, restart backend
node backend/test/benchmarks/tool-search-compare.mjs search.json
node backend/test/benchmarks/tool-search-compare.mjs --diff baseline.json search.json
```

Run mode exits non-zero unless all seven cases pass. For the spending case,
"pass" also means `Expenses_findAll` was dispatched first and no more than two
tools were dispatched, so a correct answer reached through the old eight-call
thrash is a failure rather than a soft warning.

For a low-cost trace check while iterating on that regression, set
`MSAIDIZI_BENCHMARK_CASE=spending`; the same first-tool and two-call ceiling
remain enforced, while the other six prompts stay covered by the deterministic
resident-set regression suite.

The flag is read server-side, so the backend must restart between runs. Roughly
14 model turns per pass.

---

## Result — 2026-08-20, `claude-opus-5`, effort `medium`, read-only, 538 permitted

### Tool selection: 7/7 with search, 3/7 with narrowing

| case | narrowing | search |
|---|---|---|
| direct-customers | hit | hit |
| direct-suppliers | hit | hit |
| low-stock | hit | hit |
| **owes-us** | **no tools called at all** | `Receivables_findAll` |
| **unpaid-bills** | **no tools called at all** | `Payables_findAll` |
| **we-owe** | `FinancialReports_getSupplierAging` | `Payables_findAll` |
| **spending** | `BidComparisons_findAll` | `Expenses_findAll` |

**4 better, 0 worse, 3 same.** The controls held, so this is a real gain rather
than a different kind of wrong.

Two failure shapes are worth separating. `owes-us` and `unpaid-bills` called
**nothing** — narrowing offered 60 tools and not one of them looked like an
answer, so the agent answered from an empty toolbox. `spending` reaching
`BidComparisons_findAll` is worse than nothing: it is confidently in the wrong
part of the system. Both are what lexical overlap does when the user's
vocabulary and the schema's do not meet.

`we-owe` under narrowing is the interesting near-miss. `getSupplierAging` is a
defensible answer to "what do we owe our suppliers" — arguably the better one —
so the regex scored it a miss where a person might not have. Worth remembering
when reading a single number.

### Cost: search is 2x slower and uses 9.5x more uncached input

| | narrowing | search |
|---|---|---|
| avg latency | 11,090 ms | **22,651 ms** |
| uncached input | 6,817 | **64,633** |
| cache reads | 49,200 | **137,116** |
| cache writes | 30,092 | 4,897 |
| output | 3,735 | 6,349 |
| model turns | 13 | 20 |

Search buys correctness and pays in latency and input tokens. The search
round-trips and the tool sets they return are themselves tokens, and the extra
turns are where the seconds go. For a manager asking a considered question that
is a good trade. For a counter clerk wanting a number in two seconds it is not —
one more reason the Kaunta path stays out of this.

### Correction: caching was not "never working"

The commit that introduced tool search claimed prompt caching had never worked.
That was too strong. Narrowing builds the tool block once per **run**, so turns
2+ within one run already cached — 49,200 reads on the baseline pass proves it.

What was broken was caching **across requests**, since the block was rederived
per request from the user's words. That is what search fixes: 2.8x the cache
reads and cache writes down from 30,092 to 4,897, which is the shape you expect
when a prefix stops being rewritten every call.

### Two things this run raises

**The entry-point set earned nothing here.** All seven cases went to search
regardless. The 15 resident tools are meant to be a no-round-trip fast path for
the common ask, and on this question set they never were. Either the questions
are unrepresentative or the set is the wrong 15 — worth measuring before assuming
it is load-bearing.

**`spending` called eight tools across four turns.** It got the right answer and
took the scenic route. Whether that is thoroughness or thrash is not something
the original harness could tell you, and it is the difference between a
37-second answer and a 10-second one. The current harness makes that distinction
explicit: expenses must be first and no more than two tools may be dispatched.

### What this does not establish

One model, one effort setting, one run per path, seven questions, one database.
Nothing here says search is better on a question set someone else would write, and
a single pass cannot separate a real gain from a lucky one. Re-run it when the
model, the prompt, or the description text changes — all three feed BM25 directly.
