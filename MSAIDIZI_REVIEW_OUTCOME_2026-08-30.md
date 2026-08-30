# Msaidizi Review — Outcome of Record

**Date:** 2026-08-30 · **Reviewed against:** `main` tip `050a8ecb` · **Plan of record:** `MSAIDIZI_REVIEW_PLAN.md`

This document closes the review that `MSAIDIZI_REVIEW_PLAN.md` opened. It records what was
verified, what changed as a result, and — most importantly — the five judgment calls the plan
deliberately left to a person, with the reviewer's ruling on each. Anyone resuming Msaidizi work
should read this before the plan: the plan says what to look for, this says what was found and
what was decided.

## Method

Every claim in the plan was checked against the code by an independent verifier, and each Lane-1
conclusion was then handed to a second agent whose only instruction was to refute it. **No
conclusion was refuted.** Line numbers were re-derived rather than trusted, since the plan predates
several merges.

Two checks went beyond reading:

- **Tamper test (Lane 1a).** In an isolated worktree, the privileged-command attestation fence was
  replaced with an accepting source, and separately the required health flags were stripped.
  `verify-static.ps1` refused each time, naming the exact fence. Both edits were reverted, the
  verifier re-passed, and the worktree was left clean. The pin is real, not declarative.
- **Digest chain (Lane 4).** Both links were recomputed from the index blobs (LF-normalized) and
  matched their pins: the static verifier's digest against its pin in the protected-source runner,
  and that runner's digest against its pin in the signed-release script.

## Result

26 items: **18 hold exactly, 4 were judgment calls, 3 drifted, 1 was broken.**

| Lane | Outcome |
| --- | --- |
| 1a — privileged command execution | Fence intact and proven to trip; 2 judgment calls, both accepted |
| 1b — browser egress | Four independent layers hold; 1 judgment call, accepted |
| 1c — ephemeral file disclosure | Refusals hold; 2 boundary blockers filed; 1 judgment call, accepted |
| 2 — backend platform | All five items hold |
| 3 — model client & provider contract | Three code protections hold; runbook drift fixed |
| 4 — deploy, CI, digest chain | All hold; blocker count drift is benign |
| 5 — frontend workspaces | **One broken item, fixed**; rollback item holds |
| 6 — schema & ledgers | Append-only holds at runtime; two documented exceptions accepted |

### The one defect

`msaidizi-task-center.tsx` carried no permission awareness while the page gate requires only
`msaidizi.use`. Four mutating controls — mandate activation, emergency stop-all-devices, the
pairing-code form, and the recovery authorization form — therefore rendered for users whose
requests the backend would always refuse. Backend enforcement was never in question; the defect is
that a control which always fails teaches users to ignore errors. Fixed in PR #50, which gates all
four behind the oversight permission using the convention the rest of the lane already follows.

The same PR corrected three documentation defects in `MSAIDIZI_PROVIDER_CONTRACT_RUNBOOK.md`, the
most serious being a step that could not work as written: it directed the operator to set the
container-side path variables in the production env file, when compose reads no env file and derives
those paths itself from two `*_HOST_PATH` variables the runbook never mentioned. Following it
literally produced a fail-closed boot.

## Decisions of record

All five were ruled on by the reviewer on 2026-08-30.

1. **Pre-ceremony residual on privileged command execution — ACCEPTED.**
   The in-repo half is enforced on every CI run through a hash-pinned verifier chain; the unenforced
   half (an operator deploying a supervisor binary built from modified or foreign source) is
   unenforceable from inside a repository by construction, and is separately gated by protected
   environments and VM/ring acceptance. The documentation's caveat is honest, not a gap.

2. **All-zero digest asymmetry between managed and driver layers — ACCEPTED.**
   Where a zero digest would signify unprovisioned evidence, the managed code already refuses it and
   the driver independently withholds the provisioned flags. Residual is operator error on a
   configured pin, which the runtime image check also refuses. Optional hardening tracked in #53.

