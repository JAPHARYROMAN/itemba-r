# Launch Readiness Framework

## 1. Overview

The ITEMBA-R Launch Readiness Framework provides a structured methodology for assessing whether the system is ready for production deployment. It ensures that all critical areas — security, accounting integrity, data quality, training, documentation, and operational processes — are verified before go-live.

**Purpose:** To prevent premature go-live and to give the Group Director and all stakeholders confidence that the system is production-ready.

---

## 2. Launch Readiness Assessment Methodology

A **Launch Readiness Assessment (LRA)** is conducted 7–14 days before the intended go-live date. The assessment is performed against the Staging environment (production-equivalent).

### Assessment Process
1. Create a new assessment record: `POST /api/v1/launch/assessments`
2. Populate the assessment with **readiness items** across all 14 categories.
3. Evaluate each item: PASSED, FAILED, or WAIVED.
4. Calculate the score: `PATCH /api/v1/launch/assessments/:id/calculate`
5. Present the assessment to the Group Director.
6. Approve if criteria are met: `PATCH /api/v1/launch/assessments/:id/approve`
7. Record the final sign-off: `POST /api/v1/go-live/signoff`

---

## 3. The 14 Readiness Categories

### Category 1: Security (Weight: 15%)
**Verifies:** Authentication is robust, authorization is correct, data isolation is enforced, audit logging is complete.

**Key items:**
- All AUTH test suite cases pass
- All DATA_ISOLATION test suite cases pass
- All SECURITY test suite cases pass
- Penetration test checklist completed
- No critical security vulnerabilities open

### Category 2: Backup & Restore (Weight: 10%)
**Verifies:** Backup schedule is running, backups are restorable, off-site copy exists.

**Key items:**
- Daily backup schedule confirmed active
- Manual backup successfully completed and verified
- Restore procedure tested on staging database
- Off-site backup storage configured
- Backup monitoring alerts active

### Category 3: Accounting Verification (Weight: 15%)
**Verifies:** All financial transactions produce balanced journal entries and correct financial statements.

**Key items:**
- All ACCOUNTING_VERIFY test suite cases pass
- Trial balance balances to zero variance
- Payroll journal reconciles to gross pay
- Petroleum shift revenue matches collections
- Period lock enforcement verified

### Category 4: Data Quality (Weight: 10%)
**Verifies:** Seed data is correct, opening balances are entered, reference data is complete.

**Key items:**
- Chart of Accounts complete for all companies
- Opening balances entered and verified
- All products with correct stock and reorder levels
- All employees with complete records
- Compliance obligations set up with correct due dates

### Category 5: Performance (Weight: 5%)
**Verifies:** The system responds within acceptable times under expected load.

**Key items:**
- Dashboard loads in < 3 seconds
- Report generation completes in < 10 seconds
- API p95 response time < 1 second
- Load test on staging: 50 concurrent users without degradation
- No N+1 query issues on primary list endpoints

### Category 6: UI/UX (Weight: 5%)
**Verifies:** The interface is usable, consistent, and accessible.

**Key items:**
- UI/UX Review Checklist completed with no critical failures
- Dark mode and light mode both functional
- Mobile responsiveness at 768px and 1024px
- All status badges use consistent colors

### Category 7: Documentation (Weight: 5%)
**Verifies:** All user and admin documentation is published and accessible.

**Key items:**
- All 16 user manuals published in Help Center
- Admin manual published
- Role & Permission guide published
- Backup and Restore guide reviewed by IT Admin
- Deployment guide reviewed by IT Admin
- Known Limitations document signed off

### Category 8: Training (Weight: 10%)
**Verifies:** All key users have completed their training before go-live.

**Key items:**
- 100% training completion for Finance Controller, IT Admin, Petroleum Supervisor
- ≥ 80% training completion for all other key users
- All walkthroughs tested and functional
- Training environment accessible and resettable
- UAT completed with acceptable results

### Category 9: Integrations (Weight: 5%)
**Verifies:** All external integrations are configured and tested.

