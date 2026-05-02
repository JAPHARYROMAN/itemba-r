# ITEMBA-R — Financial Control Hardening Notes

## Current implementation slice

This document records the first Iteration 3 hardening pattern for accounting controls.

## Shared control source

`AccountingControlService` is the shared service for validating whether accounting mutations are allowed.

It currently enforces:

- the accounting period exists when referenced
- the period belongs to the same company as the transaction
- the period status is `OPEN`
- the transaction date falls within the period start/end range
- no active accounting lock covers the transaction date or period

## Journal entry controls

`journal-entries` now calls the accounting control service before:

- creating draft journal entries
- updating draft journal entries
- posting journal entries
- reversing posted journal entries
- deleting draft journal entries

Additional ledger guardrails added:

- journal entry company cannot be changed after creation
- all line accounts must be active chart-of-account records for the journal company
- reversal entries are blocked if the target reversal date is locked or outside the original period

## Test coverage

`AccountingControlService` has focused unit coverage for:

- accepting an open period containing the transaction date
- rejecting closed periods
- rejecting period/company mismatches
- rejecting transaction dates outside the period range
- rejecting active accounting locks

## Next financial-control modules

Recommended order:

1. `accounting-periods`: prevent closing periods with unposted draft journals or unresolved locks.
2. `accounting-locks`: validate date ranges and require audited release reasons.
3. `expenses`, `payables`, `receivables`: route posting through the same accounting control service.
4. `intercompany-transactions`: enforce both source and destination company periods.
5. `financial-reports`: add reconciliation checks from reports back to posted journal lines.

