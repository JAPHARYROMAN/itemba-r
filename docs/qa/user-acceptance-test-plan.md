# User Acceptance Test Plan

## 1. UAT Objectives

User Acceptance Testing (UAT) verifies that ITEMBA-R meets the real-world operational needs of each company and role in the Itemba Group. Unlike technical QA which verifies functionality, UAT verifies **fitness for purpose** — does the system work the way the actual users need it to work?

**UAT succeeds when:** Real users from each company can complete their daily workflows without significant difficulty, and the system produces accurate outputs that they trust.

---

## 2. UAT Participant List

| Participant | Role in ITEMBA-R | Company | UAT Focus |
|---|---|---|---|
| Group Director | Group Director | Group Level | Executive dashboards, Group Control, approvals, BI |
| Finance Controller | Group Finance Controller | Group Level | Finance, payroll review, reports |
| Accountant — Mwanjalisi | Accountant | Mwanjalisi Oil | Journals, AP/AR, bank reconciliation, petroleum finance |
| Mwanjalisi Station Manager | Petroleum Supervisor | Mwanjalisi Oil | Shifts, nozzles, deliveries, dips, reports |
| Westsides Manager | Westsides Supervisor | Westsides | POS, wholesale, batches, returnables, Hospitality |
| Itemba Operations Manager | Company Manager | Itemba Enterprises | Logistics, agriculture, construction overview |
| HR Manager | HR Manager | Group Level | Employees, payroll, leave, performance |
| Compliance Officer | Compliance Officer | Group Level | Obligations, licenses, tax filings |
| IT Admin | Group Super Admin | Group Level | Users, roles, security, integrations, backups |
| Front Desk Staff (Uzunguni Inn) | Front Desk Staff | Itemba Enterprises | Bookings, check-in/out, folios, payments |

---

## 3. UAT Scenarios by Role

### Group Director
| # | Scenario | Acceptance Criteria |
|---|---|---|
| GD-01 | View the Group Executive Dashboard | Revenue, expenses, and profit figures are correct for the current month |
| GD-02 | Access Group Control — view bank accounts for all companies | All three companies' bank accounts are visible and complete |
| GD-03 | Approve a high-value Purchase Order (above TZS 5,000,000) | Approval notification received, approved successfully, approval logged |
| GD-04 | View the Group P&L consolidated report | Report generates without error and totals are correct |
| GD-05 | Confirm launch readiness assessment | Assessment score visible, can review and approve sign-off |

### Finance Controller
| # | Scenario | Acceptance Criteria |
|---|---|---|
| FC-01 | Post a journal entry for depreciation | Balanced journal entry posted, appears in trial balance |
| FC-02 | Review and approve payroll for Mwanjalisi Oil | Payroll summary reviewed, approved, salary payments processed |
| FC-03 | Complete a bank reconciliation for Westsides main account | Reconciliation balances, marked complete |
| FC-04 | Run the monthly trial balance for Itemba Enterprises | Trial balance generated, debits = credits |
| FC-05 | Close a fiscal period | Period status changes to Closed, no further posting allowed |

### Accountant — Mwanjalisi Oil
| # | Scenario | Acceptance Criteria |
|---|---|---|
| MA-01 | Record a supplier invoice for a fuel delivery | Invoice created, linked to PO and GRN, three-way match verified |
| MA-02 | Record a customer payment against an outstanding AR invoice | Invoice marked Paid, AR balance updated |
| MA-03 | Run the AR Aging Report | Report shows correct aging buckets and totals |
| MA-04 | Submit an expense for approval | Expense submitted, notification sent to approver |
| MA-05 | Run the daily petroleum revenue reconciliation | Revenue matches shift collections for the selected date |

### Mwanjalisi Station Manager
| # | Scenario | Acceptance Criteria |
|---|---|---|
| MM-01 | Open a morning fuel shift for 4 nozzles | Shift created with opening meter readings recorded |
| MM-02 | Record closing nozzle readings and collections | Volume calculated, collections entered, variance calculated |
| MM-03 | Close the shift with acceptable variance | Shift closes, revenue journal posted automatically |
| MM-04 | Record a fuel delivery from TotalEnergies | Delivery recorded, tank stock updated |
| MM-05 | Run the Daily Reconciliation report | Report shows opening stock, deliveries, sales, closing stock, and variance |

### Westsides Manager
| # | Scenario | Acceptance Criteria |
|---|---|---|
| WM-01 | Process a POS sale including VAT and mobile money payment | Sale recorded, receipt generated, stock reduced |
| WM-02 | Create a wholesale order for 10 crates of beverages | Order confirmed, delivery note generated |
| WM-03 | Record incoming beverage batch with expiry date | Batch created, stock updated with batch tracking |
| WM-04 | Record returnable crate return from a customer | Deposit refunded, returnables balance updated |
| WM-05 | Check Uzunguni Inn — view room occupancy and upcoming arrivals | Occupancy dashboard visible, arrivals for tomorrow listed |

