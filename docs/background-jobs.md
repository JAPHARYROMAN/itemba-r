# ITEMBA-R Background Jobs

## Overview

ITEMBA-R uses a database-backed background job queue to handle heavy asynchronous tasks without blocking API responses.

## Architecture

- Jobs are stored in the `BackgroundJob` table
- Queue configuration is in `JobQueueConfig`
- Each job has: type, queue, status, priority, payload, result, retry tracking

## Job Types

| Type                      | Description                                |
| ------------------------- | ------------------------------------------ |
| `REPORT_GENERATION`       | Async report generation for large datasets |
| `DATA_EXPORT`             | CSV/Excel data export                      |
| `NOTIFICATION_DISPATCH`   | Batch notification sending                 |
| `ALERT_EVALUATION`        | Alert rule evaluation                      |
| `AUTOMATION_RUN`          | Business automation execution              |
| `BI_SNAPSHOT`             | BI KPI snapshot generation                 |
| `DATA_QUALITY_CHECK`      | Data quality checks                        |
| `INTEGRATION_RETRY`       | External integration retry                 |
| `WEBHOOK_PROCESSING`      | Incoming webhook processing                |
| `OFFLINE_SYNC_PROCESSING` | Offline data sync processing               |
| `BACKUP_RUN`              | Automated backup execution                 |
| `EMAIL_SEND`              | Email dispatch                             |
| `SMS_SEND`                | SMS dispatch                               |

## Job Lifecycle

```
QUEUED → RUNNING → COMPLETED
           ↓
         FAILED → RETRYING → RUNNING (retry)
                          ↓
                      DEAD_LETTER (max retries exceeded)
QUEUED → CANCELLED
```

## Idempotency

Pass an `idempotencyKey` when enqueueing to prevent duplicate jobs. If a job with the same key exists in a non-terminal state, the existing job is returned.

## Priority

- `CRITICAL` — processed first
- `HIGH`
- `NORMAL` (default)
- `LOW`

## Monitoring

View jobs at: **Performance & Ops → Background Jobs**

- Filter by status, type, queue, company
- Retry failed jobs
- Cancel queued/running jobs
- Move to dead-letter manually

## Queue Config

Configure at: **Performance & Ops → Job Queues**

- Set concurrency per queue
- Configure retry backoff
- Enable/disable queues

## Production Worker Runtime

- Start workers with `JOB_WORKER_ENABLED=true`.
- Multiple API/worker replicas may run the worker loop. Leasing uses Postgres row locks plus queue-level advisory locks, so workers should lease different jobs while respecting configured queue concurrency.
- Set `JobQueueConfig.concurrency` for each queue that touches external systems or shared artifacts. Use `1` for backups unless the storage target and database can handle parallel dumps.
- Set `JobQueueConfig.timeoutSeconds` for long-running queues. Timed-out jobs go through the normal retry/dead-letter path.
- Stale `RUNNING` jobs older than the worker stale threshold are moved to `RETRYING` or `DEAD_LETTER` with attempts incremented. Final stale failures also mark linked exports, backup runs, or restore tests as failed.
- Backup artifacts are written under `BACKUPS_DIR` through a temporary file and are renamed only after `pg_dump` succeeds. Completed backups record size and SHA-256 checksum.
- Data export artifacts are written under `EXPORTS_DIR`; completed export and backup jobs are idempotent and are skipped if the linked artifact already exists.

## Operational Checks

- Alert on any `DEAD_LETTER` jobs.
- Alert when `backups` queue has stale `RUNNING` jobs or failed runs in the last 24 hours.
- Run restore verification for completed database backups; checksum verification should create a `PASSED` restore-test row.
- Keep `BACKUPS_DIR` and `EXPORTS_DIR` on persistent storage in production. Local container filesystems are acceptable only for development and disposable CI.
