# ITEMBA-R — Performance, Observability, and Resilience Notes

## Current implementation slice

This document records the first Iteration 9 hardening pattern for trace budgets and job lifecycle controls.

## Shared observability budget source

`ObservabilityBudgetService` centralizes performance budgets and resilience guards.

It currently defines trace budgets for:

- API requests
- database queries
- report runs
- background jobs
- page loads
- exports
- sync operations
- custom traces

## Trace budget behavior

Each trace evaluation returns:

- trace type
- observed duration
- budget duration
- budget pass/fail
- severity: `OK`, `WARNING`, or `CRITICAL`
- recommended action

The performance dashboard now includes a daily `budgetSummary` with evaluated traces, breach counts, critical/warning counts, breach rate, and the breached trace details.

## Background job resilience controls

Background job retry/cancel behavior now uses shared lifecycle guards:

- retries are allowed only for `FAILED` or `DEAD_LETTER` jobs below max attempts
- cancellation is allowed only for `QUEUED`, `RUNNING`, or `RETRYING` jobs

This prevents accidental retries of completed jobs and cancellation of terminal records.

## Test coverage

`ObservabilityBudgetService` has focused unit coverage for:

- passing traces within budget
- warning and critical budget breach classification
- breach summary counts and breach rate
- retry eligibility
- cancellation eligibility

## Next resilience modules

Recommended order:

1. Add a request correlation ID middleware/interceptor and persist correlation IDs into performance traces and error logs.
2. Add structured request logging with duration, user, company, route, status, and correlation ID.
3. Add cache invalidation policies for dashboard/report cache entries.
4. Add restore-drill result checks to backup dashboards.
5. Add load-test threshold definitions for auth, finance reports, petroleum shifts, payroll, and BI dashboards.
