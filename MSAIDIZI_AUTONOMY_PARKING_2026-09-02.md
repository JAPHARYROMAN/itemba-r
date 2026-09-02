# Msaidizi Autonomy Platform — Parking Decision, Un-Parking Trigger, Cheap Ceremonies

**Date:** 2026-09-02 · **Verified against:** `main` at `1f38ed6c` plus branch `signing-approver-checkset` (`c239646f`) · **Status:** decision of record

This document does three things. It records that the autonomy platform is parked and what
"parked" means. It writes down the conditions under which it is un-parked, so that decision is
made against a stated test rather than against fatigue or a demo. And it lists the ceremonies
that are cheap enough to do now regardless, separated from the ones that are deliberately
deferred.

Read it alongside `MSAIDIZI_HANDOVER_STATUS.html` (what was built and by whom),
`MSAIDIZI_REVIEW_OUTCOME_2026-08-30.md` (the five decisions on the trust boundaries) and
`MSAIDIZI_SIGNING_CEREMONY_PREP.md` (the pre-flight for the expensive ceremonies). Where this
document and an older plan disagree about *whether* to proceed, this one is later and wins.
Where they disagree about *how* a ceremony runs, the ceremony document wins.

---

## 1. State of record on 2026-09-02

**Live in production, verified today through a logged-in session:** the chat layer only.
`MSAIDIZI_ENABLED=true`, `MSAIDIZI_WRITE_MODE=read-only`. Seven stored conversations between
2026-08-19 and about 2026-08-29, all reads. One user asked it to post a sale on 2026-08-19; it
refused, stated it had no write tool and could not obtain one, and did the three lookups that
would make manual entry faster. That is the structural guarantee behaving as designed.

**On `main`, not in production:** the autonomy platform. Eleven backend `msaidizi-*` modules,
the .NET Windows companion, the task center workspaces, the signed CRUD-evidence and
ring-promotion pipelines. The production droplet still runs the mid-August chat-only build;
`deploy-production.yml` is `workflow_dispatch`-only and has not been run since the platform
landed.

**Fail-closed by default:** the seven autonomy switches (`MSAIDIZI_AUTONOMY_ENABLED`,
`_TASK_WORKER_ENABLED`, `_AUTOPILOT_ENABLED`, `_HOST_EXECUTION_ENABLED`,
`_ADAPTIVE_REASONING_ENABLED`, `_UPDATE_AUTOMATIC_ROLLOUT_ENABLED`, `_UPDATE_EVALUATOR_ENABLED`)
each require an accepted production ring. Plain `MSAIDIZI_ENABLED` does not. That asymmetry is
the invariant `production-release-gate.service.ts` exists to hold and it must survive parking.

