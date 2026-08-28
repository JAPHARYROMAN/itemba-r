# MSI compiler decision record

Decision date: 2026-08-25

The release project remains pinned to WiX Toolset SDK 7.0.0. WiX 7 requires
explicit acceptance of its `wix7` OSMF EULA. This repository does not embed
acceptance and the release script does not infer it. An authorized organization
representative must first determine and satisfy the organization's obligation,
then provide the audited environment attestation described in `README.md`.

This is not worked around by selecting an older package:

- WiX's official OSMF documentation says the maintenance fee began with WiX 6;
  WiX 7 added explicit EULA enforcement because NuGet did not reliably present
  the terms. Using WiX 6 merely to avoid the enforcement gesture would not
  remove the underlying obligation.
- WiX's official lifecycle lists consumer security fixes for WiX 5 as ending on
  2026-02-05 (WiX 4 and WiX 3 ended earlier). Those versions are not an
  equivalent supported security baseline as of this decision.
- A commercial MSI compiler can be license-safe only after the organization
  procures and records an appropriate license. It would also require a new
  authoring/compiler implementation and a fresh acceptance baseline; no such
  entitlement is assumed here.
- Directly emitting Windows Installer database tables through Windows APIs can
  create an MSI, but it substitutes a bespoke compiler for a maintained
  toolchain and materially increases table, sequencing, cabinet, upgrade, and
  ICE-validation risk. It is not treated as a drop-in equivalent.

Primary references:

- <https://docs.firegiant.com/wix/osmf/>
- <https://docs.firegiant.com/wix/#lifecycle>

If the organization cannot lawfully attest the WiX 7 terms, MSI construction
must remain red. A separately approved commercial-tool migration can replace
this decision only with its own license record, pinned compiler, signed tooling,
reproducibility proof, security scan gates, and full disposable-VM acceptance.
