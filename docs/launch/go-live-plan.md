# Go-Live Plan

## Overview

This document provides the detailed plan for the ITEMBA-R go-live. It covers the pre-launch timeline (T-30 to T-1), the minute-by-minute go-live day schedule, post-launch monitoring, rollback criteria, and the communication plan.

---

## 1. Pre-Launch Timeline

### T-30 Days
- Complete all critical QA suites (AUTH, FINANCE, PETROLEUM, HR, SECURITY, DATA_ISOLATION, ACCOUNTING_VERIFY).
- Resolve all CRITICAL launch blockers.
- Begin training program — IT Admin and Finance team first.
- Provision staging environment to production specification.
- Configure monitoring and alerting on staging.

### T-21 Days
- Operations staff training: Petroleum, Westsides, Itemba divisions.
- Load test on staging environment (50 concurrent users, 1 hour).
- Complete all GROUP_CONTROL, COMPLIANCE, and INTEGRATIONS QA suites.
- Address any HIGH blockers from QA.

### T-14 Days
- UAT period begins — trained staff use staging for real-scenario testing.
- Admin documentation finalized and published in Help Center.
- Production environment provisioned and hardened.
- SSL certificate installed and verified on production.
- Firewall rules configured — block all non-essential ports.

### T-7 Days
- UAT sign-off by all participants.
- Full backup and restore test (backup staging, restore to clean server, verify).
- All API integrations verified: M-Pesa STK Push, Airtel Money, TigoPesa, SMTP, SMS.
- Offline sync device registration tested.
- All user accounts created in production with correct roles.

### T-3 Days
- Production database migration dry run on staging (run `npx prisma migrate deploy` one more time — should show "up to date").
- Final security review.
- Confirm backup schedule on production.
- Final staff communication: go-live date, URL, credentials.

### T-1 Day
| Time | Task | Owner |
|---|---|---|
| 09:00 | Take backup of staging database (reference snapshot) | IT Admin |
| 10:00 | Run `npx prisma migrate deploy` on production | IT Admin |
| 10:30 | Run `npm run db:seed` on production | IT Admin |
| 11:00 | Verify health check on production | IT Admin |
| 12:00 | Test Group Super Admin login on production | IT Admin |
| 13:00 | Test one Company Manager login per company | IT Admin |
| 14:00 | Verify M-Pesa integration on production (test payment) | IT Admin |
| 15:00 | Verify SMTP on production (send test email) | IT Admin |
| 16:00 | Confirm backup schedule is active | IT Admin |
| 16:30 | Confirm monitoring alerts are firing on test alert | IT Admin |
| 17:00 | All go-live signatories confirm readiness | Group Director |
| 17:30 | Final sign-off document signed by all parties | All signatories |

---

## 2. Go-Live Day — Minute-by-Minute Plan

**Go-Live Date:** _______________
**Go-Live Time:** 08:00 EAT

| Time | Task | Owner | Status |
|---|---|---|---|
| 07:30 | IT Admin on-site / available on call | IT Admin | ☐ |
| 07:45 | Deploy production Docker stack | IT Admin | ☐ |
| 07:50 | Verify all containers running: `docker compose ps` | IT Admin | ☐ |
| 07:55 | Health check: `GET /api/v1/health` — must return 200 OK | IT Admin | ☐ |
| 08:00 | **PRODUCTION GOES LIVE** | | |
| 08:01 | Verify frontend accessible via browser | IT Admin | ☐ |
| 08:05 | Test login as Group Super Admin | IT Admin | ☐ |
| 08:10 | Test login as Mwanjalisi Company Manager | Station Manager | ☐ |
| 08:15 | Test login as Westsides Company Manager | Westsides Manager | ☐ |
| 08:20 | Test login as Itemba Company Manager | Itemba Manager | ☐ |
| 08:25 | Run smoke test: Create a customer, record a sale | Accountant | ☐ |
| 08:30 | Verify notifications working (send test notification) | IT Admin | ☐ |
| 08:35 | Confirm backup schedule running | IT Admin | ☐ |
| 08:40 | Open monitoring dashboard — no errors in first 10 minutes | IT Admin | ☐ |
| 08:45 | All-clear communication to Group Director | IT Admin | ☐ |
| 09:00 | First operational transaction: Mwanjalisi opens morning shift | Station Manager | ☐ |
| 09:15 | Monitor error logs for anomalies | IT Admin | ☐ |
| 10:00 | First-hour review meeting (10 minutes) | IT Admin + Finance | ☐ |

