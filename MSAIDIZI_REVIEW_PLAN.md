# Msaidizi Platform — Human Review Plan

> **This review was completed on 2026-08-30. Read `MSAIDIZI_REVIEW_OUTCOME_2026-08-30.md` first** —
> it records what was found against `main` tip `050a8ecb`, the five judgment calls and how they were
> ruled, and the Lane 1 sign-off. This plan remains the statement of *what to look for*; the outcome
> document is the statement of *what was found and decided*.

**Why this document exists.** The bulk of the Msaidizi Windows autonomy platform (PR #33, ~1,262 files) was produced by a long autonomous run and — apart from a targeted trust-boundary verification — has not been read by a person. It is green, fail-closed, and coherent; none of that is the same as reviewed. The commits were deliberately sliced along clean seams so a person can review lane by lane. This plan orders those lanes by risk, tells you exactly what to scrutinize in each, records the **already-verified findings** (so you confirm they still hold rather than rediscover them), and flags the places where the *documentation misdescribes the mechanism* — the trap a reviewer is most likely to fall into.

**Scope.** PR #33 (`210a068d`, 17 commits) plus the follow-ups already merged: #35 (timing-test tiering), #36 (test runner), #37 (provider-contract attestation tool + runbook), #38 (task-event cursor allocation fix). Everything is on `main`; nothing is deployed; all autonomy switches ship off.

**Time budget.** Roughly 2–4 focused days total. Lanes 1–2 are where the danger lives; if you only have one day, do Lane 1 and the Lane 2 invariants section.

---

## Before you start: how to run what you're reading

```bash
# Backend (from backend/): full suite needs the big heap, and a clean env —
# your shell's ANTHROPIC_* vars trip 6 model-client guard tests (env pollution, not a bug)
env -u ANTHROPIC_BASE_URL -u ANTHROPIC_AUTH_TOKEN -u ANTHROPIC_API_KEY \
  NODE_OPTIONS=--max-old-space-size=8192 npx jest --runInBand --ci
```

```bash
# Verify like CI does: the suite must pass WITHOUT backend/.env existing
mv backend/.env backend/.env.bak && (cd backend && NODE_OPTIONS=--max-old-space-size=8192 npx jest --runInBand); mv backend/.env.bak backend/.env
```

- Companion (.NET): 1,146 tests across 7 projects. **Protected verification needs EXACT SDK 8.0.400** — `global.json` rolls forward to an installed 8.0.424 and the runner then refuses; temporarily move `sdk/8.0.424` aside to reproduce CI locally.
- The advisory `windows-companion-timing` CI job is *expected* red on shared runners — that is its job. Don't chase it.
- `prisma generate` takes ~4–7 minutes on this schema. Budget for it after any schema checkout.

---

## Lane 1 — The three trust boundaries (companion + devices broker) · ~1 day · HIGHEST RISK

These are deliberately incomplete: the pipelines behind them are ~90% built and **the missing tenth is the safety layer**. Your job is not to finish them; it is to confirm each one still fails closed and that the close-out's documentation corrections (`6a48122c`, "make the real trust boundaries match their documentation") accurately describe the mechanisms — the original docs pointed at the wrong fences, and the corrections themselves have not been human-reviewed.

### 1a. Privileged command execution
- History you need: the original `TRUSTED-ROOT.md` claimed the production gate "always rejects and has no configuration override" — false; the gate is bound via a factory in `Program.cs` and configuration alone can select `NamedPipePrivilegedCommandTrustedRootIsolationClient`. The close-out **rewrote the doc honestly** (read `windows-companion/docs/TRUSTED-ROOT.md:80-92`): the real fence is compile-time in the supervisor — `WindowsKernelIsolationDriverClient.cs:99` installs `UnavailableV3SignedDriverAttestationSource` (fails every attestation) plus `RequireReadyHealth` refusing unprovisioned (all-zero) measurements — and `scripts/verify-static.ps1` **now pins both**.
  - ☐ Verify the initializer at `:99` is unchanged (confirmed present as of this plan) and that `verify-static.ps1` genuinely fails when either fence line is edited — actually try the edit locally and watch it refuse.
  - ☐ Note the doc's own caveat: until the external supervisor/driver pass VM-ring acceptance, keeping the rejecting fallback bound is "an operational requirement on the deployment, not an invariant the code enforces on its own." Decide whether that residual is acceptable pre-ceremony.
- All-zero measurement digests are refused at the layer that matters (`NetworkIsolationDriverSessionV3.cs:533` + driver `policy.c:1202-1207`), but in the *managed* digest layer 64 zeros is an ordinary valid digest — there is no shared `IsNonZeroSha256` helper. ☐ Decide whether that asymmetry is acceptable.

### 1b. Browser egress
- Refused at 4 independent layers; the feature flag alone opens nothing. Real fence: `EgressHostPosture.cs:93-94` hard-codes `BrowserBrokerBuildSha256: null` + `CommandRequired` (compile-time, not config), plus `RejectingBrowserBoundaryEvidenceProvider` as the only production registration.
- Verified oddity worth understanding: the WFP driver's device DACL is built for the **PrivilegedCommandSupervisor** SID, not the EgressSupervisor's — the egress supervisor *cannot talk to the driver at all* today. ☐ Confirm that is still true and record whether it is intended as a fifth layer or an accident that happens to help.

### 1c. Ephemeral file disclosure (host file reads)
- History you need: the original doc described `RejectingEphemeralFileDisclosurePort` as "the production port" — it is a **contract fixture with no production instantiation** (the corrected doc, `windows-companion/docs/EPHEMERAL-FILE-DISCLOSURE.md:46`, now says exactly that). Actual enforcement is ~11 scattered static `if` checks. ☐ Find each one; ask whether scattering is acceptable or a single choke point should be a required follow-up.
- The grant parser was renamed during close-out from `parseAndAuthorize…` (which verified **no signature and no nonce uniqueness** despite the name) to `parseEphemeralFileDisclosureGrantAgainstExpectedBinding` (`ephemeral-file-disclosure.protocol.ts:119`), with an explicit comment (`:111-116`) that signature verification and nonce consumption belong to the authenticated grant issuer and an atomic nonce ledger **elsewhere**. ☐ The review question is now a layering one: find where a grant is *consumed* and confirm the issuer-signature check and the atomic nonce ledger actually exist on that path (or are part of the 6 unwritten subsystems) — a parser comment is a promise, not enforcement.
- **DLP asymmetry (still present, now comment-acknowledged in code):** the host-file observation *file* branch persists raw content with `redactionsApplied: false` (`msaidizi-devices.service.ts:5630` and `:5684`, comment at `:5664`), bypassing the sanitize step the generic branch applies. ☐ Convert to a tracked issue that blocks the boundary-completion work.
- **The tempting diff (resist it):** deleting the 4-line `if (checkpointInput.file)` block at `msaidizi-adaptive-reasoning.service.ts:377` and mirroring `attachCheckpointImage` for the `attachCheckpointFile` stub (`:1237`) produces a *working* file→provider path with **none** of the 6 required subsystems. Any future PR touching those lines deserves maximum suspicion.

**Lane 1 sign-off:** all three boundaries confirmed fail-closed at their real fences; the `6a48122c` doc corrections verified accurate against the code (they were written in the same autonomous run they describe); the static pins proven to actually trip; the grant-consumption layering and DLP-asymmetry findings converted into tracked issues that block the boundary-completion work.

## Lane 2 — Backend platform: broker, autonomy, release gating (`aa2c74e1` + fixes) · ~1 day

- **Load-bearing invariant** (`production-release-gate.service.ts`): plain `MSAIDIZI_ENABLED` (human chat) needs **no** production ring; the 7 autonomous switches (AUTONOMY, TASK_WORKER, AUTOPILOT, HOST_EXECUTION, ADAPTIVE_REASONING, UPDATE_AUTOMATIC_ROLLOUT, UPDATE_EVALUATOR) all do, and default fail-closed. ☐ Read the gate end-to-end; this is the compatibility contract for the existing human product.
- **Structural autonomy limit:** the durable task worker sends `tools: []` — task autonomy is plan-replay + CONTINUE/STOP/REPLAN verdicts; only human-initiated chat (`MsaidiziService.run()`) dispatches tools. ☐ Confirm no other call site constructs a tool-bearing request.
- **Capability invocation is HTTP-with-the-caller's-token, not DI** (`capability-invoker.ts`) — this is what makes guards/pipes/interceptors un-bypassable. ☐ Confirm nothing new invokes services directly.
- Devices broker (`msaidizi-devices.service.ts`, ~7,700 lines) is the biggest single read: focus on session binding, the mTLS listener bootstrap (identity from the TLS socket; forwarded cert assertions deliberately ignored — this is why the device channel cannot be proxied), and the observation-persistence paths (ties into 1c).
- Accepted judgments — don't re-litigate without new evidence: per-run (not per-session) write budgets; red-tier confirmation inline rather than via approval-workflows; no automatic undo.
- #38's fix: the task-event cursor is now allocated inside the advisory chain lock. ☐ Read `MSAIDIZI_TASK_EVENT_CHAIN_RACE.md` then the fix; confirm the ledger stays append-only and history was not rewritten.

## Lane 3 — Model client & provider contract · ~half day

- `AnthropicModelClient`: **`maxRetries: 0` must stay pinned.** Retry lives in `createMessage` because every attempt must re-verify the provider contract; an SDK-internal retry re-sends without re-entering the method, so a second disclosure would ride on a contract verified before the first. Knobs: `MSAIDIZI_MODEL_MAX_ATTEMPTS|_RETRY_BASE_DELAY_MS|_RETRY_MAX_DELAY_MS`.
- `MSAIDIZI_CLASSIFIER_MODEL` is **not** dead config — `ProviderContractAttestationService.expectedModelIds()` includes it; changing it without a matching signed contract stops the agent by design.
- The forbidden-env guard (`model-client.ts:115`, `:323`) rejects `ANTHROPIC_BASE_URL` etc. before constructing the client — the reason local suites need the env scrub above.
- #37's attestation tool + runbook (`MSAIDIZI_PROVIDER_CONTRACT_RUNBOOK.md`): ☐ walk the runbook once dry; it is the ceremony that satisfies the `MSAIDIZI_CLOUD_ZERO_RETENTION_CONFIRMED` boot gate.
- DTO trap that already bit once: `content` in the conversation DTO must stay bare `@IsDefined()` — a nested `@Type()` strips provider-added fields the API requires echoed back verbatim.

## Lane 4 — Deploy, CI, digest chain (`e1ae9702` + `af8ae05`) · ~half day

- `deploy-production.yml` is `workflow_dispatch`-only and requires secrets/protected environments that don't exist — confirm nothing added an automatic trigger.
- Digest chain edit order (converge in dependency order, verify against the **staged** blob because `.gitattributes` normalizes EOL): `verify-static.ps1` → its pin in `Invoke-ProtectedSourceVerification.ps1` → the runner's own pin in `installer/scripts/New-SignedReleaseCandidate.ps1`.
- Compose intentionally publishes **two** loopback backend ports (device mTLS 3443 + evaluator 3444) and the healthcheck stays plain HTTP on 3001 always — prior gate assertions to the contrary were the stale side. The installer's expected-HostCapabilities lists are per-host (service vs recovery differ deliberately).
- Ring promotion demands a signed evidence run + three hand-provisioned digests. ☐ Confirm the ~80 CRUD-evidence blockers (53 path-read, 4 query-read, ~23 mutation) are still tracked in-code and understood as an ops ceremony, not missing tests.

## Lane 5 — Frontend workspaces (`e34909e7` + `e7f6105`) · ~half day

- Five workspaces (task center, routines, devices, memory, coverage/rollout screens). `msaidizi-task-center.tsx` is ~4,300 lines carrying four workspaces — known structural debt, splitting it is a follow-up, not a review blocker.
- ☐ Verify every mutating affordance is gated by the same permission codes the backend enforces, and that kill-switch/rollback controls surface backend errors verbatim (finance-page conventions apply).
- The rollout detail view was built around the *unfinished* rollback: confirm the UI cannot imply a rollback capability the backend refuses.

## Lane 6 — Schema & migrations · ~2 hours

- Msaidizi tables: append-only ledgers (task events, host actions, evidence). ☐ Confirm no migration rewrites or deletes ledger history; #38's migration should only change cursor *allocation*.
- `msaidizi-memory` has no owning `.module.ts` (split across three modules) — known debt; confirm no security-relevant logic hides in the unowned seam.

---

## After the review

1. File the Lane 1 outcomes as tracked issues (static guard for the kernel-client fence; grant signature+nonce; DLP asymmetry; doc corrections).
2. Only then consider the human-only ceremonies (TPM keys → code-signing ceremony → protected environments → live-VM acceptance evidence) — in that order, per `MSAIDIZI_HANDOVER_STATUS.html`.
3. The three trust boundaries are completed **after** acceptance evidence exists, never before.
