# Msaidizi Network Isolation Driver

This directory is a bounded native foundation for network isolation of explicitly enrolled Windows processes. The privileged-command supervisor now has a source-level binary v3 bridge, but the driver is not installed by the production installer and the bridge is not deployment evidence.

The project targets the Windows Driver Kit and uses WFP terminating callouts at `ALE_AUTH_CONNECT_V4` and `ALE_AUTH_CONNECT_V6`. An enrolled process is identified by the tuple of PID, kernel process object, creation time, process start key, uppercase normalized NT image path, supervisor-measured image SHA-256, and exact WFP application-ID bytes. If that identity is stale, its policy generation is stale, authorization is expired, the application ID changes, kill is latched, or no exact policy destination matches, a future connect is blocked and the action right is cleared. Processes that have never been explicitly enrolled remain outside this driver's scope and continue through Windows Firewall normally.

Only two policy entry kinds exist: broker and egress supervisor. Each entry binds a process-identity digest to an IPv4/IPv6 destination prefix, TCP/UDP protocol, nonzero remote port, and expiration. Policy lifetime is capped at two hours. Entries must be canonical, strictly byte-sorted, and unique. A complete policy is replaced using an immutable snapshot whose generation must advance by exactly one. Process enroll/remove and the latched kill request must name the current generation. A boot-bound, globally increasing request sequence plus a unique request ID rejects stale generations and replay.

## Trust boundary

The device is `\\.\ItembaMsaidiziIsolation`. Because `IoCreateDeviceSecure` accepts only the restricted device-object SDDL subset, creation starts with a SYSTEM-only bootstrap DACL while the symbolic link is unpublished. The driver then builds and applies an ACL containing only the Windows service SID derived from **Itemba Msaidizi Privileged Command Supervisor**:

`S-1-5-80-1792805186-3282615177-1795010573-3676175622-4117989893`

Administrators, LocalSystem as an ambient identity, the standard-user tray, and the model-facing companion are not present in the published device DACL. Create and every device-control dispatch also inspect the requestor's primary token for the enabled exact service SID, including restricted-service tokens; this prevents a duplicated handle from becoming an authorization bypass. Installer work must configure and verify that exact service SID on the purpose-specific supervisor service. The supervisor is the policy authority: it must validate central exact-action tokens and image measurements before constructing v3 frames. This driver deliberately exposes no IOCTL that lets an enrolled child, tray process, or model mint its own authority.

The kill state is one-way and monotonic for a driver load. A valid kill IOCTL, loss of the sole supervisor device handle, or unload latches it. Kill requests use policy generation zero, so an emergency denial is independent of the current replaceable policy generation; boot binding, request replay checks, and monotonic kill generation still apply. It can be cleared only by a trusted driver reload, which creates a new boot ID and has no policy. Handle loss blocks later ALE connects from enrolled identities; it does not terminate a process tree and is not a process-lifecycle implementation.

## Managed v3 bridge and legacy compatibility

`WindowsKernelIsolationDriverClient` now speaks only the fixed-layout v3 IOCTLs. It validates `GET_PROTOCOL`, nonce-bound `GET_HEALTH`, exact structure sizes/features, boot/driver measurements, monotonic generation and sequence, mutation response identity, and replay. Bind installs or reuses a deny-all network policy, retains one no-write/no-delete executable handle across file identity, byte hashing, final NT-path capture, and WFP application-ID derivation, then rejects any WFP-path or handle-identity drift. It derives the native PID/create-time/start-key/image/path/application identity, assigns the still-suspended child to a supervisor-owned nested kill-on-close job, retains the executable lock through settlement, and calls `ENROLL_PROCESS`. Settlement proves or terminates that job before `REMOVE_PROCESS`; uncertain outcomes request `SET_KILL_STATE`, close the sole device handle, and close every owned job.

The four legacy JSON IOCTLs remain explicit denials with `accepted: false` and `LEGACY_NOT_PROVISIONED`, but production no longer dispatches them. The high-level wire and signed evidence contract remains v2-compatible. The frozen native v3 ABI does not sign attestations, hash the mapped image itself, close existing sockets, or terminate process trees. Accordingly, the production attestation source remains rejecting until a separately provisioned hardware-backed signer can bind verified v3 health to the unchanged signed-v2 validator, and the standard companion remains safe-off when any posture or feature proof is incomplete.