**Deliberately held closed:** privileged command execution, browser egress, host file
disclosure. Each is fenced by code, not configuration; the review of 2026-08-30 accepted the
residual risk of the closed state and made a single production choke point (#52) plus the two
blockers #48 and #49 preconditions on ever opening file disclosure.

## 2. The decision: parked

The platform stays on `main`, fail-closed, with CI kept green. Nothing is deleted, branched
away, or feature-flag-stripped. No expensive ceremony is scheduled. Effort goes to the chat
layer's next tier, which is where the only observed demand is.

The reasons, so they can be re-examined rather than re-argued:

- **No demonstrated demand.** Two weeks of real use are read questions. Nobody has asked for a
  Windows-host action. The one write attempt is an amber-tier chat feature, not a host task.
- **What remains is hardware, money and days.** TPM key provisioning, a purchased code-signing
  certificate and an Authenticode ceremony, and a live-VM acceptance day. The 2026-08-30 dry
  walk found two ceremony-ending defects in the shipped pipeline before any certificate was
  bought; the first real run will find more.
- **Largely unreviewed by a human.** Roughly 1,262 files landed from a two-day autonomous run.
  Lane 1 (the static fences) has a sign-off. The device broker service alone exceeds 7,000
  lines and has not been read end to end by a person.
- **All three useful boundaries are closed.** A Windows agent that cannot run a privileged
  command, reach the browser, or read a host file does very little. Shipping it now ships the
  risk surface without the capability.

## 3. Un-parking trigger

The platform is un-parked when **all three** of the following hold, judged by the owner and
written into this document as a dated amendment. Two of three is not a trigger.

**T1 — A named host task exists.** A one-paragraph brief naming: the branch, the specific
machine, the user who will hold the mandate, how often the task runs, and exactly what the
agent must touch on that host. The task must need a PC rather than the API (if the ERP endpoint
exists, it is a chat-layer capability and belongs in amber, not here). The task must map onto a
host capability the companion **already implements**. If the honest brief requires one of the
three held boundaries, the trigger is not "un-park"; it is "complete a boundary", which is a
separate decision with its own preconditions (#48, #49, #52 for file disclosure; the driver
DACL standing instruction for egress; the attestation-source fence for privileged commands).

Examples that would qualify: scanning counter documents from a branch scanner into the
records book; picking up bank statement files that a bank portal drops on a specific PC;
printing a daily pack on a printer the server cannot reach. Examples that would not: anything
a `POST` to the ERP can do; "so we can see what it does"; a vendor or investor demo.

**T2 — The activating backend lanes have a human review.** Before any ring promotion, a person
reads the code that promotion turns on: the devices broker (`msaidizi-devices`), the task
runtime and step handler (`msaidizi-task-runtime`), and the control plane. Agent-assisted is
fine; agent-only is not. The lane commits from 2026-08-28 were sliced for exactly this.

**T3 — A person with hardware and authority is available for a bounded window.** One
Windows 11 host with TPM 2.0 for the key ceremony, budget and identity documents for the
code-signing certificate, and one reserved day for the VM acceptance run. Without a date on
the calendar this condition is not met.

**Non-triggers, stated so they are not mistaken for triggers:** CI is green; the code is
"done"; the chat layer reached amber; a competitor or vendor demonstrated something similar;
the sunk cost feels large.

**Stand-down rule.** If no trigger is met by **2026-12-01**, reduce the maintenance tax
(section 6): move the Windows companion protected-verification job from every push and pull
request to a nightly or path-filtered run, and evaluate moving `windows-companion/` to its own
repository so ERP pull requests stop paying for a Windows runner. Re-evaluate the parking
decision itself at that point.

## 4. Cheap ceremonies — do now

These cost minutes, need no hardware or purchase, and are useful whether or not the platform
ever ships. They are ordered; C1 must finish before C2 matters.

### C1 — Finish the deploy-key move into the protected environments

**Why it is not optional even while parked.** The deploy secrets currently exist twice, and the
two copies do not agree. Observed on 2026-09-02:

| Scope | Secrets present |
|---|---|
| Repository level (set 2026-08-20) | `DEPLOY_DOMAIN`, `DEPLOY_HOST`, `DEPLOY_KNOWN_HOSTS`, `DEPLOY_SSH_KEY`, `DEPLOY_USER` |
| Environment `Production` | `DEPLOY_SSH_KEY` only |
| Environment `msaidizi-production-ring-promotion` | `DEPLOY_SSH_KEY` + the four `MSAIDIZI_CRUD_*` trust roots |

An environment-scoped secret shadows a repository secret of the same name. So a
`Deploy — Production` run today resolves the **new** ed25519 key from the environment and the
**old** host, user and known-hosts from the repository. The new key was generated in the
2026-08-29 ceremony and has never been authorized on the droplet, so that run would fail at
the SSH step with a misleading error. The deploy path is broken until this ceremony completes,
independent of Msaidizi.

Steps, in order:

1. **Authorize the new public key on the droplet**, for the same user the repository-level
   `DEPLOY_USER` names. Append this line to that user's `~/.ssh/authorized_keys`:

   ```
   ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIKYJMjgOd0th37r2OyA3SlFqVWH8RaLzWPggQGJirrP5 itemba-r-deploy-2026-08
   ```

   Do not remove the old key yet.

2. **Load the host settings into both environments.** Take the values from the existing
   repository-level secrets (or re-derive: `DEPLOY_KNOWN_HOSTS` is the output of
   `ssh-keyscan -H <host>` pinned to the current host key).

   ```bash
   gh secret set DEPLOY_HOST        --env Production
   gh secret set DEPLOY_USER        --env Production
   gh secret set DEPLOY_KNOWN_HOSTS --env Production
   gh secret set DEPLOY_DOMAIN      --env Production
   gh secret set DEPLOY_HOST        --env msaidizi-production-ring-promotion
   gh secret set DEPLOY_USER        --env msaidizi-production-ring-promotion
   gh secret set DEPLOY_KNOWN_HOSTS --env msaidizi-production-ring-promotion
   ```

   Each command prompts for the value on stdin; never put the value on the command line.

3. **Verify with one real deploy — and decide first whether you want that.** The only
   verification of the deploy path is a green run of `Deploy — Production` (inputs: `ref`, and
   the confirmation phrase `deploy-production`). That run is a normal release: it moves the
   droplet from the mid-August build to whatever `ref` you give it, runs the pending
   migrations via the `backend-migrate` one-shot, and takes a database backup first. Deploying
   current `main` ships every chat-layer fix merged since 17 August (provider retry, the
   multi-turn DTO fix, the procedures workspace) and the whole autonomy platform **dark**. If
   that is not wanted yet, deploy a `ref` you do want; the ceremony only needs the SSH step to
   pass. Before dispatching, confirm `/opt/itemba-r/.env.production` does **not** set
   `MSAIDIZI_CLOUD_ZERO_RETENTION_CONFIRMED` truthy; the current build refuses to boot on it by
   design. The `Production` environment has a required reviewer, so the run pauses for
   approval.

4. **After the first green run, delete the repository-level copies.** A repository secret is
   available to every workflow on every branch of this repository; the environments exist so
   that the deploy key is only available behind a reviewer gate on `main`.

   ```bash
   gh secret delete DEPLOY_SSH_KEY
   gh secret delete DEPLOY_HOST
   gh secret delete DEPLOY_USER
   gh secret delete DEPLOY_KNOWN_HOSTS
   gh secret delete DEPLOY_DOMAIN
   ```

   Then remove the **old** key line from `authorized_keys` on the droplet, leaving only the
   2026-08 key.

### C2 — Create the ring environment file on the droplet, authorizing nothing

**Why now.** The ring-promotion job already carries the five acceptance variables
(`MSAIDIZI_PRODUCTION_TARGET_ID`, the three accepted digests, and
`MSAIDIZI_RING_ENV_FILE=/opt/itemba-r/msaidizi-ring.env`). The one prerequisite that lives on
the host is the file itself. Creating it now, with content that enables nothing, means the first
real promotion attempt fails on a genuine prerequisite instead of on a missing file, and it
pins the ownership and mode while someone is paying attention.

What `deploy/relaunch/promote-msaidizi-ring.sh` checks before it will read the file:

- a regular file at exactly the path in the variable, **not** a symlink;
- owned by **root** (uid 0);
- **not** group- or world-writable (`0600 root:root` satisfies this);
- every non-blank, non-comment line is `KEY=value` with an upper-case key;
- every key is either `ANTHROPIC_API_KEY` or `MSAIDIZI_*`;
- **none** of `MSAIDIZI_PROMOTION_*`, `MSAIDIZI_PRODUCTION_ACCEPTED_*`,
  `MSAIDIZI_CRUD_EVIDENCE_*` — those belong to the signed release binding and the script
  refuses a file that tries to set them.

Create it, as root on the droplet:

```bash
sudo install -m 0600 -o root -g root /dev/null /opt/itemba-r/msaidizi-ring.env
```

```bash
sudo tee /opt/itemba-r/msaidizi-ring.env >/dev/null <<'RING'
# Msaidizi ring environment — PARKED state (MSAIDIZI_AUTONOMY_PARKING_2026-09-02.md).
# This file exists so the promotion pipeline finds a root-owned file with the right
# mode. It authorizes nothing. Every switch is explicit so a promotion cannot
# inherit an accidental default.
MSAIDIZI_AUTONOMY_ENABLED=false
MSAIDIZI_TASK_WORKER_ENABLED=false
MSAIDIZI_AUTOPILOT_ENABLED=false
MSAIDIZI_HOST_EXECUTION_ENABLED=false
MSAIDIZI_ADAPTIVE_REASONING_ENABLED=false
MSAIDIZI_UPDATE_AUTOMATIC_ROLLOUT_ENABLED=false
MSAIDIZI_UPDATE_EVALUATOR_ENABLED=false
# -1 is the deliberately non-authorizing default for automatic rollout.
MSAIDIZI_UPDATE_AUTOMATIC_MAX_RING=-1
RING
```

Then confirm it passes the same checks the script applies:

```bash
sudo stat -c '%U:%G %a %F' /opt/itemba-r/msaidizi-ring.env
```

Expected: `root:root 600 regular file`. The provider, signing, device, recovery, audit, budget
and kill-switch settings the relaunch README says a *selected ring* requires are a ring-day
task under T1–T3, not part of this ceremony.

### C3 — The two documentation and hardening issues

#51 (document that the egress supervisor cannot open the isolation device; add the VM
acceptance check) and #53 (three static-verifier coverage improvements) need no hardware and
no purchase. They can be done by an agent in a normal pull request at any time and do not move
any boundary. Do them when convenient; they are not blockers on anything and not a reason to
un-park.

