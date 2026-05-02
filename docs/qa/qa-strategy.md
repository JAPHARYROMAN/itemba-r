# QA Strategy

## 1. QA Philosophy

**Verify, don't assume.** Every feature in ITEMBA-R that affects financial integrity, data isolation, security, or user experience must be verified by a documented test case with a recorded result before the system goes live. A feature is not complete until it is tested and passes.

QA in ITEMBA-R is not a final gate — it is a continuous quality activity that runs alongside development. Defects found early are cheaper to fix and cause less disruption.

---

## 2. Test Types

| Type | When | Performed By | Tooling |
|---|---|---|---|
| **Manual Functional** | Feature complete | QA Lead, Testers | ITEMBA-R QA Module |
| **Manual Security** | Security feature complete | QA Lead + IT Admin | ITEMBA-R QA Module |
| **Manual UAT** | T-14 days before go-live | Company Managers, Key Users | ITEMBA-R QA Module |
| **Automated (Planned)** | Phase 2 | Development Team | Playwright, Jest |
| **Regression** | After each new release | QA Lead | ITEMBA-R QA Module |
| **Load/Performance** | T-7 days before go-live | IT Admin | External tool (k6, Apache JMeter) |

---

## 3. Test Suite Coverage Map

ITEMBA-R has 22 pre-seeded QA test suites organized by module:

| Suite | Module | Test Cases | Priority |
|---|---|---|---|
| AUTH | Authentication & Sessions | ~20 | Critical |
| FINANCE | Finance & Accounting | ~30 | Critical |
| PETROLEUM | Petroleum Operations | ~25 | Critical |
| HR | HR & Payroll | ~25 | Critical |
| SECURITY | Security Controls | ~20 | Critical |
| GROUP_CONTROL | Group Control Access | ~15 | High |
| PROCUREMENT | Procurement Workflow | ~20 | High |
| SALES_INVENTORY | Sales & Inventory | ~20 | High |
| WESTSIDES | Westsides Operations | ~20 | High |
| ITEMBA | Itemba Enterprises Divisions | ~25 | High |
| RENTALS | Rentals & Parking | ~15 | High |
| HOSPITALITY | Hospitality (Uzunguni Inn) | ~20 | High |
| COMPLIANCE | Compliance & Tax | ~15 | High |
| APPROVALS | Approvals & Controls | ~15 | High |
| BI_REPORTS | BI & Reporting | ~15 | Medium |
| INTEGRATIONS | Integrations Module | ~15 | Medium |
| DATA_ISOLATION | Cross-Company Data Isolation | ~20 | Critical |
| ACCOUNTING_VERIFY | Accounting Verification | ~20 | Critical |
| UI_UX | UI/UX & Design System | ~25 | Medium |
| TRAINING | Training & Help System | ~10 | Medium |
| SUPPORT | Support Ticket System | ~10 | Low |
| LAUNCH_READINESS | Launch Readiness Assessment | ~15 | Critical |

---

## 4. QA Environments

| Environment | Purpose | Data |
|---|---|---|
| **Test** | Active QA testing during development | Seeded test data — can be reset |
| **Staging** | Pre-production testing, UAT | Production-like data volume |
| **Production** | Live system | Real company data — no test activities |

> **Never perform QA test activities in the production environment.** Test data, test transactions, and test users must only exist in the Test or Staging environments.

Resetting the test environment:
```bash
# Reset test database and re-seed
cd backend && npm run prisma:reset
```

---

## 5. QA Roles

| Role | Responsibility |
|---|---|
| **QA Lead** | Plan and oversee all QA activities. Approve test results. Create and manage launch blockers. Sign off on QA readiness. |
| **Company QA Testers** | Execute test cases for their company's modules. Record results and evidence. |
| **IT Admin** | Execute security and infrastructure tests. Support environment setup. |
| **Finance Tester** | Execute accounting verification test cases. |
| **HR Tester** | Execute HR and payroll test cases. |

---

## 6. Defect Severity Levels

| Level | Definition | SLA to Resolve |
|---|---|---|
| **CRITICAL** | System crashes, data loss, security breach, financial integrity failure, data isolation failure. Cannot go live. | Before go-live (blocks launch) |
| **HIGH** | Major feature broken, significant workflow disruption, incorrect calculations. Workaround may exist but is unacceptable for production. | Before go-live (blocks launch) |
| **MEDIUM** | Feature partially broken or inconvenient. Workaround exists. Does not compromise data integrity. | Post-launch Phase 2 |
| **LOW** | Minor UI issue, cosmetic problem, typo, non-critical suggestion. | Post-launch when convenient |

---

## 7. Launch Blocker Creation Rules

A **Launch Blocker** is created when a test case result is marked **FAIL** and the severity warrants a blocker.

Rules for creating launch blockers:
1. **Always create a CRITICAL blocker** when any test case in the AUTH, FINANCE, SECURITY, DATA_ISOLATION, or ACCOUNTING_VERIFY suites fails.
2. **Create a HIGH blocker** when a test case fails and the failure affects a primary operational workflow (shift opening/closing, payroll, invoice posting, order processing).
3. **Do not create LOW blockers** — log them as issues to be addressed post-launch.
4. **MEDIUM failures** are documented as risks for the launch sign-off decision.

Blocker records must include:
- Clear description of the failure
- Test case reference
- Steps to reproduce
- Evidence (screenshot, video, log extract)
- Assigned developer for resolution

---

## 8. Go-Live Readiness Gates

The system is ready for go-live when **all** of the following are true:

✅ **Gate 1 — No Open CRITICAL Blockers**
Zero open launch blockers with severity CRITICAL.

✅ **Gate 2 — No Open HIGH Blockers (or accepted)**
Zero open HIGH blockers, OR all HIGH blockers have been reviewed by the Group Director and formally accepted as known risks.

✅ **Gate 3 — Critical Suites Pass**
All test cases in AUTH, FINANCE, SECURITY, DATA_ISOLATION, and ACCOUNTING_VERIFY suites have passed (or been formally waived with documented justification).

✅ **Gate 4 — UAT Signed Off**
All UAT participants have completed their scenarios and signed the UAT sign-off form.

✅ **Gate 5 — Final Sign-Off**
The Final Go-Live Sign-Off document (`docs/launch/final-signoff-template.md`) has been completed and signed by all required signatories.

A system that fails any of these gates is **NOT_READY** for go-live.
