# Disposable-VM acceptance boundary

`Invoke-MsaidiziVmAcceptance.ps1` must run, elevated, inside a newly created
Windows 11 x64 hypervisor guest with TPM 2.0 and NTFS. The release pipeline
Authenticode-signs the staged copy. The script refuses a dirty pre-existing
installation, verifies the exact signed candidate, installs and exercises it,
proves fail-closed runtime/ACL/firewall behavior, uninstalls it, and signs its
JSON result with a short-lived VM-evidence certificate.

The installer slice inventories all six exact restricted-SID services, all
seven permanent `NeverOverwrite` configurations, and all seven exact-program
inbound firewall blocks. It verifies that the two independent enforcement
supervisors are automatic/non-delayed dependencies of the delayed Companion;
that both supervisor lifecycle journal and lock files are precreated with
owning-service-only mutation authority; and that the privileged-command
baseline contains four distinct purpose slots while every SPKI and Companion
pin remains empty. These are safe-off packaging checks only: the VM result does
not claim a TPM signing key, kernel driver, WFP filter, or native enforcement is
active.

The guest cannot truthfully prove its own destruction. A successful guest run
therefore has status `PASS_PENDING_EXTERNAL_VM_DISPOSITION`. After exporting
the guest evidence, the VM orchestrator must destroy the VM or revert it to the
exact approved clean source snapshot. The orchestrator then emits a JSON record
matching `vm-disposition.schema.json` and signs those exact bytes as detached
CMS with a separate, allowlisted orchestration certificate.

`scripts/Approve-SignedRelease.ps1` requires all three distinct trust paths:

1. organizational release signature over candidate/manifest;
2. short-lived guest signature over the complete acceptance result; and
3. external orchestrator signature over destruction or clean-snapshot
   reversion, bound to the exact VM run and guest-evidence hash.

No string parameter, guest claim, screenshot, or unsigned CI log is accepted as
proof that a VM was disposable. Neither a guest pass nor an orchestrator
disposition by itself creates release approval. Even after both are accepted,
the output is explicitly scoped to MSI installation/fail-closed
bootstrap/uninstall. Paired-channel operation, governed mutations,
restart/replay/cancellation/recovery semantics, ledger reconciliation, and
rollout-ring drills remain separate red gates and are not claimed here.
