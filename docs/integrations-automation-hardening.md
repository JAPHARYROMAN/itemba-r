# ITEMBA-R — Integrations and Automation Hardening Notes

## Current implementation slice

This document records the first Iteration 7 hardening pattern for webhook integration controls.

## Shared webhook control source

`WebhookEventControlService` centralizes webhook safety checks that should be reused by inbound webhook ingestion and replay workflows.

It currently supports:

- constant-time verification of a provided webhook secret against the stored endpoint secret hash
- active endpoint enforcement
- allowed event-name enforcement
- duplicate event lookup by external event ID, endpoint, and provider
- guarded replay/reprocess eligibility

## Reprocess controls

`webhook-events` now calls the control service before resetting an event for reprocessing.

Events can be reprocessed only when:

- verification did not fail
- processing status is `FAILED`, `IGNORED`, or `DUPLICATE`

This prevents accidental replay of already processed events and blocks replay of untrusted payloads.

## Test coverage

`WebhookEventControlService` has focused unit coverage for:

- verifying shared secrets through stored hashes
- accepting unrestricted active endpoints
- rejecting inactive endpoints
- rejecting unsupported event names
- looking up duplicate external events only when an external event ID exists
- allowing replay only for eligible processing statuses with valid verification

## Next integration modules

Recommended order:

1. Add a dedicated inbound webhook ingestion controller that records payload, headers, verification status, duplicate status, and audit context.
2. Add delivery attempt tracking fields or a delivery-attempt table for retries and dead-letter workflows.
3. Add API client scope enforcement at gateway boundaries.
4. Add webhook signing for outbound deliveries with timestamped signatures.
5. Add automation run retry/backoff controls and dead-letter visibility.
