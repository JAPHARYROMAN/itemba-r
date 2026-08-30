# Code-Signing Ceremony — Pre-Flight Findings

**Date:** 2026-08-30 · **Verified against:** `main` (post-#57) · **Status:** two hard blockers found and fixed; ceremony not yet run

This is the output of a dry-walk of the Authenticode release ceremony against the code, done
*before* certificates were purchased or a ceremony day was scheduled. The same exercise applied to
the provider-contract runbook found a step that could not work as written; this one found two
defects that would each have ended a ceremony day, and neither was in the documentation — both were
in the shipped pipeline.

Read this alongside the ceremony runbook. Where the two disagree, this document is the one that was
checked against the code.

## Two blockers, both fixed

**1. The code-signing certificate check rejected every certificate.** `Get-ExactSigningCertificate`
tested `EnhancedKeyUsageList.ObjectId.Value`, but `ObjectId` on an `EnhancedKeyUsageRepresentation`
is already a string with no `.Value`. Under the module's own strict mode that throws, so the function
could never return — for any certificate, including one carrying the exact code-signing EKU it was
looking for. It is called before any build work, and again during approval, so both ceremonies
aborted. The same expression sat in the pre-flight readiness check inside a `catch`, which silently
reported a valid certificate as missing-or-invalid — so the pre-flight would have "confirmed" a bad
certificate and sent the operator back to the CA. Fixed in PR #56.

**2. The approver demanded ten VM checks; the guest emits twelve.** `Approve-SignedRelease.ps1`
compared the check set by exact cardinality against a ten-item list, while the guest acceptance
script emits twelve — `install.adversarial-preplant` and `reinstall.provenance-preservation` were
absent from the approver's list. Both sides were written in the same commit, so this has never
worked. The failure mode is the expensive one: it surfaces at approval, *after* the candidate is
built, the VM run is spent, and the 24-hour window is burning — and because the guest CMS-signs its
evidence and the orchestrator hash-binds it, the evidence cannot be edited to fit. Fixed by requiring
all twelve, which is strictly stronger than requiring ten.

## Corrections to the runbook

**Phase 1 as written leaves a dirty tree, and the next script refuses one.** Everything Phase 1 does
is a working-tree modification under `windows-companion/` — the policy file, three entry scripts, and
the appended signature blocks — and the candidate constructor runs a porcelain status check over that
directory and throws on any output. Phase 1 has no commit step. The ordering also matters and is not
interchangeable: the commit must come **after** signing, because signing rewrites the files, and
**before** launch, because the constructor binds the source revision to HEAD. The correct sequence is:

> edit policy → recompute digest → patch all three entry scripts → run the static gate →
> sign the four pipeline files → **commit** → launch

**Recompute the policy digest from LF bytes.** `release-policy.json` is covered only by the blanket
`text=auto eol=lf` rule, not by the explicit LF-pin block, and is absent from the list the static
gate asserts must carry an explicit pin. If it is opened in a CRLF-writing Windows editor during
Phase 1, the on-disk bytes change and its digest changes with them. Both the operator's file hash and
the static gate read that same dirty file, so an embedded CRLF digest **passes locally** — then git
normalizes the commit back to LF and every fresh checkout throws. Recompute from the committed blob,
and confirm the file still reports LF in both index and working tree before signing.

**There are five clocks, not one.** The 24-hour VM-evidence window is the well-known one, but the
approver also re-checks Defender signature freshness against a hard-coded 24 hours (not the policy
value), rejects future-dated evidence beyond a five-minute skew, and requires the disposition
timestamp to sit at or after evidence completion. Note also that the approver reads the maximum
evidence age from the **signed manifest**, not from the policy file — editing the policy after a
candidate is built changes nothing.

**The pre-flight does not check timestamps.** It verifies the four pipeline files for status and
signer thumbprint only. Timestamp presence is enforced later, and only against the two files the
running script itself loads — so an untimestamped `Approve-OperationalRelease.ps1` passes pre-flight,
passes the build day, and fails weeks later at operational approval. Timestamp all four and verify it
explicitly.

**PowerShell artifacts are never signtool-verified.** `.ps1`, `.psm1` and `.psd1` return early and are
checked with an Authenticode signature query plus a timestamp presence test instead. The evidence log
will therefore contain no signtool verification lines for them; that is correct, not a gap.

## Two answers that decide what you buy

**OV is sufficient. EV buys only SmartScreen reputation.** An exhaustive search of the companion tree
for EV policy OIDs, certificate-policy assertions and chain policy constraints found nothing in any
release script. The chain build sets revocation options only and never constrains application or
certificate policy. The single OID the signing path names is code-signing itself.

**Azure Trusted Signing will not work with this pipeline.** Four independent blockers, each in a file
that is itself Authenticode-pinned to the pipeline identity: the signtool argument array is fixed and
carries no dlib/metadata pair; the certificate lookup demands a local store hit with an accessible
private key; two signing paths need an in-process certificate object with a usable key, which
signtool-dlib cannot supply; and a single 40-hex thumbprint is pinned in protected policy. Adopting it
would mean editing pipeline-signed files — a full re-review and re-sign. Buy a hardware token or a
cloud-HSM product that ships a Windows CNG provider.

**Six distinct signer identities are required, not two.** The policy gate accepts only *completely*
unprovisioned or *completely* provisioned, over eight fields, and every signer thumbprint across all
roles must be mutually distinct. The ceremony cannot be staged one certificate at a time.

## Open, not fixed

- **The SDK version is pinned in two places that nothing cross-checks** — the release policy and
  `global.json`. They agree today. If a future change bumps one, the static gate and the entry
  script's own check both still pass, and the failure surfaces deep inside the constructor,
  mid-ceremony. A cross-check assertion would close it.
- **The policy's runtime identifier is decorative** — the build passes a hardcoded literal. Editing
  the policy value changes nothing except making the constructor throw.
- **The detached-CMS digest algorithm is inherited, not asserted** — it is whatever the host runtime
  defaults to (SHA-256 on the pinned runtime), and neither the signer nor the verifier asserts it.
- **The CMS signing call is not silent**, so an HSM- or TPM-resident release key may raise an
  interactive consent dialog — worth knowing before an unattended leg is planned.
- **One signed file has no explicit line-ending pin.** The three entry scripts are forced to CRLF, but
  `Release.Common.psm1` falls through to the blanket LF rule, and signature blocks are appended with
  CRLF terminators. Whether the PowerShell signature provider tolerates that round-trip could not be
  settled without a real certificate. **Re-verify all four signatures from a fresh clone before
  starting the build** — the runbook already says to, and this is why it matters.

## What this ceremony does not do

Succeeding here produces `productionDeploymentEligible: false` and leaves the operational and
ring-acceptance gates not executed. That is correct, not a failure, and must not be reported as
go-live. The GitHub ring-promotion workflow is a **separate chain** keyed on the backend image digest
and consumes none of these Authenticode digests — the ring-0 acceptance already recorded is unrelated
to this ceremony and is not advanced by it.
