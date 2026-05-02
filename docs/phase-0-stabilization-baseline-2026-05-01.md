# ITEMBA-R Phase 0 Stabilization Baseline

Date: 2026-05-01

Workspace: `C:\projects\Actual Projects\itemba-r`

Canonical plan: `docs/master-audit-remediation-plan-2026-05-01.md`

Phase: 0 - Stabilization Baseline

Objective: freeze the release posture, establish the current technical baseline, capture failing verification lanes, create the working remediation register, and define the handoff into Phase 1.

---

## 1. Phase 0 Decision

Current release posture: blocked.

No production deployment, unsupervised pilot, or real production data migration should proceed from this workspace state.

Reason:

- Root verification fails at frontend production build.
- Frontend tests cannot start because `vitest` is not available in installed frontend dependencies.
- Backend tests do not complete within the Phase 0 timeout.
- Production compose resolves with blank secrets and unsafe defaults.
- This workspace is not a Git repository, so a remediation branch cannot be created locally from this copy.
- The master audit still contains unresolved P0 control failures around company isolation, inventory/fuel atomicity, role assignment, auth hardening, workers/backups/exports, API keys, and payroll/accounting side effects.

---

## 2. Phase 0 Scope

Phase 0 does not attempt broad code fixes. It establishes a controlled starting line.

Included:

1. Inspect verification, test, CI, and deployment scripts.
2. Confirm repository control status.
3. Run baseline verification commands.
4. Capture pass/fail outcomes.
5. Confirm production compose behavior.
6. Create remediation tracking documents.
7. Define Phase 1 entry conditions.

Not included:

- Refactoring company isolation.
- Fixing frontend lint/build errors.
- Implementing CSRF protection.
- Changing production Docker files.
- Repairing tests.
- Building workers.
- Changing business workflows.

Those move into Phase 1 and later phases after the baseline is explicit.

---

## 3. Environment Baseline

Tool versions observed:

| Tool | Version |
|---|---|
| Node.js | `v22.13.1` |
| npm | `11.1.0` |
| Docker | `29.3.1` |
| Docker Compose | `v5.1.1` |

Workspace status:

| Check | Result |
|---|---|
| Git repository | Failed - this workspace returned `NOT_A_GIT_REPOSITORY` |
| Root package scripts | Present |
| Backend package scripts | Present |
| Frontend package scripts | Present |
| CI workflow | Present at `.github/workflows/ci.yml` |
| Production compose | Present at `docker-compose.production.yml` |

Test file counts observed:

| Area | Count |
|---|---:|
| Backend `*.spec.ts` under `backend/src` | 16 |
| Backend files under `backend/test` | 6 |
| Frontend test/spec files under `frontend/src` | 2 |

Local executable checks:

| Executable | Present |
|---|---|
| `frontend/node_modules/.bin/vitest.cmd` | No |
| `frontend/node_modules/vitest` | No |
| `backend/node_modules/.bin/jest.cmd` | Yes |
| `backend/node_modules/.bin/nest.cmd` | Yes |

---

## 4. Baseline Command Results

### 4.1 Root local verification

Command:

```powershell
npm run verify:local
```

Result: failed.

Elapsed: 220.88 seconds.

Observed path:

1. Prisma schema validation passed.
2. Prisma client generation passed this time.
3. Backend type check passed.
4. Backend build passed.
5. Frontend type check passed.
6. Frontend production build failed during linting.

Important note:

The prior audit observed Prisma generate failing with `write UNKNOWN`. In this Phase 0 run, Prisma generate succeeded and took 141.90 seconds. The active blocker for this command is now the frontend production build.

### 4.2 Backend locked verification

Command:

```powershell
npm run verify:backend:locked
```

Result: passed.

Elapsed: 48.38 seconds.

Observed path:

1. Prisma schema validation passed.
2. Backend type check passed.
3. Backend build passed.

Interpretation:

The backend can currently validate, typecheck, and build when Prisma generation is skipped.