## Protocol v3

The shared ABI is [`include/msaidizi_network_isolation_protocol.h`](include/msaidizi_network_isolation_protocol.h). All integers are little-endian. Frames are fixed-width, size-delimited, 8-byte packed, limited to 256 KiB, and reject unknown version, message type, flags, reserved bits, or enum values. IPv4/IPv6 addresses are stored as canonical network-order octets; ports are host-order integers in the binary frame.

The intended sequence is:

1. Open the device from the purpose-specific supervisor service and send `GET_PROTOCOL` with a nonzero request ID and zero boot ID to learn the per-load boot ID and exact structure sizes/features.
2. Submit policy generation 1 with `REPLACE_POLICY`; later replacements must be exactly current generation + 1.
3. Enroll a live process against the current generation. The driver reopens the PID, compares creation time/start key/live NT path, holds a kernel object reference, and verifies the canonical identity digest.
4. Use health challenges to read boot/policy identity and counters. Health is challenge-bound but is not signed attestation.
5. Remove enrollment only after the bound process object is terminal, or latch kill through the generation-independent kill mutation. An active process cannot be made ungoverned through `REMOVE_PROCESS`. Closing the only device handle also latches kill.

Policy SHA-256 is computed over the ASCII domain `MSAIDIZI-NETWORK-POLICY-V1` plus one NUL byte, followed by little-endian generation, expiration, entry count, and packed sorted entries. Process identity SHA-256 uses `MSAIDIZI-NETWORK-PROCESS-IDENTITY-V1` plus one NUL byte, PID, creation time, start key, image digest, path character count/path bytes, application-ID byte count/bytes. The README describes these hashes for interoperability; authoritative sizes and offsets are compile-tested from the header.

The health response exposes a per-load random boot ID, an estimated Windows boot time, last accepted request sequence, policy digest/generation/expiry, kill generation, enrollment counts, callout IDs, and connect/rejection counters. Boot-measurement and driver-image digest fields stay zero with their `PROVISIONED` flags clear in this foundation. A later trusted build/attestation integration must supply and verify genuine measurements; self-reported bytes are not TPM or Secure Boot evidence.

## Important enforcement limits

- ALE connect authorization governs new connection attempts. It does not close existing sockets, revoke already-authorized flows, or terminate a process tree.
- Device-handle cleanup latches network denial only. The managed bridge supplies a separate supervisor-owned nested job, but its real handle-loss and descendant behavior still requires signed Windows VM evidence.
- The supervisor supplies the image digest. The driver binds it to a live process/path/start identity but does not independently hash the mapped image section yet.
- IPv4 address and remote-port extraction, application-ID normalization, PID reuse, dynamic-session teardown, unload, crash, sleep/restart, and concurrent replacement behavior require kernel-debugged Windows 11 VM tests.
- In-memory snapshots disappear on unload/crash. WFP objects are placed in a dynamic session so the Base Filtering Engine owns their cleanup when its engine handle closes; this must still be demonstrated under forced-crash VM tests.
- No production certificate, catalog signature, Secure Boot/HVCI/WDAC compatibility evidence, installer wiring, upgrade/rollback path, or ring-0 telemetry exists here.

## Build and verification

Run the host-only contract verification from PowerShell:

```powershell
./tests/verify-protocol.ps1
```

It compiles the portable shared ABI with MSVC using exact size/offset/IOCTL assertions and statically checks the closed security contract against the driver sources and managed v3 client/session/job bridge. It reports WDK discovery separately. `-RequireWdk` makes absence of complete kernel headers and driver build targets an error.

With a matching Visual Studio WDK integration, build `Msaidizi.NetworkIsolationDriver.sln` for x64. Before any workstation rollout, CI must compile with `/W4 /WX` plus Code Analysis/SDV, generate and verify the catalog, sign with a non-test production identity, and validate in disposable Windows 11 VMs with Secure Boot/HVCI/WDAC. Tests must cover exact allow/deny tuples, expiry, replay, PID reuse, process exit, stale generations, handle loss, concurrent replacement, driver unload/crash, BFE restart, IPv4/IPv6 byte order, existing-flow behavior, and independent confirmation that the standard companion cannot open the device.