## 5. Expensive ceremonies — explicitly deferred

Each is listed with the reason it waits and the document that owns it. Their order when
un-parked is fixed by dependency: keys, then certificate, then VM evidence.

| Ceremony | Waits because | Owning document |
|---|---|---|
| TPM-backed signing keys (non-exportable P-256 via the Platform Crypto Provider, plus the `TrustedPeople` pins) | Only useful once a pilot device exists to pair. Needs a Windows 11 + TPM 2.0 host. Scripts landed in PR #55. | `windows-companion/docs/TRUSTED-ROOT.md`, PR #55 |
| Code-signing certificate and Authenticode ceremony | Costs money and identity verification, and the certificate's validity clock starts at purchase; buy late. Two pipeline defects fixed in #56/#57 before any run. | `MSAIDIZI_SIGNING_CEREMONY_PREP.md` |
| Live-VM acceptance evidence (twelve guest checks, 24-hour window, five clocks) | Meaningless without a signed candidate; a spent VM run cannot be edited to fit. Reserves a full day. | `MSAIDIZI_SIGNING_CEREMONY_PREP.md`, `Approve-SignedRelease.ps1` |

`productionDeploymentEligible` stays hard-coded `false` until the third row exists. That is
correct and must not be "fixed".

## 6. Maintenance floor while parked

