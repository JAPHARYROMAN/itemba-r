# ITEMBA-R Background Jobs

## Overview
ITEMBA-R uses a database-backed background job queue to handle heavy asynchronous tasks without blocking API responses.

## Architecture
- Jobs are stored in the `BackgroundJob` table
- Queue configuration is in `JobQueueConfig`
- Each job has: type, queue, status, priority, payload, result, retry tracking

## Job Types

| Type | Description |
|---|---|
| `REPORT_GENERATION` | Async report generation for large datasets |
| `DATA_EXPORT` | CSV/Excel data export |
| `NOTIFICATION_DISPATCH` | Batch notification sending |
| `ALERT_EVALUATION` | Alert rule evaluation |
| `AUTOMATION_RUN` | Business automation execution |
| `BI_SNAPSHOT` | BI KPI snapshot generation |
| `DATA_QUALITY_CHECK` | Data quality checks |
| `INTEGRATION_RETRY` | External integration retry |
| `WEBHOOK_PROCESSING` | Incoming webhook processing |
| `OFFLINE_SYNC_PROCESSING` | Offline data sync processing |
| `BACKUP_RUN` | Automated backup execution |
| `EMAIL_SEND` | Email dispatch |
| `SMS_SEND` | SMS dispatch |

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
