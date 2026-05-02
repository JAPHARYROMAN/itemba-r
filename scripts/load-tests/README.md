# ITEMBA-R Load Tests

Performance testing scripts using [k6](https://k6.io).

## Prerequisites

Install k6:
- **Windows**: `winget install k6` or download from https://k6.io/docs/get-started/installation/
- **Linux/Mac**: `brew install k6` or follow https://k6.io/docs/get-started/installation/

## Configuration

Set the base URL before running:

```bash
# Default (development)
export BASE_URL=http://localhost:3001

# Staging
export BASE_URL=https://staging-api.itemba-r.co.tz

# Production (read-only tests only!)
export BASE_URL=https://api.itemba-r.co.tz
```

## Running Tests

```bash
# Auth load test
k6 run --env BASE_URL=http://localhost:3001 scripts/load-tests/auth.k6.js

# Petroleum shift test
k6 run --env BASE_URL=http://localhost:3001 scripts/load-tests/petroleum.k6.js

# Sales order test
k6 run --env BASE_URL=http://localhost:3001 scripts/load-tests/sales.k6.js

# Payroll test (read-only)
k6 run --env BASE_URL=http://localhost:3001 scripts/load-tests/payroll.k6.js

# BI Dashboard test
k6 run --env BASE_URL=http://localhost:3001 scripts/load-tests/bi-dashboard.k6.js

# Full suite
k6 run --env BASE_URL=http://localhost:3001 scripts/load-tests/full-suite.k6.js
```

## Performance Targets

| Metric | Target |
|--------|--------|
| Average response time | < 200ms |
| p95 response time | < 500ms |
| p99 response time | < 1000ms |
| Error rate | < 1% |
| Login throughput | > 50 req/s |
| List endpoint throughput | > 100 req/s |

## Interpreting Results

k6 outputs:
- `http_req_duration` — response time stats
- `http_req_failed` — error rate
- `http_reqs` — request throughput
- `vus` — virtual users active

A test passes if all thresholds are green (✓).