What must stay true, and what it costs:

- **Keep `main` green including the Windows companion protected-verification job.** It runs on
  every push and pull request to `main` and `develop` on a `windows-2022` runner. That is the
  main line item of the parking tax and the first thing the stand-down rule cuts.
- **Backend tests need `NODE_OPTIONS=--max-old-space-size=8192`.** 349 suites; the platform
  roughly doubled the suite.
- **The release-gate invariant holds:** `MSAIDIZI_ENABLED` alone never requires a ring; the
  seven autonomy switches always do. A change that blurs this is a regression even if every
  test passes.
- **DTO rule that also protects the live chat layer:** no conditional validators
  (`@ValidateIf` and friends) on DTOs. They degrade the generated schema to "partial" and
  evict the route from the strict capability manifest, which shrinks what Msaidizi can see in
  production today. Validate cross-field rules in the service.
- **Standing instructions from the review:** do not "fix" the isolation driver to admit the
  egress supervisor; do not open file disclosure without #48, #49 and #52; do not replace the
  attestation-source fence in the kernel isolation client without a static check that names it.
- **Keep the append-only ledgers append-only.** The two guard-disabled migrations were
  confirmed intentional and are the only permitted exceptions.

## 7. What this document does not decide

- **Amber tier for the chat layer.** That is the next piece of work with observed demand and has
  its own short checklist (re-run the adversarial section that only a write tier can exercise,
  prove audit attribution reaches a row, get a real cost figure). It is a separate decision.
- **Completing any trust boundary.** Governed by `MSAIDIZI_REVIEW_OUTCOME_2026-08-30.md` and
  the open issues, not by this document.
- **Deleting the platform.** Not proposed. Parking is cheaper than deleting and reversible; the
  stand-down rule is the point at which that question is asked properly.

## Amendments

_Add a dated line here when a trigger condition is judged met, when a cheap ceremony is
completed, or when the stand-down rule fires._

- 2026-09-02 — Document created. C1, C2, C3 not yet started. No trigger condition met.
