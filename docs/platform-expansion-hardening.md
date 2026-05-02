# ITEMBA-R — Platform Expansion Hardening Notes

## Current implementation slice

This document records the first Iteration 10 hardening pattern for offline sync expansion.

## Shared offline sync control source

`OfflineSyncControlService` centralizes conflict-resolution safety for mobile/PWA offline workflows.

It currently supports conflict resolution actions:

- `USE_SERVER`
- `USE_CLIENT`
- `MERGE`
- `REJECT`

## Conflict resolution behavior

Offline sync conflict resolution now enforces:

- only records in `CONFLICT` status can be resolved
- resolution action must be explicit and valid
- `MERGE` requires an explicit resolved value
- `REJECT` marks the sync record as `REJECTED`
- `USE_SERVER`, `USE_CLIENT`, and `MERGE` mark the record as `PROCESSED`

The conflict list query now applies company filtering through the parent sync batch relation, so company-scoped conflict views do not leak records from other batches.

## Expansion safety pattern

New platform-expansion features should follow this pattern:

1. Add a small control service for domain-specific safety rules.
2. Keep lifecycle transitions explicit and tested.
3. Route mutations through existing auth, audit, and company-scope checks.
4. Persist enough metadata for support, replay, and operator review.
5. Add frontend conflict/exception states only after backend transitions are deterministic.

## Test coverage

`OfflineSyncControlService` has focused unit coverage for:

- rejecting non-conflict records
- normalizing and validating resolution actions
- resolving with server value
- resolving with client payload
- requiring merge output
- rejecting a conflicted record

## Next platform-expansion modules

Recommended order:

1. Add offline sync conflict review UI with side-by-side client/server/resolved values.
2. Add PWA hardening: service worker cache policy, offline route states, and sync retry queue visibility.
3. Add Swahili localization catalog structure and locale selection.
4. Add biometric attendance integration through the existing integration and audit controls.
5. Add forecasting/scenario planning behind explicit company-scope and data-source freshness checks.