### Itemba Operations Manager
| # | Scenario | Acceptance Criteria |
|---|---|---|
| IM-01 | Create and dispatch a logistics trip | Trip created, assigned driver and vehicle, status = In Transit |
| IM-02 | Record a harvest for the current agricultural season | Harvest recorded, produce inventory updated |
| IM-03 | View a construction project progress summary | Project % complete and cost-to-date visible |
| IM-04 | Create a progress billing claim for a construction project | Claim created with correct BOQ-based calculation |
| IM-05 | View the Itemba Enterprises division revenue dashboard | All three divisions show revenue figures for current month |

### HR Manager
| # | Scenario | Acceptance Criteria |
|---|---|---|
| HR-01 | Add a new employee with full details | Employee record created with NSSF, NHIF, bank account |
| HR-02 | Record attendance for a department for the current week | Attendance recorded, absent days noted |
| HR-03 | Approve a leave request | Leave request approved, leave balance updated |
| HR-04 | Generate payroll for Westsides for the current month | Payroll generated with correct PAYE, NSSF, SDL deductions |
| HR-05 | Generate and send payslips | Payslips generated and emailed to all employees |

### Compliance Officer
| # | Scenario | Acceptance Criteria |
|---|---|---|
| CO-01 | View the compliance obligations calendar | All obligations for the next 30 days visible with due dates |
| CO-02 | Mark a VAT return as filed and record the filing reference | Obligation marked complete, reference recorded |
| CO-03 | Upload a renewed business license with new expiry date | License record updated, old expiry date replaced |
| CO-04 | Run the compliance score report | Overall compliance completion rate per company is displayed |
| CO-05 | Export an evidence pack for a specific obligation | PDF bundle of evidence documents generated |

### IT Admin
| # | Scenario | Acceptance Criteria |
|---|---|---|
| IT-01 | Create a new user and assign a role | User created, welcome email sent, role assigned |
| IT-02 | Revoke an active user session | Session revoked, user is logged out immediately |
| IT-03 | Configure the M-Pesa integration and test the connection | Connection test succeeds, configuration saved |
| IT-04 | Run a manual backup and verify the backup file | Backup completes successfully, file is downloadable |
| IT-05 | View security events for the last 7 days | Security event log loads, filter by date works |

### Front Desk Staff (Uzunguni Inn)
| # | Scenario | Acceptance Criteria |
|---|---|---|
| FD-01 | Create a room booking for a walk-in guest | Booking confirmed, room assigned, check-in date set |
| FD-02 | Check in a guest | Guest checked in, folio opened, room status = Occupied |
| FD-03 | Add a restaurant charge to a guest folio | Charge added to folio, folio total updates |
| FD-04 | Check out a guest and collect payment via M-Pesa | Folio settled, payment recorded, receipt generated |
| FD-05 | View housekeeping status for all rooms | Room status board shows Clean/Dirty/Occupied correctly |

---

## 4. Acceptance Criteria

UAT is accepted when:
1. Each participant has completed all their assigned scenarios.
2. No **blocking issues** (scenarios that cannot be completed) remain unresolved.
3. Each participant signs the **UAT Sign-Off Form**.

Minor issues (cosmetic, convenience, non-blocking) may be noted for post-launch resolution without blocking UAT sign-off.

---

## 5. Sign-Off Authority

The **Group Director** is the ultimate sign-off authority for UAT. UAT is not complete until the Group Director confirms their scenarios were satisfactorily completed.

Individual department UAT is signed off by the respective department head (Finance Controller signs off finance UAT, HR Manager signs off HR UAT, etc.).

---

## 6. Issue Escalation

If a UAT participant finds a blocking issue:
1. Document the issue (description, steps, expected vs. actual behavior, screenshot).
2. Submit a QA test case FAIL via the QA module.
3. Escalate to the QA Lead immediately.
4. The QA Lead creates a launch blocker if severity warrants.
5. UAT for the affected scenario is paused until the issue is resolved.
6. Once resolved, the participant re-tests the specific scenario.

---

## 7. UAT Environment

- **Environment:** Staging (pre-production server with production-like data volume)
- **Data:** Seeded demo data + any real reference data provided by the company managers
- **Duration:** UAT period is 5 working days (T-14 to T-9 before go-live)
- **Support:** QA Lead and IT Admin available during UAT to assist participants

---

## 8. Test Data Setup

Before UAT begins, the IT Admin must ensure:
- [ ] All UAT participant accounts are created with correct roles
- [ ] Demo data includes sample customers, employees, products, and transactions per company
- [ ] Petroleum: at least 2 active shifts and 1 fuel delivery in the system
- [ ] Westsides: at least 10 products with batches and stock in inventory
- [ ] Itemba: at least 2 active trips, 1 active agriculture season, 1 active construction project
- [ ] Hospitality: at least 3 room types and 10 rooms configured
- [ ] HR: at least 5 employees per company with payroll history
- [ ] Compliance: at least 5 obligations with varying due dates