**Key items:**
- M-Pesa integration configured and STK Push tested
- Airtel Money integration configured and tested
- TigoPesa integration configured and tested
- SMTP email configured and test email sent successfully
- SMS gateway configured and test SMS sent successfully
- At least one device registered for offline sync and tested

### Category 10: Compliance (Weight: 5%)
**Verifies:** All regulatory requirements for operating are met before go-live.

**Key items:**
- TIN numbers recorded for all companies
- VAT registration status confirmed
- All business licenses current and uploaded
- All compliance obligations set up with due dates
- EWURA license current (Mwanjalisi Oil)
- Liquor license current (Westsides)
- Tourism license current (Uzunguni Inn)

### Category 11: User Access (Weight: 5%)
**Verifies:** All go-live users have accounts, correct roles, and have been notified.

**Key items:**
- All go-live user accounts created
- All roles assigned and verified
- All users have completed their assigned training
- All users have been provided the production URL
- No test accounts remain active in production

### Category 12: Reporting (Weight: 5%)
**Verifies:** All critical reports generate correctly.

**Key items:**
- Trial Balance generates without error
- P&L report generates correctly
- Balance Sheet balances
- AR and AP Aging reports are accurate
- Petroleum Daily Reconciliation report runs correctly
- Payroll Summary report is accurate

### Category 13: Deployment (Weight: 5%)
**Verifies:** The production environment is correctly configured and deployable.

**Key items:**
- Production Docker stack tested
- Database migrations deployed successfully to production
- Seed data deployed to production
- Health check returns 200 OK
- Monitoring and alerts configured
- Release log entry created

### Category 14: Support Readiness (Weight: 5%)
**Verifies:** Support processes are in place for go-live day and beyond.

**Key items:**
- Support ticket system active
- IT Admin has confirmed on-call availability for go-live day
- Escalation matrix documented
- SLA times confirmed (URGENT: 2h, HIGH: 8h, NORMAL: 24h)
- Post-launch monitoring plan agreed

---

## 4. Scoring Model

Each category is scored 0–100 based on the percentage of readiness items that pass.

**Formula:**
```
Category Score = (Passed Items / Total Items) × 100
Overall Score = Weighted Average of all Category Scores
```

**Item outcomes:**
- **PASSED:** Item verified — contributes fully to the score.
- **WAIVED:** Item accepted as a risk — contributes to the score but risk is documented.
- **FAILED:** Item not verified — does not contribute to the score and creates a blocker.

---

## 5. READY Criteria

The system is **READY** for go-live when **all** of the following are true:
- ✅ No open CRITICAL launch blockers
- ✅ Overall score ≥ 85/100
- ✅ Security category score = 100/100 (or any failures formally waived by Group Director)
- ✅ Accounting Verification category score = 100/100
- ✅ Group Director has formally approved the assessment

---

## 6. NOT_READY Criteria

The system is **NOT_READY** when any of the following are true:
- ❌ One or more CRITICAL launch blockers remain open
- ❌ Security or Accounting Verification category score < 100
- ❌ Overall score < 75/100
- ❌ Group Director has not signed off

---

## 7. READY_WITH_RISKS Process

When the overall score is 75–84 or when some HIGH (but no CRITICAL) blockers are open:

1. Document each unresolved item as an **accepted risk**.
2. For each risk, document: description, potential impact, mitigation, owner.
3. The Group Director reviews all accepted risks.
4. The Group Director formally accepts the risks in writing (signed document).
5. The assessment status is set to **READY_WITH_RISKS**.
6. Go-live proceeds with the understanding that the documented risks may cause issues post-launch.

---

## 8. Sign-Off Authority Chain

| Role | Responsibility |
|---|---|
| **QA Lead** | Confirms QA suites pass, no critical blockers |
| **IT Administrator** | Confirms deployment, backup, security, integrations |
| **Finance Controller** | Confirms accounting verification, financial data integrity |
| **Group Director** | Final approval — signs the go-live sign-off document |

All four signatures are required on the Final Sign-Off document (`docs/launch/final-signoff-template.md`) before go-live proceeds.