---

## 3. Post-Launch Monitoring Plan

### First 2 Hours (08:00–10:00)
- IT Admin monitors error logs continuously.
- Alert threshold: any ERROR-level log entry requires immediate investigation.
- Support hotline active — IT Admin reachable by phone.

### First 24 Hours
- Check error logs every 2 hours.
- Monitor API response time (target: p95 < 1 second).
- Verify backup completed at 2:00 AM.
- Review security events for unusual patterns.
- Handle any urgent support tickets (target: response within 2 hours).
- Brief Group Director at end of day 1.

### First Week
- Daily error log review.
- Daily backup verification.
- Support ticket review and resolution.
- Collect user feedback from each company's manager.
- Monitor database size growth.
- Review performance metrics — identify any slow queries.

### First Month
- 30-day post-launch review meeting with all company managers.
- Compile list of post-launch improvements (not blockers).
- Review support ticket patterns for training gaps.
- Review security events for any suspicious patterns.
- Verify all compliance obligations are being tracked and filed on time.

---

## 4. Rollback Trigger Criteria

Rollback to the previous state is triggered if **any** of the following occur within the first 4 hours of go-live:

| Trigger | Description |
|---|---|
| **Data Corruption** | Any evidence that financial data is being corrupted or incorrectly written |
| **Authentication Failure** | Users cannot log in (affecting > 20% of users) |
| **Data Isolation Breach** | Any evidence of Company A user seeing Company B data |
| **Financial Integrity Failure** | Journal entries not balancing, trial balance not matching |
| **Complete System Outage** | Application returns 500 errors for > 15 minutes |

### Rollback Procedure
1. Notify Group Director immediately.
2. Display maintenance message on frontend.
3. Stop the backend container: `docker compose stop backend`
4. Assess the issue — can it be fixed with a hotfix within 2 hours?
5. If **yes**: Apply the hotfix, test, restart.
6. If **no**: Restore the previous database backup:
   ```bash
   # Stop all containers
   docker compose -f docker-compose.production.yml down
   
   # Restore pre-go-live backup
   pg_restore -U itembar_user -d itembar_db \
     -F c /opt/itemba/backups/pre-migration/itembar_pre_golive.dump
   
   # Deploy previous image version
   docker tag itemba/backend:stable itemba/backend:latest
   docker compose -f docker-compose.production.yml up -d
   ```
7. Notify all staff: "System maintenance — please stand by."
8. Communicate resolution timeline to Group Director.

---

## 5. Communication Plan

### Pre-Go-Live Communication (T-3 Days)
**Audience:** All staff
**Channel:** Email and WhatsApp group
**Message:** "ITEMBA-R goes live on [date] at 08:00. Your login: [URL]. Your credentials have been sent separately. If you have not received your credentials, contact IT Admin by [date-1]. Training must be completed before go-live day."

### Go-Live Day Announcement (08:45, after all-clear)
**Audience:** All company managers
**Channel:** WhatsApp group
**Message:** "ITEMBA-R is live and operational. All systems are running normally. Please begin using the system for today's operations. IT Admin is available for support: [phone]."

### Post-Go-Live Day 1 Brief (End of Day)
**Audience:** Group Director, all company managers
**Channel:** Brief meeting or summary email
**Content:** System status, any issues encountered, support tickets raised, initial observations.