3. **Driver DACL exclusivity — ACCEPTED AS INTENDED ARCHITECTURAL SEPARATION.**
   The egress supervisor is modelled by the driver as a policy subject rather than a caller, ships
   with no driver configured, and expects a health protocol this driver does not implement. The
   resulting inability to open the device is to be treated as a real defensive property. **Whoever
   resumes browser-egress work must not "fix" the driver to admit the egress supervisor.**
   Documentation and VM-acceptance follow-up: #51.

4. **Scattered predicate enforcement for ephemeral file disclosure — ACCEPTED FOR THE CLOSED STATE.**
   Conditional acceptance: it covers the boundary only while closed. The single production
   port/ledger is a **precondition on activation** (#52), with an enforcement-presence invariant test
   as the interim guard against additive drift.

5. **The two guard-disabled ledger rewrites — CONFIRMED INTENTIONAL.**
   Two migrations predating the plan disable an append-only guard, rewrite existing rows, and
   re-enable it within one transaction: one reclassifies evidence-lease dispatch rows to replay-only,
   one conservatively raises below-floor price snapshots. A repo-wide scan confirms these are the
   only two, and neither touches the task-event ledger. The reviewer confirms both were knowingly
   accepted; Lane 6 is therefore **holds-with-exceptions**, and those exceptions are these two,
   named here so no future reader mistakes them for drift.

## Lane 1 sign-off

The plan's sign-off conditions are met:

- [x] All three boundaries confirmed fail-closed at their real fences.
- [x] The close-out's documentation corrections (`6a48122c`) verified accurate **against the code**,
      not the other way round.
- [x] The static pins proven to actually trip, by tampering and watching the verifier refuse.
- [x] The grant-consumption layering and DLP-asymmetry findings converted into tracked issues that
      block boundary-completion work (#49, #48).

Lane 1 is signed off. **This does not authorize completing any trust boundary.** The standing rule
is unchanged: the three boundaries are completed only after live-VM acceptance evidence exists, and
the file-disclosure boundary now carries two additional preconditions (#48, #49) plus the activation
precondition in #52.

One answer worth recording, because it was the plan's sharpest open question: **no production code
path consumes a disclosure grant at all today.** The parser's unbacked promise therefore cannot
currently be mistaken for authorization — but the authenticated issuer and the atomic nonce ledger
genuinely do not exist, and must land before any consumption path does.

## Tracked issues

| Issue | Nature | Status |
| --- | --- | --- |
| #48 | Host-file observation persists raw content unredacted | **Blocks** file-disclosure boundary completion |
| #49 | Grant issuer-signature check and atomic nonce ledger unwritten | **Blocks** file-disclosure boundary completion |
| #52 | Single production choke point before activation | **Precondition on activation** |
| #51 | Document the driver/egress separation; add VM-acceptance check | Follow-up, decision recorded |
| #53 | Static-verifier coverage hardening (3 items) | Low priority, decision recorded |

## Incidental finding: CI was red for an infrastructure reason

Main's CI on `050a8ecb` had concluded failure, which the review's lane briefs had assumed green. The
cause was not the digest chain: the protected-verification job failed at a formatting step because
the .NET CLI was absent on the runner, and never reached the pinned verifiers. The advisory timing
job also failed, but it is `continue-on-error: true` and does not block. The tip differed from the
last green push by ten lines of workflow YAML, so no product code was untested.

The production deploy gate requires a green CI run for the exact commit and correctly refused —
fail-closed as designed. The failed jobs were re-run and **main is now green**, so the gate accepts
`050a8ecb`, the commit whose ring-0 digests were accepted the same day.

## What remains

Unchanged by this review, and entirely human: TPM signing keys → code-signing ceremony → live-VM
acceptance evidence. The protected-environments step is complete and the ring-0 digests are accepted
and loaded. Trust-boundary completion follows acceptance evidence, never precedes it.
