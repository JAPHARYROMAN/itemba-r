# ITEMBA-R — Reporting, BI, and Executive Controls Notes

## Current implementation slice

This document records the first Iteration 6 hardening pattern for BI-backed data quality controls.

## Shared data-quality runner

`DataQualityCheckRunnerService` centralizes repeatable checks that support executive reporting confidence.

It currently runs checks for:

- negative inventory balances
- companies without configured bank accounts
- stale draft journal entries older than 7 days
- overdue receivables
- report runs stuck in `REQUESTED` or `RUNNING` for more than 30 minutes
- fuel daily reconciliations older than 2 days that have not reached `POSTED`

## Reporting control behavior

The runner now returns a traceable result payload:

- total records checked
- existing open or acknowledged issues
- newly created issues
- per-check counts
- created issue records

Issue creation is de-duplicated by entity type, entity ID, issue type, and open/acknowledged status. Existing unresolved findings are counted instead of duplicated.

## Data-quality summary

`DataQualityService.getSummary` now respects the current user's company scope and returns `totalOpen` alongside grouped severity, type, and status counts.

## Audit behavior

`DataQualityService.runChecks` now logs a `DATA_QUALITY_CHECK_RUN` audit entry with the run result and company context.

## Test coverage

`DataQualityCheckRunnerService` has focused unit coverage for:

- creating traceable stale report-run findings
- creating traceable unposted fuel-reconciliation findings
- avoiding duplicate open or acknowledged issues
- scoping check queries to the current user's company

## Next BI control modules

Recommended order:

1. Add KPI catalog ownership and source-record metadata for executive dashboard cards.
2. Store report export audit metadata: user, filters, format, row count, and timestamp.
3. Add retry lifecycle controls for failed scheduled report runs.
4. Add frontend trace links from data-quality issues to source records.
5. Add dashboard metric freshness indicators and stale-source warnings.
