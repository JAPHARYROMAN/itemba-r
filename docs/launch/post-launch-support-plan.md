# Post-Launch Support Plan

## Overview

This document defines the support structure, SLAs, escalation procedures, incident response, and monitoring KPIs for the period following ITEMBA-R go-live. A well-run post-launch support operation is critical to building user trust in the new system.

---

## 1. Support Team Structure

| Role | Responsibility | Coverage |
|---|---|---|
| **IT Administrator (L1/L2)** | First responder for all issues. User management, configuration, basic troubleshooting. | Business hours (08:00–17:00 EAT). On-call for URGENT issues. |
| **Finance Support (L1)** | Handles finance-related questions (how to post a journal, reconciliation help). | Business hours. |
| **HR Support (L1)** | Handles HR and payroll questions. | Business hours. |
| **Senior IT / Developer (L3)** | Handles bugs, data issues, migration problems, critical incidents. | On-call for P1 incidents. |

### Support Channel
All support requests must go through the ITEMBA-R support ticket system:
- **In-system:** Navigate to **Support → My Tickets → New Ticket**
- **Email (if in-system unavailable):** support@itemba.local

For URGENT operational issues (can't open a shift, can't process payments), call the IT Admin directly.

---

## 2. Ticket Handling SLAs

| Priority | When to Use | First Response | Resolution Target |
|---|---|---|---|
| **URGENT** | System down, financial data at risk, security incident, can't operate at all | 2 hours | 4 hours |
| **HIGH** | Major feature broken, significant workflow disruption, incorrect calculations | 8 hours (business hours) | 24 hours |
| **NORMAL** | Feature partially not working, workaround available | 24 hours | 5 business days |
| **LOW** | Minor issue, cosmetic, question, suggestion | 5 business days | Next maintenance window |

### Priority Escalation
If a ticket is not responded to within the SLA, the user should:
1. Call the IT Admin directly.
2. Escalate to their company manager.
3. The company manager escalates to the Group Director if unresolved.

---

## 3. Escalation Matrix

| Situation | L1 Action | L2 Action | L3 Action |
|---|---|---|---|
| User can't log in | Reset password, check account status | Check JWT configuration | — |
| Wrong data shown | Investigate data issue | Check query filters, DB | Investigate at code level |
| Financial calculation wrong | Check journal entries, verify with Finance team | Check calculation logic | Fix in code if systematic |
| System very slow | Check Docker stats, restart containers | Check slow queries, indexes | Optimize code/queries |
| Security concern | Revoke session, lock account, log event | Investigate source | Incident response (P1/P2) |
| Data isolation possible breach | Immediately log and escalate to L2 | Investigate access logs | Fix immediately (P1) |
| Integration not working | Check provider credentials, connection test | Check API logs, retry | Fix integration code |

---

## 4. Critical Incident Response Procedure

### Incident Levels
| Level | Definition | Example |
|---|---|---|
| **P1 (Critical)** | System completely down, data corruption, security breach, data isolation failure | Application 500 errors, database unreachable, Company A seeing Company B data |
| **P2 (High)** | Major functionality broken for a significant user group | Payroll cannot be run, POS not processing payments, no one can log in |
| **P3 (Medium)** | Significant feature broken with workaround available | Reports not exporting, one specific form not saving |

### P1 Incident Response Steps
1. **T+0:** IT Admin is notified (phone/WhatsApp — don't wait for a ticket).
2. **T+15 min:** IT Admin assesses and classifies (P1 confirmed or de-escalated).
3. **T+15 min:** Group Director notified of the P1 incident.
4. **T+30 min:** Developer/L3 engaged if IT Admin cannot resolve.
5. **T+60 min:** Status update to Group Director — ETA on resolution.
6. **T+4 hours:** If not resolved — invoke rollback procedure (see go-live plan).
7. **Post-incident:** Incident report written and shared within 24 hours of resolution.

### P1 Incident Report Contents
- Incident description and timeline
- Root cause analysis
- Impact on data and users
- Resolution steps taken
- Preventive measures to avoid recurrence

---

## 5. Hotfix Deployment Process

When a bug fix is required after go-live:

### Hotfix Classification
- **Emergency hotfix:** P1 or P2 issue requiring deployment within hours.
- **Standard hotfix:** P3 issue that can be batched with the next planned release.

### Emergency Hotfix Steps
1. Developer reproduces the bug and writes the fix.
2. Fix is tested on the staging environment (abbreviated test — specific test cases only).
3. IT Admin takes a pre-hotfix backup: `pg_dump ... -f pre_hotfix_$(date +%Y%m%d_%H%M).dump`
4. IT Admin deploys the fix:
   ```bash
   docker compose -f docker-compose.production.yml pull backend
   docker compose -f docker-compose.production.yml up -d --no-deps backend
   ```
5. Verify health check passes.
6. Verify the specific issue is resolved.
7. Record the deployment in the Release Log.
8. Notify affected users that the issue is resolved.

---

## 6. Post-Launch Monitoring KPIs

Monitor these KPIs daily for the first month:

| KPI | Target | Alert If |
|---|---|---|
| API Error Rate | < 0.1% of requests | > 1% |
| API p95 Response Time | < 1 second | > 2 seconds |
| Failed Login Rate | < 2% of attempts | > 10% (possible brute force) |
| Database CPU Usage | < 40% average | > 80% sustained |
| Application Memory | < 70% of allocated | > 90% |
| Backup Success Rate | 100% | Any failure |
| Support Ticket Volume | Decreasing week-over-week | Spike (>50% week-on-week) |
| Critical Incidents | 0 per week | Any P1 incident |

Review these KPIs weekly in the Post-Launch Review meeting.

---

## 7. 30-Day Post-Launch Review

On Day 30 after go-live, hold a structured review meeting:

**Participants:** Group Director, IT Admin, Finance Controller, all company managers

**Agenda:**
1. System performance summary (uptime, error rate, response times)
2. Support ticket summary (volume, categories, resolution times)
3. User feedback from each company
4. Training gaps identified from support tickets
5. Known limitations — Phase 2 planning priorities
6. Security review — any events of concern
7. Compliance status — all obligations on track
8. Decision: Phase 2 scope confirmation

**Outcomes:**
- Post-launch review report distributed to all participants
- Phase 2 feature priorities agreed
- Training gaps addressed with additional materials or sessions
- Any ongoing issues assigned to owners with resolution dates

---

## 8. Feedback Collection

### In-System Feedback
Users can rate help articles (helpful / not helpful) to identify documentation gaps.

### Support Ticket Analysis
Monthly analysis of support ticket categories and volumes:
- Training gap tickets (user didn't know how to do something) → Add to training materials
- Bug tickets → Fix in next release
- Feature request tickets → Phase 2 planning

### User Satisfaction
After 30 days, send a brief feedback survey to all active users:
- "How satisfied are you with ITEMBA-R? (1–5)"
- "What is working well?"
- "What is most frustrating?"
- "What feature would you most like to see added?"

Survey results are shared with the Group Director and feed into Phase 2 planning.