### 4.3 Frontend local verification

Command:

```powershell
npm run verify:frontend:local
```

Result: failed.

Elapsed: 17.37 seconds.

Observed path:

1. Frontend type check passed.
2. Next.js production compilation passed.
3. Lint/type validity phase failed on `react/no-unescaped-entities` errors.

Blocking lint errors:

| File | Line(s) | Rule |
|---|---:|---|
| `frontend/src/app/(dashboard)/construction/billing/page.tsx` | 316 | `react/no-unescaped-entities` |
| `frontend/src/app/(dashboard)/construction/labour-cost/page.tsx` | 271 | `react/no-unescaped-entities` |
| `frontend/src/app/(dashboard)/hospitality/folio/[bookingId]/page.tsx` | 426 | `react/no-unescaped-entities` |
| `frontend/src/app/(dashboard)/hr/disputes/[id]/page.tsx` | 204 | `react/no-unescaped-entities` |
| `frontend/src/app/(dashboard)/hr/petroleum-commissions/page.tsx` | 228 | `react/no-unescaped-entities` |
| `frontend/src/app/(dashboard)/petroleum/fuel-shifts/page.tsx` | 231, 287 | `react/no-unescaped-entities` |
| `frontend/src/app/(dashboard)/petroleum/fuel-shifts/[id]/page.tsx` | 373, 626 | `react/no-unescaped-entities` |
| `frontend/src/app/(dashboard)/settings/preferences/page.tsx` | 270 | `react/no-unescaped-entities` |
| `frontend/src/app/(dashboard)/westsides/daily-close/page.tsx` | 170 | `react/no-unescaped-entities` |

Non-blocking warnings observed:

- Multiple `react-hooks/exhaustive-deps` warnings across BI, compliance, HR, monitoring, petroleum, reports, sales, security, support, and command palette code.
- `@next/next/no-page-custom-font` warning in `frontend/src/app/layout.tsx`.

Interpretation:

The first Phase 1 engineering fix should clear the blocking JSX entity errors without disabling the rule globally.

### 4.4 Frontend tests

Command:

```powershell
cd frontend
npm test
```

Result: failed.

Elapsed: 0.32 seconds.

Failure:

```text
'vitest' is not recognized as an internal or external command,
operable program or batch file.
```

Interpretation:

`vitest` is declared in `frontend/package.json`, but it is not installed in the current `frontend/node_modules`. The frontend test lane is currently blocked by dependency/install state before test quality can even be evaluated.

### 4.5 Backend tests

Command:

```powershell
cd backend
npm test -- --runInBand
```

Result: timed out.

Timeout: 244.199 seconds.

Interpretation:

The backend test lane is currently non-actionable as a gate because it does not complete within a reasonable Phase 0 timeout. The first remediation is to isolate the hang, not to add more tests on top of an unstable runner.

### 4.6 Production compose config

Command:

```powershell
docker compose -f docker-compose.production.yml config
```

Result: passed syntactic compose rendering.

Elapsed: 0.50 seconds.

Important resolved values:

| Setting | Resolved value / issue |
|---|---|
| `POSTGRES_PASSWORD` | blank string when env var missing |
| `JWT_ACCESS_SECRET` | blank string when env var missing |
| `JWT_REFRESH_SECRET` | blank string when env var missing |
| `REDIS_PASSWORD` | blank string when env var missing |
| `CORS_ORIGIN` | defaults to `http://localhost:3000` |
| `TWO_FACTOR_ENCRYPTION_KEY` | absent from backend environment |
| Redis command | resolves `--requirepass` without a password when env var missing |

Compose warnings:

- `POSTGRES_PASSWORD` is not set.
- `REDIS_PASSWORD` is not set.
- `JWT_ACCESS_SECRET` is not set.
- `JWT_REFRESH_SECRET` is not set.

Interpretation:

The compose file is syntactically valid but not production-safe. It does not fail fast on missing secrets and still omits `TWO_FACTOR_ENCRYPTION_KEY`, which backend validation requires in production.

---

## 5. CI Baseline

CI workflow exists at `.github/workflows/ci.yml`.

Observed jobs:

- Prisma schema validation.
- Backend lint/typecheck.
- Frontend lint/typecheck.
- Backend build.
- Backend test.
- Frontend build.
- Docker backend image build on `main`.
- Docker frontend image build on `main`.

Important weaknesses:

1. Backend test job runs:

```yaml
npm test --if-present -- --passWithNoTests
```

This weakens the test gate because an absent or ineffective test suite can still pass.

2. CI validates and builds Docker images, but does not validate production compose with required env/secrets.

3. CI does not appear to enforce the master remediation gates from this plan, especially company-scope regression checks.

4. CI frontend build should currently fail on the same lint errors if it runs against the same source.

---

## 6. Phase 0 Completion Matrix

| Phase 0 item | Status | Evidence / note |
|---|---|---|
| Freeze release posture | Complete | This document marks release as blocked |
| Create remediation branch | Blocked | Workspace is not a Git repository |
| Create issue/remediation register | Complete | `docs/remediation-register-2026-05-01.md` |
| Re-run root verify | Complete | Failed at frontend build |
| Re-run backend verify | Complete | Passed with locked Prisma generate skip |
| Re-run frontend verify | Complete | Failed at frontend build lint |
| Re-run frontend tests | Complete | Failed because `vitest` unavailable |
| Re-run backend tests | Complete | Timed out after 244.199 seconds |
| Validate production compose | Complete | Syntactically valid but unsafe defaults/missing secrets |
| Assign role-level owners | Complete | Workstream owners defined in remediation register |
| Assign named people | Pending human action | Requires project staffing decision |
| Define Phase 1 entry point | Complete | See Section 8 |

---

## 7. Workstream Ownership For Phase 1

Named human owners still need assignment. Until then, ownership is by workstream.

| Workstream | Phase 1 responsibility |
|---|---|
| Frontend | Fix production build blockers; prepare auth proxy CSRF work |
| DevOps/Runtime | Fix production env/compose, migration path, Docker non-root users |
| Security/Tenancy | Disable/harden registration, login throttle, CSRF, first company-scope refactor |
| Finance/Inventory | Start inventory and fuel-shift atomicity remediation design |
| QA/Automation | Stabilize frontend/backend test runners and add first P0 regression tests |
| Product/ERP Controls | Confirm registration policy, role assignment rules, pilot gating policy |

---

## 8. Phase 1 Entry Point

Phase 1 should begin with the smallest set of changes that removes immediate production no-go blockers while creating room for deeper control fixes.

Recommended Phase 1 sequence:

1. Fix frontend production build errors.
2. Repair frontend test dependency/install state.
3. Patch production env/compose for required secrets, CORS naming, fail-fast behavior, migration deploy, and non-root users.
4. Disable or harden public registration.
5. Add route-specific login/register throttling.
6. Add CSRF token and Origin checks for non-GET backend proxy calls.
7. Start company-scope enforcement with the highest-risk modules:
   - journal entries
   - payroll runs
   - fuel shifts
   - inventory movements
   - customers
   - exports/reports
   - users/roles
8. Add cross-company e2e tests for the modules touched in step 7.

Exit criteria for Phase 1:

- `npm run verify:local` passes.
- `npm run verify:frontend:local` passes.
- `cd frontend && npm test` starts and completes.
- `cd backend && npm test -- --runInBand` completes or has a documented split between unit/integration test commands.
- Production compose cannot silently render blank required secrets.
- First high-risk company-scope tests pass.

---

## 9. Phase 0 Final Status

Phase 0 is complete as a baseline capture.

The platform remains blocked for production. The next engineering action should be Phase 1, starting with frontend build repair and production deployment hardening, while Security/Tenancy begins the company-scope enforcement pattern in parallel.
